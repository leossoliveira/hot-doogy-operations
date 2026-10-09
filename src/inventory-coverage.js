import {measure} from './preparation-sales.js';
import {periodWindow,shiftDay} from './preparation-model.js';

// Sales identify a store, not the storage area from which an item was taken.
export function inventoryCoverage(item,stock,source,batches,today){
 const unknown=reason=>({days:null,reason});
 if(stock.qty==null||stock.partial||!Number.isFinite(Number(stock.qty)))return unknown('Complete stock quantity unavailable');
 if(!source)return unknown('Sales usage unavailable');
 const end=(source.days||[]).filter(d=>d.locationId===item.locationId&&d.date<today).map(d=>d.date).sort().at(-1);
 if(!end)return unknown('Sales history unavailable');
 const start=shiftDay(end,-6),window=periodWindow(start,end);
 if(!(source.rows||[]).some(r=>r.itemId===item.id&&r.locationId===item.locationId&&r.date>=start&&r.date<=end))return unknown('No calculated usage for this item');
 const usage=measure(item,[item.locationId],window,source,batches);
 if(usage.qty==null||!Number.isFinite(usage.qty)||usage.qty<0)return unknown('Incomplete sales history');
 if(usage.qty===0)return unknown('No consumption in this period');
 return {days:Math.max(0,Number(stock.qty))/(usage.qty/7),start,end,partial:!!usage.partial};
}
