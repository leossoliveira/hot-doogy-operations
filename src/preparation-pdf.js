import {usDate} from './locale.js';
export const preparationPdfColumns=planning=>planning?
 [{id:'item',label:'Prep item / Unit'},{id:'current',label:'Reference usage'},{id:'margin',label:'Safety margin'},{id:'demand',label:'Planned demand'},{id:'stock',label:'Last count at destination'},{id:'qty',label:'Qty. to produce / ship'}]:
 [{id:'item',label:'Prep item / Unit'},{id:'current',label:'Current period'},{id:'previous',label:'Previous period'},{id:'variation',label:'Change'}];
export async function createPreparationPdf({rows,start,end,previousStart,previousEnd,location,planning=false,delivery,referenceStart,referenceEnd,columns}){
 const selected=preparationPdfColumns(planning).filter(c=>columns==null||columns.includes(c.id));
 if(!selected.length)throw Error('Select at least one column.');
 const {PDFDocument,StandardFonts,rgb}=await import('./vendor/pdf-lib.esm.min.js');
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const ink=rgb(.15,.17,.14),muted=rgb(.4,.43,.38);let page,y;const width=planning?792:612,height=planning?612:792;
 const weight=selected.reduce((sum,c)=>sum+(c.id==='item'?3:1),0);let columnX=36;const layout=selected.map(c=>{const w=(width-72)*(c.id==='item'?3:1)/weight;const result={...c,x:columnX,width:w};columnX+=w;return result;});
 const safe=v=>Array.from(String(v??'')).map(c=>{try{font.encodeText(c);return c;}catch{return '?';}}).join('');
 const text=(v,x,top,size=10,face=font)=>page.drawText(safe(v),{x,y:height-top-size,size,font:face,color:ink});
 const wrap=(v,width,face=font)=>{const out=[];let line='';for(const word of safe(v).split(/\s+/)){const joined=line?line+' '+word:word;if(face.widthOfTextAtSize(joined,10)<=width){line=joined;continue;}if(line){out.push(line);line='';}for(const char of word){if(line&&face.widthOfTextAtSize(line+char,10)>width){out.push(line);line='';}line+=char;}}out.push(line);return out;};

 function newPage(){
  page=pdf.addPage([width,height]);text(planning?'HOT DOOGY | Prep planning':'HOT DOOGY | Prep usage',36,32,16,bold);
  const lines=wrap(location,540);lines.forEach((line,i)=>text(line,36,60+i*14));y=64+lines.length*14;
  text((planning?'Coverage: ':'Period: ')+usDate(start)+' - '+usDate(end),36,y);y+=17;
  if(planning&&referenceStart){text('Sales reference: '+usDate(referenceStart)+' - '+usDate(referenceEnd),36,y);y+=17;}
  text(planning?'Delivery Date: '+usDate(delivery):'Compared with: '+usDate(previousStart)+' - '+usDate(previousEnd),36,y);y+=28;
  let headerHeight=0;for(const c of layout){const lines=wrap(c.label.toUpperCase(),c.width-12,bold);lines.forEach((line,i)=>text(line,c.x,y+i*14,9,bold));headerHeight=Math.max(headerHeight,lines.length*14);}y+=headerHeight+12;
 }
 const quantity=v=>v==null?'Unavailable':Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 newPage();
 for(const r of rows){
  const cells=layout.map(c=>{let value=r[c.id];if(c.id==='item')return {...c,lines:wrap(r.name,c.width-12,bold),unit:wrap(r.uom,c.width-12)};
   value=c.id==='variation'?(value==null?'N/A':(value>0?'+':'')+value.toFixed(1)+'%'):c.id==='margin'?(value==null?'N/A':value+'%'):planning&&c.id==='qty'?(value==null||value===''?'Unavailable':Math.ceil(Math.max(0,Number(value))).toLocaleString('en-US')):quantity(value===''?null:value);
   return {...c,lines:wrap(value,c.width-12),unit:[]};});
  const rowHeight=Math.max(...cells.map(c=>(c.lines.length+c.unit.length)*14))+15;
  if(y+rowHeight>height-52)newPage();
  for(const c of cells){c.lines.forEach((line,i)=>text(line,c.x,y+i*14,10,c.id==='item'?bold:font));c.unit.forEach((line,i)=>text(line,c.x,y+(c.lines.length+i)*14,9));}
  y+=rowHeight;page.drawLine({start:{x:36,y:height-y+7},end:{x:width-36,y:height-y+7},thickness:.4,color:rgb(.85,.87,.83)});
 }
 if(!rows.length)text('No prep items match the selected filters.',36,y);
 pdf.getPages().forEach((p,i)=>p.drawText('Page '+(i+1)+' of '+pdf.getPageCount(),{x:width-112,y:22,size:9,font,color:muted}));
 return pdf.save();
}
export async function downloadPreparationPdf(report){
 const bytes=await createPreparationPdf(report),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),a=document.createElement('a');
 a.href=url;a.download='Hot-Doogy-Prep-'+(report.planning?'Planning':'Usage')+'-'+report.start+'-'+report.end+'.pdf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
