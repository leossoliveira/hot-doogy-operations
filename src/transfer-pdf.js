const statuses={draft:'Draft',approved:'Approved',dispatched:'Dispatched',in_progress:'In progress',completed:'Completed',received:'Received',cancelled:'Cancelled'};
const present=value=>value!==null&&value!==undefined&&value!=='';
export const transferReference=x=>String(x.number||String(x.id||'').slice(0,7).toUpperCase()||'Transfer');
export const transferFilename=x=>`Hot-Doogy-Transfer-${transferReference(x).replace(/[^a-z0-9_-]/gi,'-')}.pdf`;
export function transferPrintLines(transfer,items=[]){
  return (transfer.lines||[]).map(line=>{
    const item=items.find(i=>i.id===(line.itemId||line.inventoryItemId)&&i.locationId===transfer.fromLocationId);
    const value=line.requestedQuantity??line.quantity??line.qty;
    return [line.sku??item?.sku??'',present(value)?Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'Not provided',line.uomName||line.uom||'',line.internalNameSnapshot||line.name||line.itemName||line.internalName||item?.name||'Not provided',line.brand??item?.brand??''];
  });
}
function formatDate(value,withTime=false){
  if(!value)return 'Not provided';
  const date=new Date(String(value).length===10?value+'T12:00:00Z':value);
  if(!Number.isFinite(date.getTime()))return 'Not provided';
  return new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',day:'2-digit',month:'short',year:'numeric',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})}).format(date);
}

// Generated in the browser; no upload, database write or inventory movement.
export async function createTransferPdf(transfer,{logoBytes,items=[],locations=[]}={}){
  const {PDFDocument,StandardFonts,rgb}=await import('./vendor/pdf-lib.esm.min.js');
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo=await pdf.embedPng(logoBytes);
  const W=595.28,H=841.89,M=36,bottom=H-43,width=W-M*2;
  const ink=rgb(.13,.14,.13),gray=rgb(.36,.38,.37),lineColor=rgb(.81,.82,.81),yellow=rgb(.996,.808,.027);
  let page,y;
  const printable=value=>Array.from(String(value??'').normalize('NFC')).map(c=>{if(c==='\n')return c;if(c==='\t')return ' ';try{font.encodeText(c);return c;}catch{return '?';}}).join('');
  const draw=(value,x,top,size=10,face=font,color=gray)=>page.drawText(printable(value),{x,y:H-top-size,size,font:face,color});
  function wrap(value,maxWidth,size=10,face=font){
    const lines=[];
    for(const paragraph of printable(value).split('\n')){
      let current='';
      for(const word of paragraph.split(/\s+/).filter(Boolean)){
        if(current&&face.widthOfTextAtSize(current+' '+word,size)>maxWidth){lines.push(current);current='';}
        for(const char of word){
          const candidate=current+char;
          if(face.widthOfTextAtSize(candidate,size)>maxWidth&&current){lines.push(current);current='';}
          current+=char;
        }
        current+=' ';
      }
      lines.push(current.trimEnd());
    }
    return lines;
  }
  function newPage(continuation=false){
    page=pdf.addPage([W,H]);y=M;
    if(continuation){draw('HOT DOOGY | Internal Transfer '+transferReference(transfer),M,y,10,bold,ink);y+=26;}
  }
  function ensure(height){if(y+height>bottom)newPage(true);}
  function field(label,value){
    const lines=wrap(value,width-105,10);ensure(lines.length*14+4);
    draw(label,M,y,10,bold);
    for(const text of lines){draw(text,M+105,y);y+=14;}
    y+=2;
  }
  function callout(title,content,color){
    const lines=wrap(content,width-20,10);
    let offset=0;
    while(offset<lines.length){
      ensure(48);
      const count=Math.min(lines.length-offset,Math.floor((bottom-y-29)/14));
      const height=29+count*14;
      page.drawRectangle({x:M,y:H-y-height,width:3,height,color});
      draw(title+(offset?' (continued)':''),M+15,y+7,10,bold);
      for(let i=0;i<count;i++)draw(lines[offset+i],M+15,y+25+i*14,10);
      y+=height+10;offset+=count;
    }
  }
  newPage();
  const logoW=128,logoH=logo.height/logo.width*logoW;
  page.drawImage(logo,{x:(W-logoW)/2,y:H-y-logoH-3,width:logoW,height:logoH});
  y+=logoH+28;
  draw('Order from Hot Doogy',M,y,16,font,ink);y+=27;
  const from=locations.find(l=>l.id===transfer.fromLocationId);
  field('Order:',transferReference(transfer));
  field('From:',transfer.fromLocationName||from?.name||'Not provided');
  field('Deliver to:',transfer.toLocationName||'Not provided');
  if(from?.address)field('Address:',from.address);
  if(from?.phone)field('Phone:',from.phone);
  field('Created on:',formatDate(transfer.createdAt,true));
  field('Status:',statuses[transfer.dbStatus??transfer.status]||transfer.dbStatus||transfer.status||'Not provided');
  y+=6;
  callout('Delivery Date','Please deliver on '+formatDate(transfer.date||transfer.neededOn),gray);
  if(transfer.notes)callout('Note',transfer.notes,yellow);
  const widths=[62,55,66,265,75.28],headers=['Code','Quantity','UOM','Product Description','Brand'];
  function tableHeader(){
    ensure(46);draw('Order Items',M,y,12,font,ink);y+=19;
    let x=M;
    headers.forEach((text,i)=>{page.drawRectangle({x,y:H-y-22,width:widths[i],height:22,borderWidth:.6,borderColor:gray});draw(text,x+5,y+5,9,bold,ink);x+=widths[i];});
    y+=22;
  }
  tableHeader();
  const lines=transferPrintLines(transfer,items);
  for(const row of lines){
    const columns=row.map((value,i)=>wrap(value,widths[i]-10,9));
    let offset=0,max=Math.max(...columns.map(c=>c.length));
    while(offset<max){
      if(y+19>bottom){newPage(true);tableHeader();}
      const count=Math.min(max-offset,Math.floor((bottom-y-8)/11));
      const height=Math.max(19,count*11+8);
      let x=M;
      columns.forEach((texts,i)=>{
        page.drawRectangle({x,y:H-y-height,width:widths[i],height,borderWidth:.4,borderColor:lineColor});
        texts.slice(offset,offset+count).forEach((text,j)=>draw(text,x+5,y+4+j*11,9));x+=widths[i];
      });
      y+=height;offset+=count;
    }
  }
  if(!lines.length){draw('No items registered.',M+5,y+8);y+=28;}
  pdf.getPages().forEach((p,index)=>{
    page=p;
    draw('HOT DOOGY | Internal Transfer',M,H-28,8);
    draw(`${index+1} / ${pdf.getPageCount()}`,W-M-30,H-28,8);
  });
  pdf.setTitle('Hot Doogy - Internal Transfer '+transferReference(transfer));
  pdf.setAuthor('Hot Doogy');pdf.setSubject('Internal transfer order - requested quantities');
  return pdf.save();
}

export async function downloadTransferPdf(transfer,options={}){
  const response=await fetch('/brand/hot-doogy-print.png');
  if(!response.ok)throw Error('Logo indisponível.');
  const bytes=await createTransferPdf(transfer,{...options,logoBytes:await response.arrayBuffer()});
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const a=document.createElement('a');a.href=url;a.download=transferFilename(transfer);
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
