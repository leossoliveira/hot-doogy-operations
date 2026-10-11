import {norm} from './model.js';
import {resolveSupplierPrice,supplierItemWithEdits} from './supplier-model.js';

// Display current catalog prices in the invoice line's unit without rewriting historical totals.
export function invoiceCatalogPrice(line,invoice,catalog,local={}){
 const rows=(catalog?.items||[]).filter(row=>row.supplierId===invoice.supplierId);
 const matches=line.supplierItemId?rows.filter(row=>row.supplierItemId===line.supplierItemId):rows.filter(row=>row.itemId===(line.itemId||line.inventoryItemId));
 if(matches.length!==1)return null;
 const row=supplierItemWithEdits(matches[0],local),price=resolveSupplierPrice(row,invoice.locationId);
 if(price.amount==null)return null;
 const unit=row.units?.find(u=>u.id===price.unitId);
 const invoiceUnit=row.units?.find(u=>u.itemUnitId===line.itemUnitId||u.id===line.uomId);
 if(!unit)return null;
 if(unit.itemUnitId&&unit.itemUnitId===line.itemUnitId||unit.id&&unit.id===line.uomId)return price.amount;
 const sourceFactor=Number(unit.factor),targetFactor=Number(line.unitFactor??invoiceUnit?.factor);
 return sourceFactor>0&&Number.isFinite(sourceFactor)&&targetFactor>0&&Number.isFinite(targetFactor)?price.amount*targetFactor/sourceFactor:null;
}

export function filterInvoices(invoices,{status='all',supplier='all',start='',end='',query=''}={}){
 const search=norm(query),statuses=Array.isArray(status)?status:[status],suppliers=Array.isArray(supplier)?supplier:[supplier];
 return invoices.filter(invoice=>{
  const day=String(invoice.date||'').slice(0,10);
  return (statuses.includes('all')||statuses.some(value=>invoice.status===value))
   && (suppliers.includes('all')||suppliers.includes(invoice.supplierId))
   && (!start||(day&&day>=start))&&(!end||(day&&day<=end))
   && norm(`${invoice.supplierName||''} ${invoice.number||''}`).includes(search);
 });
}

export function compareInvoices(a,b,key='date',direction='desc'){
 if((a.status==='draft')!==(b.status==='draft'))return a.status==='draft'?-1:1;
 const av=a[key],bv=b[key];if(!av)return bv?1:0;if(!bv)return -1;
 return (direction==='asc'?1:-1)*String(av).localeCompare(String(bv))||String(a.id).localeCompare(String(b.id));
}
