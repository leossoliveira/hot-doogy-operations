// Overview and catalog are independent partial datasets; neither covers the other.
export function scopeCovers(loaded,required){const scope=loaded??'full';return scope==='full'||scope===required||required==='bootstrap'&&['overview','catalog','bootstrap'].includes(scope);}
export function routeScope(route){
 if(route==='overview')return 'overview';
 if(route==='settings'||route==='my-day'||route.startsWith('my-day-'))return 'bootstrap';
 if(route==='suppliers')return 'catalog';
 return 'full';
}
export function refreshScope(loaded,required){return scopeCovers(loaded,required)?loaded??'full':required;}
