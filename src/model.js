export const LOCAL_KEY='hot-doogy-operations-v1';
export const money=n=>n==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n));
export const number=n=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(n||0));
export const preciseNumber=n=>{const value=Number(n??0);if(!Number.isFinite(value))return '—';return new Intl.NumberFormat('pt-BR',{maximumFractionDigits:6,...(value!==0&&Math.abs(value)<0.000001?{notation:'scientific'}:{})}).format(value);};
export const date=d=>{if(!d)return 'A definir';const raw=String(d),normalized=raw.length===10?raw+'T12:00:00-04:00':raw.replace(' ','T').replace(/([+-]\d{2})$/,'$1:00');const parsed=new Date(normalized);return Number.isNaN(parsed.getTime())?'A definir':new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',timeZone:'America/New_York'}).format(parsed);};
export const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const unique=(a,key='id')=>[...new Map(a.map(x=>[x[key],x])).values()];
const emptyLocal=()=>({orders:[],transfers:[],counts:[],production:[],invoices:[],overrides:{},recipeEdits:{},recipePhotos:{},itemPhotos:{},itemEdits:{},supplierItemEdits:{},audit:[]});
export function loadLocal(storage){
  const local=emptyLocal();
  try {
    const d=JSON.parse((storage??globalThis.localStorage).getItem(LOCAL_KEY)||'{}');
    if(!d||typeof d!=='object'||Array.isArray(d))return local;
    for(const key of ['orders','transfers','counts','production','invoices','audit']) {
      if(Array.isArray(d[key]))local[key]=d[key].filter(row=>row&&typeof row==='object'&&!Array.isArray(row));
    }
    if(d.overrides&&typeof d.overrides==='object'&&!Array.isArray(d.overrides))local.overrides=d.overrides;
    if(d.recipeEdits&&typeof d.recipeEdits==='object'&&!Array.isArray(d.recipeEdits))local.recipeEdits=d.recipeEdits;
    for(const key of ['itemEdits','supplierItemEdits','recipePhotos','itemPhotos'])if(d[key]&&typeof d[key]==='object'&&!Array.isArray(d[key]))local[key]=d[key];
    return local;
  } catch { return local; }
}
export function saveLocal(state,storage=globalThis.localStorage){storage.setItem(LOCAL_KEY,JSON.stringify(state));}
export function sum(rows,key){return rows.reduce((n,r)=>n+Number(r[key]||0),0);}
export function periodSales(data,store='all',days=7){
  const length=Number(days),rows=data.salesDaily;
  const end=[...new Set(rows.map(x=>x.date))].sort().at(-1);
  if(!end||!Number.isInteger(length)||length<=0)return {current:[],previous:[],total:0,quantity:0,factCount:0,growth:null,dates:[]};
  // A shared calendar window keeps comparisons consistent when a store has missing days.
  const offset=n=>new Date(Date.parse(end+'T12:00:00Z')-n*86400000).toISOString().slice(0,10);
  const start=offset(length-1),previousStart=offset(length*2-1);
  const all=rows.filter(x=>store==='all'||x.locationId===store);
  const current=all.filter(x=>x.date>=start&&x.date<=end);
  const before=all.filter(x=>x.date>=previousStart&&x.date<start);
  const total=sum(current,'netSales'),previousTotal=sum(before,'netSales');
  return {current,previous:before,total,quantity:sum(current,'quantity'),factCount:sum(current,'factCount'),growth:previousTotal?(total/previousTotal-1)*100:null,dates:[...new Set(current.map(x=>x.date))].sort()};
}
const validLine=x=>x&&x.itemId&&['number','string'].includes(typeof x.qty)&&Number.isFinite(Number(x.qty))&&Number(x.qty)>0;
export function validateOrder(record){if(!record.supplierId)return 'Escolha um fornecedor.';if(!record.locationId)return 'Escolha uma loja.';if(!record.expectedAt)return 'Informe a data de entrega.';if(!Array.isArray(record.lines)||!record.lines.length)return 'Adicione ao menos um item.';if(record.lines.some(x=>!validLine(x)))return 'Informe uma quantidade maior que zero para cada item.';return null;}
export function validateTransfer(record){if(!record.fromLocationId||!record.toLocationId||record.fromLocationId===record.toLocationId)return 'Escolha lojas diferentes para origem e destino.';if(!record.date)return 'Informe a data necessária.';if(!Array.isArray(record.lines)||!record.lines.length||record.lines.some(x=>!validLine(x)))return 'Adicione itens com quantidades maiores que zero.';return null;}
export function nextTransferStatus(status){const next={draft:'approved',approved:'dispatched',dispatched:'completed'};return Object.hasOwn(next,status)?next[status]:null;}
export function safeCsv(rows,columns){const quote=v=>{let value=String(v??'');if(typeof v!=='number'&&/^[\s\u0000-\u001f]*[=+@\-]/.test(value))value="'"+value;return '"'+value.replaceAll('"','""')+'"';};return '\ufeff'+[columns.map(c=>quote(c.label)).join(';'),...rows.map(r=>columns.map(c=>quote(typeof c.value==='function'?c.value(r):r[c.value])).join(';'))].join('\r\n');}
const countMoments={'Antes da abertura':0,'Durante a operação':1,'Após o fechamento':2};
function countOrder(count){
  const parsed=Date.parse(String(count.createdAt??'').replace(' ','T').replace(/([+-]\d{2})$/,'$1:00'));
  const createdAt=Number.isFinite(parsed)?parsed:0;
  const fallbackDate=createdAt?new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/New_York'}).format(createdAt):'';
  return {effectiveDate:/^\d{4}-\d{2}-\d{2}$/.test(count.date??'')?count.date:fallbackDate,moment:Object.hasOwn(countMoments,count.moment)?countMoments[count.moment]:1,createdAt};
}
export function stockFor(item,local){
  const counts=local.counts.filter(c=>c.locationId===item.locationId&&Array.isArray(c.lines));
  const rows=counts.flatMap(c=>c.lines.filter(l=>l&&l.rowId===item.rowId).map(l=>({...l,...countOrder(c)})));
  // Effective conference time takes precedence over when a historical count was entered.
  rows.sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate)||b.moment-a.moment||b.createdAt-a.createdAt);
  const row=rows[0];
  return row?{qty:row.qty,uom:row.uom,local:true}:{qty:item.stockQty,uom:item.stocktakeUom,local:false};
}
