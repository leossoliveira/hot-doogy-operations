import {code128Bars} from './code128.js';
import {batchPreparedBy} from './preparation-model.js';
// Batch numbers and label codes derive from the batch id and completion moment, so labels can be reprinted
// for batches stored in the database without storing an extra column.
const nyParts=value=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:true,weekday:'short'}).formatToParts(new Date(value));const get=type=>parts.find(p=>p.type===type)?.value||'';return {weekday:get('weekday').toUpperCase(),yy:get('year'),mm:get('month'),dd:get('day'),hh:get('hour'),min:get('minute'),period:get('dayPeriod')};};
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
// Use-by dates lead with the day of the week, as on day-of-week food rotation labels.
export const formatUseBy=value=>value?`${nyParts(value).weekday} ${formatDay(value)}`:'';
// 2.4 in x 3.5 in label, one per page. Generated in the browser; no upload or database write.
// Follows common U.S. food-service prep labels: product name first, a boxed USE BY date with the day
// of the week as the most visible element, prep date and time, who prepared it, the storage
// instruction, and the lot barcode. Header carries the logo and the address.
// Optional shelf life in days fills Use by with the production moment plus that many days; otherwise it is a blank line to write on.
export function useByMoment(batch,days){const n=Number(days),at=Date.parse(batchMoment(batch)||'');return days!=null&&days!==''&&Number.isFinite(n)&&n>0&&Number.isFinite(at)?new Date(at+n*86400000).toISOString():null;}
export const LABEL_ADDRESS=['1300 Worcester St','Natick, MA'];
export const LABEL_NOTICE='KEEP FROZEN AT 0°F OR BELOW';
export async function createPrepLabelsPdf(batch,rows=labelRows(batch),{preparedBy,useByDays,logoBytes,address=LABEL_ADDRESS,notice=LABEL_NOTICE}={}){
  const {PDFDocument,StandardFonts,rgb}=await import('./vendor/pdf-lib.esm.min.js');
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo=logoBytes?await pdf.embedPng(logoBytes):null;
  const W=2.4*72,H=3.5*72,M=11,width=W-M*2;
  const ink=rgb(.13,.14,.13),gray=rgb(.36,.38,.37),light=rgb(.82,.83,.82),white=rgb(1,1,1);
  const printable=value=>Array.from(String(value??'').normalize('NFC')).map(c=>{try{font.encodeText(c);return c;}catch{return '?';}}).join('');
  const name=printable(batch.name||batch.internalName||'Prep item');
  function wrap(value,size,face,maxWidth,maxLines){const lines=[];let current='';for(const word of printable(value).split(/\s+/).filter(Boolean)){const candidate=current?current+' '+word:word;if(face.widthOfTextAtSize(candidate,size)>maxWidth&&current){lines.push(current);current=word;}else current=candidate;}if(current)lines.push(current);if(lines.length>maxLines){const kept=lines.slice(0,maxLines);let last=kept[maxLines-1];while(face.widthOfTextAtSize(last+'…',size)>maxWidth&&last.length)last=last.slice(0,-1);kept[maxLines-1]=last.trimEnd()+'…';return kept;}return lines;}
  const fits=(size,lines)=>wrap(name,size,bold,width,lines).join(' ')===name;
  const nameSize=[16,14,12].find(size=>fits(size,2))||11,nameLines=wrap(name,nameSize,bold,width,nameSize===11?3:2);
  const who=printable(preparedBy||batchPreparedBy(batch)||'Not specified');
  const useBy=useByMoment(batch,useByDays),useByText=useBy?printable(formatUseBy(useBy)):null;
  const fields=[['PREPARED',formatMoment(batchMoment(batch))],['BY',who]];
  const addressLines=(address||[]).map(printable).filter(Boolean),noticeText=printable(notice||'');
  const LOGO_W=54,LOGO_H=logo?logo.height/logo.width*LOGO_W:0,ADDRESS=6.8,HEADER=Math.max(LOGO_H,addressLines.length*(ADDRESS+2.5));
  const LABEL=6.5,VALUE=9.5,ROW=VALUE+4,LABEL_W=42,NUMBER=7.5,TEXT=7.5,NOTICE_H=noticeText?14:0,BOX_H=25,MIN_GAP=4;
  const headerHeight=HEADER?HEADER+6:0;
  const topHeight=headerHeight+nameLines.length*nameSize*1.12+3+NUMBER+6;
  const blocks=BOX_H+fields.length*ROW+NOTICE_H,gaps=1+fields.length+(noticeText?2:1);
  // The barcode takes the height that is left, between 26 and 48 pt.
  const BAR_H=Math.max(26,Math.min(48,H-M*2-topHeight-blocks-gaps*MIN_GAP-TEXT-2)),barTop=H-M-TEXT-2-BAR_H;
  for(const row of rows){
    const page=pdf.addPage([W,H]);
    const draw=(value,x,top,size,face=font,color=gray)=>page.drawText(printable(value),{x,y:H-top-size,size,font:face,color});
    const rule=(top,thickness=.6,color=light,x=M,w=width)=>page.drawRectangle({x,y:H-top-thickness,width:w,height:thickness,color});
    let y=M;
    if(HEADER){
      if(logo)page.drawImage(logo,{x:M,y:H-y-LOGO_H,width:LOGO_W,height:LOGO_H});
      const block=addressLines.length*(ADDRESS+2.5)-2.5;let ay=y+(HEADER-block)/2;
      for(const line of addressLines){draw(line,W-M-font.widthOfTextAtSize(line,ADDRESS),ay,ADDRESS,font,ink);ay+=ADDRESS+2.5;}
      y+=HEADER+3;rule(y);y+=3;
    }
    for(const line of nameLines){draw(line,M,y,nameSize,bold,ink);y+=nameSize*1.12;}
    y+=3;
    draw('LOT '+row.number.replace(/^BATCH-/,''),M,y,NUMBER,bold,gray);y+=NUMBER+6;
    rule(y);
    // Spread the use-by box, rows and notice evenly between the divider and the barcode.
    const gap=Math.max(MIN_GAP,(barTop-y-blocks)/gaps);
    y+=gap;
    page.drawRectangle({x:M,y:H-y-BOX_H,width,height:BOX_H,borderColor:ink,borderWidth:1.4});
    draw('USE BY',M+6,y+(BOX_H-7.5)/2,7.5,bold,ink);
    const boxX=M+44,boxW=width-44-6;
    if(useByText){const size=Math.min(13,13*boxW/bold.widthOfTextAtSize(useByText,13));draw(useByText,boxX+boxW-bold.widthOfTextAtSize(useByText,size),y+(BOX_H-size)/2+.5,size,bold,ink);}
    else rule(y+BOX_H-7,.8,ink,boxX,boxW);
    y+=BOX_H+gap;
    for(const [label,value] of fields){
      draw(label,M,y+(VALUE-LABEL)-.5,LABEL,bold,gray);
      draw(wrap(value,VALUE,font,width-LABEL_W,1)[0]||'',M+LABEL_W,y,VALUE,font,ink);
      y+=ROW+gap;
    }
    if(noticeText){
      page.drawRectangle({x:M,y:H-y-NOTICE_H,width,height:NOTICE_H,color:ink});
      const size=Math.min(7.5,7.5*(width-8)/bold.widthOfTextAtSize(noticeText,7.5));
      draw(noticeText,(W-bold.widthOfTextAtSize(noticeText,size))/2,y+(NOTICE_H-size)/2+.6,size,bold,white);
    }
    // Quiet zones of at least ten modules on each side keep the symbol scannable.
    const {bars,width:modules}=code128Bars(row.code),scale=width/(modules+20),x0=M+scale*10;
    for(const bar of bars)page.drawRectangle({x:x0+bar.x*scale,y:H-barTop-BAR_H,width:bar.width*scale,height:BAR_H,color:ink});
    draw(row.text,(W-font.widthOfTextAtSize(row.text,TEXT))/2,barTop+BAR_H+2,TEXT,font,ink);
  }
  pdf.setTitle('Hot Doogy - Prep labels '+rows[0]?.batchNumber);pdf.setAuthor('Hot Doogy');pdf.setSubject('Prep batch labels, 2.4 x 3.5 in, one label per page');
  return pdf.save();
}
export async function downloadPrepLabelsPdf(batch,rows,options={}){
  const response=await fetch('/brand/hot-doogy-label-logo.png');
  if(!response.ok)throw Error('Logo unavailable.');
  const bytes=await createPrepLabelsPdf(batch,rows,{...options,logoBytes:await response.arrayBuffer()});
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const a=document.createElement('a');a.href=url;a.download=labelFilename(batch);
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
