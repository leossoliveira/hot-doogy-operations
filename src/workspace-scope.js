const rank={bootstrap:0,catalog:1,full:2};
export function scopeCovers(loaded,required){return rank[loaded??'full']>=rank[required];}
export function routeScope(route,{overviewExpanded=false}={}){
 if(route==='overview')return overviewExpanded?'full':'bootstrap';
 if(route==='settings'||route==='my-day'||route.startsWith('my-day-'))return 'bootstrap';
 if(route==='suppliers')return 'catalog';
 return 'full';
}
export function refreshScope(loaded,required){return scopeCovers(loaded,required)?loaded??'full':required;}
