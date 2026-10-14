import {code128Bars} from './code128.js';
import {batchPreparedBy} from './preparation-model.js';
// Batch numbers and label codes derive from the batch id and completion moment, so labels can be reprinted
// for batches stored in the database without storing an extra column.
const nyParts=value=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:true}).formatToParts(new Date(value));const get=type=>parts.find(p=>p.type===type)?.value||'';return {yy:get('year'),mm:get('month'),dd:get('day'),hh:get('hour'),min:get('minute'),period:get('dayPeriod')};};
export const batchMoment=batch=>batch.completedAt||batch.createdAt||(batch.date?batch.date+'T12:00:00Z':null);
export function batchCode(batch){
  const moment=batchMoment(batch);
  if(!batch?.id||!moment||!Number.isFinite(Date.parse(moment)))throw Error('Batch needs an id and a completion moment.');
  const {yy,mm,dd}=nyParts(moment);
  const hex=String(batch.id).replace(/-/g,'').slice(0,10);
  const serial=String(parseInt(hex,16)%100000).padStart(5,'0');
  const digits=`${yy}${mm}${dd}${serial}`;
  return {digits,number:`BATCH-${yy}${mm}${dd}-${serial}`};
}
export const batchNumber=batch=>batch.number||(batch.id&&batchMoment(batch)?batchCode(batch).number:String(batch.id||'').slice(0,8).toUpperCase());
export const MAX_LABELS=500;
export function labelCount(qty){const n=Math.ceil(Number(qty));return Number.isFinite(n)&&n>0?Math.min(MAX_LABELS,n):1;}
export const labelFilename=batch=>`Hot-Doogy-Prep-Labels-${batchNumber(batch).replace(/[^a-z0-9_-]/gi,'-')}.pdf`;
// One row per produced unit. Each code is unique: batch digits plus a three-digit unit serial.
export function labelRows(batch,count=labelCount(batch.actualQty??batch.qty)){
  const total=Math.min(MAX_LABELS,Math.max(1,Math.floor(Number(count)||1)));
  const {digits,number}=batchCode(batch);
  return Array.from({length:total},(_,i)=>{const serial=String(i+1).padStart(3,'0');return {serial:i+1,total,number,code:`${digits}${serial}`,text:`${digits.slice(0,6)} ${digits.slice(6)} ${serial}`};});
}
export const formatMoment=value=>{if(!value)return 'Not provided';const p=nyParts(value);return `${p.mm}/${p.dd}/20${p.yy} ${p.hh}:${p.min} ${p.period}`;};
const quantityText=batch=>{const qty=Number(batch.actualQty??batch.qty);return Number.isFinite(qty)?`${qty.toLocaleString('en-US',{maximumFractionDigits:2})} ${batch.uom||''}`.trim():'Not provided';};
// 2.4 in x 3.5 in label, one per page. Generated in the browser; no upload or database write.
export async function createPrepLabelsPdf(batch,rows=labelRows(batch),{logoBytes,preparedBy}={}){
  const {PDFDocument,StandardFonts,rgb}=await import('./vendor/pdf-lib.esm.min.js');
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo=logoBytes?await pdf.embedPng(logoBytes):null;
  const W=2.4*72,H=3.5*72,M=10,width=W-M*2;
  const ink=rgb(.13,.14,.13),gray=rgb(.36,.38,.37),yellow=rgb(.996,.808,.027),light=rgb(.85,.86,.85);
  const printable=value=>Array.from(String(value??'').normalize('NFC')).map(c=>{try{font.encodeText(c);return c;}catch{return '?';}}).join('');
  const name=printable(batch.name||batch.internalName||'Prep item');
  function wrap(value,size,face,maxWidth,maxLines){const lines=[];let current='';for(const word of printable(value).split(/\s+/).filter(Boolean)){const candidate=current?current+' '+word:word;if(face.widthOfTextAtSize(candidate,size)>maxWidth&&current){lines.push(current);current=word;}else current=candidate;}if(current)lines.push(current);if(lines.length>maxLines){const kept=lines.slice(0,maxLines);let last=kept[maxLines-1];while(face.widthOfTextAtSize(last+'…',size)>maxWidth&&last.length)last=last.slice(0,-1);kept[maxLines-1]=last.trimEnd()+'…';return kept;}return lines;}
  const nameSize=[13,11,10].find(size=>wrap(name,size,bold,width,2).join(' ')===name)||10,nameLines=wrap(name,nameSize,bold,width,2);
  const who=printable(preparedBy||batchPreparedBy(batch)||'Not specified');
  const details=[['Produced',formatMoment(batchMoment(batch))],['Prepared by',who],['Location',printable(batch.locationName||'Not provided')],['Batch qty',printable(quantityText(batch))]];
  for(const row of rows){
    const page=pdf.addPage([W,H]);
    const draw=(value,x,top,size,face=font,color=gray)=>page.drawText(printable(value),{x,y:H-top-size,size,font:face,color});
    let y=M;
    if(logo){const logoW=96,logoH=logo.height/logo.width*logoW;page.drawImage(logo,{x:(W-logoW)/2,y:H-y-logoH,width:logoW,height:logoH});y+=logoH+6;}
    page.drawRectangle({x:M,y:H-y-2,width,height:2,color:yellow});y+=8;
    draw('PREP ITEM',M,y,6,bold,gray);y+=9;
    for(const line of nameLines){draw(line,M,y,nameSize,bold,ink);y+=nameSize+2;}
    y+=4;
    draw(row.number,M,y,9,bold,ink);
    const unit=`UNIT ${String(row.serial).padStart(2,'0')} OF ${String(row.total).padStart(2,'0')}`;
    draw(unit,W-M-bold.widthOfTextAtSize(unit,7),y+1.5,7,bold,gray);y+=14;
    page.drawRectangle({x:M,y:H-y,width,height:.6,color:light});y+=6;
    for(const [label,value] of details){draw(label,M,y,6.5,bold,gray);const lines=wrap(value,7.5,font,width-56,1);draw(lines[0]||'',M+56,y-.5,7.5,font,ink);y+=11;}
    y+=2;
    draw('USE BY',M,y,6.5,bold,gray);page.drawRectangle({x:M+56,y:H-y-8,width:width-56,height:.6,color:ink});y+=14;
    // Quiet zones of at least ten modules on each side keep the symbol scannable.
    const {bars,width:modules}=code128Bars(row.code),scale=width/(modules+20),barHeight=Math.max(26,H-M-y-11),x0=M+scale*10;
    for(const bar of bars)page.drawRectangle({x:x0+bar.x*scale,y:H-y-barHeight,width:bar.width*scale,height:barHeight,color:ink});
    y+=barHeight+2;
    draw(row.text,(W-font.widthOfTextAtSize(row.text,7))/2,y,7,font,ink);
  }
  pdf.setTitle('Hot Doogy - Prep labels '+rows[0]?.number);pdf.setAuthor('Hot Doogy');pdf.setSubject('Prep batch labels, 2.4 x 3.5 in, one label per page');
  return pdf.save();
}
export async function downloadPrepLabelsPdf(batch,rows,options={}){
  const response=await fetch('/brand/hot-doogy-print.png');
  if(!response.ok)throw Error('Logo unavailable.');
  const bytes=await createPrepLabelsPdf(batch,rows,{...options,logoBytes:await response.arrayBuffer()});
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const a=document.createElement('a');a.href=url;a.download=labelFilename(batch);
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
