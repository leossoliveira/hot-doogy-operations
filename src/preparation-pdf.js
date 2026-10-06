import {usDate} from './locale.js';
export async function createPreparationPdf({rows,start,end,previousStart,previousEnd,location,planning=false,delivery}){
 const {PDFDocument,StandardFonts,rgb}=await import('./vendor/pdf-lib.esm.min.js');
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const ink=rgb(.15,.17,.14),muted=rgb(.4,.43,.38);let page,y;const width=planning?792:612,height=planning?612:792;
 const safe=v=>Array.from(String(v??'')).map(c=>{try{font.encodeText(c);return c;}catch{return '?';}}).join('');
 const text=(v,x,top,size=10,face=font)=>page.drawText(safe(v),{x,y:height-top-size,size,font:face,color:ink});
 const wrap=(v,width,face=font)=>{const out=[];let line='';for(const c of safe(v)){if(face.widthOfTextAtSize(line+c,10)>width){out.push(line);line='';}line+=c;}out.push(line);return out;};
 function newPage(){
  page=pdf.addPage([width,height]);text(planning?'HOT DOOGY | Prep planning':'HOT DOOGY | Prep usage',36,32,16,bold);
  const lines=wrap(location,540);lines.forEach((line,i)=>text(line,36,60+i*14));y=64+lines.length*14;
  text('Period: '+usDate(start)+' - '+usDate(end),36,y);y+=17;
  text(planning?'Delivery Date: '+usDate(delivery):'Compared with: '+usDate(previousStart)+' - '+usDate(previousEnd),36,y);y+=28;
  (planning?['PREP ITEM / UNIT','USED','COUNT','MARGIN','DEMAND','NET','PRODUCE / SHIP']:['PREP ITEM / UNIT','CURRENT','PREVIOUS','CHANGE']).forEach((v,i)=>text(v,(planning?[36,260,335,410,470,550,640]:[36,315,405,505])[i],y,9,bold));y+=22;
 }
 const quantity=v=>v==null?'Unavailable':Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 newPage();
 for(const r of rows){
  const name=wrap(r.name,planning?205:255,bold),unit=wrap(r.uom,planning?205:260),rowHeight=(name.length+unit.length)*14+15;
  if(y+rowHeight>height-52)newPage();
  name.forEach((line,i)=>text(line,36,y+i*14,10,bold));
  unit.forEach((line,i)=>text(line,36,y+(name.length+i)*14,9));
  if(planning){[r.current,r.stock,r.margin,r.demand,r.net,r.qty===''?null:r.qty].forEach((v,i)=>text(i===2?(v==null?'N/A':v+'%'):quantity(v),[260,335,410,470,550,640][i],y,9));}else{
  text(quantity(r.current),315,y);text(quantity(r.previous),405,y);
  text(r.variation==null?'N/A':(r.variation>0?'+':'')+r.variation.toFixed(1)+'%',505,y);
  }
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
