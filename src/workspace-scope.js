// Overview and catalog are independent partial datasets; neither covers the other.
export function scopeCovers(loaded,required){const scope=loaded??'full';return scope==='full'||scope===required||scope==='operations'&&['overview','catalog','bootstrap'].includes(required)||required==='bootstrap'&&['overview','catalog','bootstrap'].includes(scope);}
export function routeScope(route){
 if(route==='overview')return 'overview';
 if(route==='settings'||route==='my-day'||route.startsWith('my-day-'))return 'bootstrap';
 if(['inventory','invoices','purchases','purchase-planning','report-supplier-usage','recipes','prices','transfers','preparation','waste'].includes(route))return 'operations';
 if(route==='suppliers')return 'catalog';
 return 'full';
}
export function refreshScope(loaded,required){return scopeCovers(loaded,required)?loaded??'full':required;}
