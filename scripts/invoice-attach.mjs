// Anexa o original de uma nota (e opcionalmente aprova) pelo mesmo servidor do app.
// Exige login pessoal com 2FA no terminal: a revisão humana continua sendo sua.
//
// Uso:
//   node scripts/invoice-attach.mjs <invoice_id> <arquivo> [--approve paid|unpaid]
//        [--payment-method credit_card|debit_card|bank_transfer] [--payment-date AAAA-MM-DD]
// Servidor: HOT_DOOGY_URL (padrão https://management.hotdoogy.com).
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const base = (process.env.HOT_DOOGY_URL || 'https://management.hotdoogy.com').replace(/\/$/, '');
const [invoiceId, file, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const approve = flag('--approve');
if (!/^[a-f0-9-]{36}$/.test(invoiceId || '') || !file || (approve && !['paid', 'unpaid'].includes(approve))) {
  console.error('Uso: node scripts/invoice-attach.mjs <invoice_id> <arquivo> [--approve paid|unpaid] [--payment-method ...] [--payment-date AAAA-MM-DD]');
  process.exit(1);
}
const types = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const type = types[extname(file).toLowerCase()];
if (!type) { console.error('Formato aceito: PDF, PNG, JPG ou WEBP.'); process.exit(1); }
const body = readFileSync(file);

let cookie = '';
async function api(path, { method = 'GET', json, raw, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { origin: base, ...(cookie && { cookie }), ...(json && { 'content-type': 'application/json' }), ...headers },
    body: json ? JSON.stringify(json) : raw,
  });
  const set = res.headers.get('set-cookie')?.match(/hd_session=([^;]*)/);
  if (set) cookie = `hd_session=${set[1]}`;
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status}: ${data?.error || data?.message || text}`);
  return data;
}

async function ask(rl, question, hidden = false) {
  if (!hidden) return (await rl.question(question)).trim();
  // Esconde a senha enquanto é digitada.
  const write = rl._writeToOutput;
  rl._writeToOutput = (s) => { if (s.includes(question)) write.call(rl, s); };
  const answer = await rl.question(question);
  rl._writeToOutput = write;
  stdout.write('\n');
  return answer;
}

const rl = createInterface({ input: stdin, output: stdout, terminal: true });
try {
  console.log(`Servidor: ${base}`);
  const email = await ask(rl, 'E-mail: ');
  const password = await ask(rl, 'Senha: ', true);
  let session = await api('/api/auth/login', { method: 'POST', json: { email, password } });
  if (session.mfa?.required) {
    if (session.mfa.step !== 'verify' || !session.mfa.factors?.length) throw new Error('Configure o 2FA pelo app antes de usar o terminal.');
    const code = await ask(rl, 'Código do autenticador: ');
    session = await api('/api/auth/mfa/verify', { method: 'POST', json: { factorId: session.mfa.factors[0].id, code } });
  }

  console.log(`\nNota:    ${invoiceId}\nArquivo: ${basename(file)} (${(body.length / 1024).toFixed(0)} KB)`);
  const ok = await ask(rl, 'Confirmo que revisei este original e que ele é uma nota fiscal de fornecedor (s/N): ');
  if (ok.toLowerCase() !== 's') throw new Error('Cancelado.');

  const doc = await api(`/api/invoices/${invoiceId}/document`, {
    method: 'PUT', raw: body,
    headers: { 'content-type': type, 'x-document-kind': 'invoice', 'x-document-reviewed': 'true', 'x-file-name': encodeURIComponent(basename(file)) },
  });
  console.log('✓ Original anexado.', typeof doc === 'object' ? JSON.stringify(doc) : '');

  if (approve) {
    const data = await api('/api/data');
    const inv = data.invoices?.find((i) => i.id === invoiceId);
    if (!inv) throw new Error('Nota não encontrada para aprovação.');
    console.log(`\n${inv.number || inv.invoiceNumber || ''} · total ${inv.total} · pagamento: ${approve}`);
    const yes = await ask(rl, 'Aprovar esta nota? (s/N): ');
    if (yes.toLowerCase() !== 's') throw new Error('Anexado, mas não aprovado.');
    await api(`/api/invoices/${invoiceId}/approve-draft`, {
      method: 'POST',
      json: {
        confirmed: true, expectedUpdatedAt: inv.updatedAt, paymentStatus: approve,
        paymentDate: approve === 'paid' ? flag('--payment-date') || null : null,
        paymentMethod: approve === 'paid' ? flag('--payment-method') || null : null,
        receivingStatus: 'not_received',
      },
    });
    console.log('✓ Nota aprovada.');
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
  if (cookie) await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
}
