// Envia um arquivo de nota para o bucket privado invoice-documents via S3 do Supabase.
// Uso: node scripts/upload-invoice-document.mjs <arquivo> <storage_path>
// Credenciais em app/.env.storage (nunca versionar).
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.storage', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const [file, key] = process.argv.slice(2);
if (!file || !key) {
  console.error('Uso: node scripts/upload-invoice-document.mjs <arquivo> <storage_path>');
  process.exit(1);
}

const types = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const contentType = types[extname(file).toLowerCase()] ?? 'application/octet-stream';
const body = readFileSync(file);

const sha = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
const encodePath = (p) => p.split('/').map((s) => encodeURIComponent(s)).join('/');

const endpoint = new URL(env.SUPABASE_S3_ENDPOINT);
const path = `${endpoint.pathname.replace(/\/$/, '')}/${env.SUPABASE_S3_BUCKET}/${encodePath(key)}`;
const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const day = amzDate.slice(0, 8);
const region = env.SUPABASE_S3_REGION;
const payloadHash = sha(body);

const headers = { 'content-type': contentType, host: endpoint.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
const signed = Object.keys(headers).sort();
const canonical = ['PUT', path, '', ...signed.map((h) => `${h}:${headers[h]}`), '', signed.join(';'), payloadHash].join('\n');
const scope = `${day}/${region}/s3/aws4_request`;
const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
const kSigning = ['s3', 'aws4_request'].reduce(hmac, hmac(hmac(`AWS4${env.SUPABASE_S3_SECRET_ACCESS_KEY}`, day), region));
const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');

const res = await fetch(`${endpoint.origin}${path}`, {
  method: 'PUT',
  headers: {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${env.SUPABASE_S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`,
  },
  body,
});

if (!res.ok) {
  console.error(`Falha no envio (${res.status}): ${await res.text()}`);
  process.exit(1);
}
console.log(JSON.stringify({ storage_path: key, mime_type: contentType, bytes: body.length, sha256: payloadHash }));
