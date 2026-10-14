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
// One row per produced unit. Each label has its own sequential batch number (batch number plus a
// three-digit serial) and a matching unique barcode (batch digits plus the same serial).
export function labelRows(batch,count=labelCount(batch.actualQty??batch.qty)){
  const total=Math.min(MAX_LABELS,Math.max(1,Math.floor(Number(count)||1)));
  const {digits,number}=batchCode(batch);
  return Array.from({length:total},(_,i)=>{const serial=String(i+1).padStart(3,'0');return {serial:i+1,total,batchNumber:number,number:`${number}-${serial}`,code:`${digits}${serial}`,text:`${digits.slice(0,6)} ${digits.slice(6)} ${serial}`};});
}
export const formatMoment=value=>{if(!value)return 'Not provided';const p=nyParts(value);return `${p.mm}/${p.dd}/20${p.yy} ${p.hh}:${p.min} ${p.period}`;};
export const formatDay=value=>{if(!value)return 'Not provided';const p=nyParts(value);return `${p.mm}/${p.dd}/20${p.yy}`;};
// 2.4 in x 3.5 in label, one per page. Generated in the browser; no upload or database write.
// Layout: prep item and batch number at the top, barcode anchored at the bottom, and the
// Date/Time, Prepared by and Use by fields spread evenly over the space between them.
// Optional shelf life in days fills Use by with the production moment plus that many days; otherwise it is a blank line to write on.
export function useByMoment(batch,days){const n=Number(days),at=Date.parse(batchMoment(batch)||'');return days!=null&&days!==''&&Number.isFinite(n)&&n>0&&Number.isFinite(at)?new Date(at+n*86400000).toISOString():null;}
export async function createPrepLabelsPdf(batch,rows=labelRows(batch),{preparedBy,useByDays}={}){
  const {PDFDocument,StandardFonts,rgb}=await import('./vendor/pdf-lib.esm.min.js');
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const W=2.4*72,H=3.5*72,M=12,width=W-M*2;
  const ink=rgb(.13,.14,.13),gray=rgb(.36,.38,.37),light=rgb(.82,.83,.82);
  const printable=value=>Array.from(String(value??'').normalize('NFC')).map(c=>{try{font.encodeText(c);return c;}catch{return '?';}}).join('');
  const name=printable(batch.name||batch.internalName||'Prep item');
  function wrap(value,size,face,maxWidth,maxLines){const lines=[];let current='';for(const word of printable(value).split(/\s+/).filter(Boolean)){const candidate=current?current+' '+word:word;if(face.widthOfTextAtSize(candidate,size)>maxWidth&&current){lines.push(current);current=word;}else current=candidate;}if(current)lines.push(current);if(lines.length>maxLines){const kept=lines.slice(0,maxLines);let last=kept[maxLines-1];while(face.widthOfTextAtSize(last+'…',size)>maxWidth&&last.length)last=last.slice(0,-1);kept[maxLines-1]=last.trimEnd()+'…';return kept;}return lines;}
  const fits=(size,lines)=>wrap(name,size,bold,width,lines).join(' ')===name;
  const nameSize=[16,14,12].find(size=>fits(size,2))||11,nameLines=wrap(name,nameSize,bold,width,nameSize===11?3:2);
  const who=printable(preparedBy||batchPreparedBy(batch)||'Not specified');
  const fields=[['PRODUCED',formatMoment(batchMoment(batch))],['PREPARED BY',who],['USE BY',useByMoment(batch,useByDays)?formatDay(useByMoment(batch,useByDays)):null]];
  const LABEL=6.5,VALUE=10.5,FIELD=LABEL+4+VALUE+2,TEXT=8,MIN_GAP=7;
  // Fixed top block height, so the barcode takes whatever height is left (between 30 and 56 pt).
  const NUMBER=8.5,topHeight=LABEL+5+nameLines.length*nameSize*1.12+6+NUMBER+9;
  const BAR_H=Math.max(30,Math.min(56,H-M*2-topHeight-fields.length*FIELD-(fields.length+1)*MIN_GAP-TEXT-3)),barTop=H-M-TEXT-3-BAR_H;
  for(const row of rows){
    const page=pdf.addPage([W,H]);
    const draw=(value,x,top,size,face=font,color=gray)=>page.drawText(printable(value),{x,y:H-top-size,size,font:face,color});
    const rule=(top,thickness=.6,color=light,x=M,w=width)=>page.drawRectangle({x,y:H-top-thickness,width:w,height:thickness,color});
    let y=M;
    draw('PREP ITEM',M,y,LABEL,bold,gray);y+=LABEL+5;
    for(const line of nameLines){draw(line,M,y,nameSize,bold,ink);y+=nameSize*1.12;}
    y+=6;
    draw(row.number,M,y,NUMBER,bold,gray);y+=NUMBER+9;
    rule(y);
    // Spread the three fields evenly between the divider and the barcode.
    const gap=Math.max(MIN_GAP,(barTop-y-fields.length*FIELD)/(fields.length+1));
    y+=gap;
    for(const [label,value] of fields){
      draw(label,M,y,LABEL,bold,gray);
      if(value!=null)draw(wrap(value,VALUE,font,width,1)[0]||'',M,y+LABEL+4,VALUE,font,ink);
      else rule(y+FIELD,.8,ink);
      y+=FIELD+gap;
    }
    // Quiet zones of at least ten modules on each side keep the symbol scannable.
    const {bars,width:modules}=code128Bars(row.code),scale=width/(modules+20),x0=M+scale*10;
    for(const bar of bars)page.drawRectangle({x:x0+bar.x*scale,y:H-barTop-BAR_H,width:bar.width*scale,height:BAR_H,color:ink});
    draw(row.text,(W-font.widthOfTextAtSize(row.text,TEXT))/2,barTop+BAR_H+3,TEXT,font,ink);
  }
  pdf.setTitle('Hot Doogy - Prep labels '+rows[0]?.batchNumber);pdf.setAuthor('Hot Doogy');pdf.setSubject('Prep batch labels, 2.4 x 3.5 in, one label per page');
  return pdf.save();
}
export async function downloadPrepLabelsPdf(batch,rows,options={}){
  const bytes=await createPrepLabelsPdf(batch,rows,options);
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const a=document.createElement('a');a.href=url;a.download=labelFilename(batch);
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
