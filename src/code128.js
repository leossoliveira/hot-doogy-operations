// Code 128 symbol encoder (ISO/IEC 15417). Pure function: returns bar/space widths for drawing.
const PATTERNS=['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
const START_B=104,START_C=105,CODE_B=100,CODE_C=99,STOP=106;
export const code128Patterns=PATTERNS;
const isDigit=c=>c>='0'&&c<='9';
function digitRun(value,index){let n=0;while(index+n<value.length&&isDigit(value[index+n]))n++;return n;}
// Returns the symbol values (start, data, check digit, stop) using sets B and C with the usual digit-pair optimization.
export function code128Values(value){
  const text=String(value??'');
  if(!text.length||text.length>80)throw Error('Barcode value must have 1 to 80 characters.');
  for(const c of text){const code=c.charCodeAt(0);if(code<32||code>126)throw Error('Barcode value must use printable ASCII characters.');}
  const values=[];let set,i=0;
  const run=digitRun(text,0);
  if(run===text.length&&run%2===0||run>=4){set='C';values.push(START_C);}else{set='B';values.push(START_B);}
  while(i<text.length){
    const remaining=digitRun(text,i);
    if(set==='C'){
      if(remaining>=2){values.push(Number(text.slice(i,i+2)));i+=2;continue;}
      set='B';values.push(CODE_B);continue;
    }
    if(remaining>=4||(remaining>=2&&i+remaining===text.length&&remaining%2===0)){set='C';values.push(CODE_C);continue;}
    values.push(text.charCodeAt(i)-32);i++;
  }
  const check=values.reduce((sum,v,index)=>sum+v*Math.max(1,index),0)%103;
  values.push(check,STOP);
  return values;
}
// Alternating bar/space module widths, starting with a bar. Includes the stop pattern's final bar.
export function code128Modules(value){
  return code128Values(value).flatMap(v=>Array.from(PATTERNS[v],Number));
}
// Bars only, as {x,width} in module units, for drawing with rectangles.
export function code128Bars(value){
  const modules=code128Modules(value),bars=[];let x=0;
  modules.forEach((width,index)=>{if(index%2===0)bars.push({x,width});x+=width;});
  return {bars,width:x};
}
