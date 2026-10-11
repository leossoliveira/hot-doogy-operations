export const countMoments=[
  {value:'Antes da abertura',label:'Before opening'},
  {value:'Durante a operação',label:'During business hours'},
  {value:'Após o fechamento',label:'After closing'},
];
// Date-only values must not shift with the browser's time zone.
export function usDate(value){
  const match=String(value??'').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match?`${match[2]}/${match[3]}/${match[1]}`:'—';
}
export function usTime(value){
  const match=String(value??'').match(/^(\d{2}):(\d{2})/);
  if(!match)return '';
  const hour=Number(match[1]);
  return `${hour%12||12}:${match[2]} ${hour<12?'AM':'PM'}`;
}

// Format date tokens in display text while leaving stored date keys unchanged.
export const usDateText=value=>String(value??'').replace(/\b\d{4}-\d{2}-\d{2}\b/g,usDate);
