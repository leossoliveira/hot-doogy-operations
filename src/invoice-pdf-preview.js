// PDF.js 6.4.299 is vendored locally: no invoice bytes leave the browser.
export async function renderInvoicePdf(container,file){
 let task,pdf,pageNumber=1,rendering=false;
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Loading PDF…';container.replaceChildren(status);
 try{
  const {getDocument,GlobalWorkerOptions}=await import('./vendor/pdfjs/pdf.min.mjs');
  GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs',import.meta.url).href;
  task=getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/pdfjs/wasm/',import.meta.url).href});
  pdf=await task.promise;if(!container.isConnected){await pdf.destroy();return;}
  const controls=document.createElement('div');controls.className='invoice-pdf-controls';
  const previous=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span'),canvas=document.createElement('canvas');
  previous.type=next.type='button';previous.className=next.className='btn';previous.textContent='Previous';next.textContent='Next';canvas.setAttribute('role','img');
  controls.append(previous,label,next);container.replaceChildren(controls,status,canvas);
  async function render(){if(rendering)return;rendering=true;previous.disabled=next.disabled=true;status.textContent='Loading page…';try{const page=await pdf.getPage(pageNumber),base=page.getViewport({scale:1}),width=Math.max(280,container.clientWidth-16),viewport=page.getViewport({scale:Math.min(2,width/base.width)*(Math.min(window.devicePixelRatio||1,2))});canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.setAttribute('aria-label',`Invoice page ${pageNumber} of ${pdf.numPages}`);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;label.textContent=`${pageNumber} / ${pdf.numPages}`;status.textContent='';}catch{status.textContent='Unable to display this page. Use Open original.';}finally{rendering=false;previous.disabled=pageNumber<=1;next.disabled=pageNumber>=pdf.numPages;}}
  previous.onclick=()=>{pageNumber--;void render();};next.onclick=()=>{pageNumber++;void render();};await render();
  const observer=new MutationObserver(()=>{if(!container.isConnected){observer.disconnect();void task.destroy();}});observer.observe(document.body,{childList:true,subtree:true});
 }catch(error){console.warn('PDF preview:',error.message);status.textContent='Unable to display this PDF. Use Open original to view or download it.';await task?.destroy();}
}
