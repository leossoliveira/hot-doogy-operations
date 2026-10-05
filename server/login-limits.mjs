import {createHash} from 'node:crypto';
import {isIP} from 'node:net';

const loopback=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
export function clientAddress(req,trustProxy=false){
 const peer=req.socket.remoteAddress||'unknown',forwarded=req.headers['x-real-ip'];
 // Nginx overwrites this header. Never trust it from a direct remote client.
 return trustProxy&&loopback.has(peer)&&typeof forwarded==='string'&&isIP(forwarded)?forwarded:peer;
}

export function createLoginLimits({now=Date.now,windowMs=900000,maxKeys=10000}={}){
 const buckets=new Map();
 function take(key,limit){
  const time=now();
  for(const [id,bucket] of buckets)if(bucket.until<=time)buckets.delete(id);
  let bucket=buckets.get(key);
  if(!bucket){if(buckets.size>=maxKeys)return false;bucket={count:0,until:time+windowMs};buckets.set(key,bucket);}
  if(bucket.count>=limit)return false;
  bucket.count++;return true;
 }
 const accountKey=(ip,email)=>'account:'+ip+':'+createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
 return {
  allowAddress:ip=>take('ip:'+ip,100),
  allowAccount:(ip,email)=>take(accountKey(ip,email),20),
  clearAccount:(ip,email)=>buckets.delete(accountKey(ip,email))
 };
}
