import {periodWindow,shiftDay,isQuantity} from './preparation-model.js';

// Whole-week shifts preserve weekdays and the inclusive coverage duration.
export function planningReferenceOptions({start,end,today,latestSaleDate,count=8}){
 periodWindow(start,end);periodWindow(today,today);
 const yesterday=shiftDay(today,-1),cutoff=latestSaleDate&&latestSaleDate<yesterday?latestSaleDate:yesterday;
 const first=Math.max(1,Math.ceil((Date.parse(end)-Date.parse(cutoff))/(7*86400000)));
 return Array.from({length:count},(_,index)=>{
  const weeks=first+index;return {weeks,start:shiftDay(start,-7*weeks),end:shiftDay(end,-7*weeks)};
 });
}
export function validatePlanningReference(coverage,reference,today){
 const planned=periodWindow(coverage.start,coverage.end),past=periodWindow(reference.start,reference.end);
 if(past.days!==planned.days)throw Error(`Choose a reference period with ${planned.days} days, matching the coverage period.`);
 if(reference.end>=today)throw Error('Choose a completed historical period ending before today.');
 return reference;
}
export const roundProductionUp=value=>isQuantity(value)?Math.ceil(Math.max(0,Number(value))):null;
