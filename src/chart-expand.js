const expandIcon='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/></svg>';
const closeIcon='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
// Snapshot only the selected chart, preserving its filtered values and SVG tooltips.
export function expandChart(source,trigger){
 const popup=document.createElement('dialog');
 popup.className='chart-expanded-dialog';
 popup.setAttribute('aria-labelledby','expanded-chart-title');
 const title=source.querySelector('h2,h3')?.textContent||source.querySelector('svg[role="img"]')?.getAttribute('aria-label')||'Chart';
 const header=document.createElement('header');header.className='chart-expanded-header';
 const heading=document.createElement('h2');heading.id='expanded-chart-title';heading.textContent=title;
 const close=document.createElement('button');close.type='button';close.className='icon-btn';close.setAttribute('aria-label','Close expanded chart');close.innerHTML=closeIcon;
 header.append(heading,close);
 const body=document.createElement('div');body.className='chart-expanded-body';
 const chart=source.cloneNode(true);
 chart.classList.remove('chart-expandable');
 chart.querySelectorAll('.chart-expand-button,.panel-head,.report-analysis-heading,.report-chart-controls,.report-metric-toggle').forEach(el=>el.remove());
 body.append(chart);popup.append(header,body);document.body.append(popup);
 const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
 close.onclick=()=>popup.close();
 popup.addEventListener('keydown',event=>event.stopPropagation());
 popup.addEventListener('click',event=>{if(event.target===popup){const r=popup.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)popup.close();}});
 popup.addEventListener('close',()=>{popup.remove();document.body.style.overflow=previousOverflow;if(trigger.isConnected)trigger.focus();},{once:true});
 popup.showModal();close.focus();
}
export function enhanceChartExpansion(){
 for(const svg of document.querySelectorAll('svg.report-chart-svg,svg.sales-chart,svg[aria-label^="Invoice price history"]')){
  if(svg.closest('.chart-expanded-dialog'))continue;
  const source=svg.closest('.report-chart,.report-analysis,.chart-panel')||svg.parentElement;
  if(source.querySelector('.chart-expand-button'))continue;
  source.classList.add('chart-expandable');
  const button=document.createElement('button');button.type='button';button.className='icon-btn chart-expand-button';
  const title=source.querySelector('h2,h3')?.textContent||svg.getAttribute('aria-label')||'Chart';
  button.setAttribute('aria-label',`Expand chart: ${title}`);button.title='Expand chart';button.setAttribute('aria-haspopup','dialog');button.innerHTML=expandIcon;
  button.onclick=()=>expandChart(source,button);source.append(button);
 }
}
