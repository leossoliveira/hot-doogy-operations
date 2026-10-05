import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createAuth} from '../server/auth.mjs';
import {clientAddress,createLoginLimits} from '../server/login-limits.mjs';

test('proxy headers require explicit trust and a loopback peer; spoofed chains are ignored',()=>{
 const req=(peer,ip)=>({socket:{remoteAddress:peer},headers:{'x-real-ip':ip}});
 assert.equal(clientAddress(req('127.0.0.1','198.51.100.1'),true),'198.51.100.1');
 assert.equal(clientAddress(req('127.0.0.1','198.51.100.1')),'127.0.0.1');
 assert.equal(clientAddress(req('203.0.113.1','198.51.100.1'),true),'203.0.113.1');
 assert.equal(clientAddress(req('127.0.0.1','198.51.100.1, 203.0.113.1'),true),'127.0.0.1');
});
test('failures behind Nginx do not block a different client or account',async()=>{
 let calls=0;const auth=createAuth({trustProxy:true,fetcher:async()=>{calls++;return {ok:false,status:401,json:async()=>({})};}});
 async function login(ip,email='one@example.invalid'){
  const req=Readable.from([Buffer.from(JSON.stringify({email,password:'invalid-test-only'}))]);
  req.socket={remoteAddress:'127.0.0.1'};req.headers={'x-real-ip':ip};req.method='POST';
  try{await auth.handle(req,{},new URL('http://localhost/api/auth/login'));}catch(e){return e.status;}
 }
 for(let i=0;i<20;i++)assert.equal(await login('198.51.100.1'),401);
 assert.equal(await login('198.51.100.1'),429);
 assert.equal(await login('198.51.100.2'),401);
 assert.equal(await login('198.51.100.1','two@example.invalid'),401);
 assert.equal(calls,22);
});
test('rotating account names cannot bypass the address budget; normalized names share a budget',()=>{
 const limits=createLoginLimits();
 for(let i=0;i<100;i++)assert.equal(limits.allowAddress('198.51.100.1'),true);
 assert.equal(limits.allowAddress('198.51.100.1'),false);
 assert.equal(limits.allowAddress('198.51.100.2'),true);
 for(let i=0;i<20;i++)assert.equal(limits.allowAccount('ip','One@example.invalid'),true);
 assert.equal(limits.allowAccount('ip',' one@example.invalid '),false);
 limits.clearAccount('ip','one@example.invalid');assert.equal(limits.allowAccount('ip','one@example.invalid'),true);
});
test('limits expire and the number of stored keys is bounded',()=>{
 let now=0;const limits=createLoginLimits({now:()=>now,maxKeys:2});
 assert.equal(limits.allowAddress('a'),true);assert.equal(limits.allowAddress('b'),true);assert.equal(limits.allowAddress('c'),false);
 now=900000;assert.equal(limits.allowAddress('c'),true);
});
