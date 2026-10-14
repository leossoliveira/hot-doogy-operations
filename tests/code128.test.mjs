import test from 'node:test';
import assert from 'node:assert/strict';
import {code128Patterns,code128Values,code128Modules,code128Bars} from '../src/code128.js';

test('symbol table has 107 patterns of 11 modules plus a 13-module stop',()=>{
  assert.equal(code128Patterns.length,107);
  code128Patterns.forEach((p,i)=>assert.equal(Array.from(p,Number).reduce((a,b)=>a+b,0),i===106?13:11,`pattern ${i}`));
});
test('all-digit values use set C with the documented check digit',()=>{
  // Start C (105), pairs 26 10 13 48 29 13 03; check = (105 + 26*1 + 10*2 + 13*3 + 48*4 + 29*5 + 13*6 + 3*7) mod 103
  const values=code128Values('26101348291303');
  assert.deepEqual(values,[105,26,10,13,48,29,13,3,(105+26+20+39+192+145+78+21)%103,106]);
  assert.equal(code128Modules('26101348291303').length,10*6+1);
});
test('mixed text starts in set B and switches to set C for long digit runs',()=>{
  const values=code128Values('BATCH-261013-48291');
  assert.equal(values[0],104);
  assert.ok(values.includes(99),'switches to C');
  assert.equal(values.at(-1),106);
  const data=values.slice(1,-2);
  assert.equal(data.filter(v=>v!==99&&v!==100).length,'BATCH-'.length+3+'-'.length+1+2);
  assert.deepEqual(code128Values('A'),[104,33,(104+33)%103,106]);
});
test('bars alternate from the first module and cover the full width',()=>{
  const {bars,width}=code128Bars('12');
  assert.equal(bars[0].x,0);
  assert.equal(width,11*4+2);
  assert.ok(bars.every(b=>b.width>=1&&b.width<=4));
});
test('rejects empty, oversized and non-ASCII values',()=>{
  assert.throws(()=>code128Values(''));
  assert.throws(()=>code128Values('x'.repeat(81)));
  assert.throws(()=>code128Values('Açaí'));
});
