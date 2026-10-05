// Use an isolated browser with fake auth responses; no real users or factors.
import {pathToFileURL,fileURLToPath} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectData,TABLES} from '../server/live-data.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const raw={};for(const t of TABLES)raw[t]=await readFile(`${root}/audits/cloud-integration-2026-10-05/fixtures/${t}.json`,'utf8').then(JSON.parse).catch(()=>[]);
const data=projectData(raw);data.meta.preparationSalesStatus='loading';data.preparationSales=null;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
 const page=await browser.newPage({viewport:{width:1365,height:1000}});let loggedIn=false,verified=false,enrolled=false,dataCalls=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const state=()=>({user:{email:'mfa-preview@example.invalid'},role:'admin',mfa:{required:!verified,verified,step:enrolled?'verify':'enroll',factors:enrolled?[{id:'test-factor',name:'Test phone'}]:[]}});
 await page.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname;let body,status=200;
  if(p==='/api/auth/session'){if(loggedIn)body=state();else{status=401;body={error:'Sign in.'};}}
  else if(p==='/api/auth/login'){loggedIn=true;verified=false;body=state();}
  else if(p==='/api/auth/mfa/enroll')body={id:'test-factor',qrCode:'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><text x="15" y="95" font-size="18">TEST PREVIEW</text><text x="15" y="120" font-size="12">No real enrollment</text></svg>').toString('base64'),secret:'TEST PREVIEW ONLY'};
  else if(p==='/api/auth/mfa/verify'){if(route.request().postDataJSON().code==='123456'){verified=true;enrolled=true;body=state();}else{status=400;body={error:'That code is invalid or expired. Enter a new code from your authenticator app.'};}}
  else if(p==='/api/auth/logout'){loggedIn=false;verified=false;body={ok:true};}
  else if(p==='/api/data'){dataCalls++;assert.equal(verified,true);body=data;}
  else if(p==='/api/photos')body={items:{},recipes:{}};
  else throw Error(p);
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(process.env.MFA_PREVIEW_URL||'http://127.0.0.1:4190/');
 await page.getByLabel('Email',{exact:true}).fill('mfa-preview@example.invalid');await page.getByLabel('Password',{exact:true}).fill('fixture-only');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Set up authenticator'}).waitFor();assert.equal(dataCalls,0);
 await page.getByRole('button',{name:'Set up authenticator'}).click();await page.locator('.mfa-qr').waitFor();
 assert.equal(await page.locator('.mfa-qr').evaluate(el=>el.complete&&el.naturalWidth>0),true);
 await page.screenshot({path:'/tmp/hot-doogy-mfa-enrollment.png',fullPage:true});
 await page.getByLabel('Verification code').fill('111111');await page.getByRole('button',{name:'Verify and enable'}).click();await page.getByText('That code is invalid or expired.',{exact:false}).waitFor();assert.equal(dataCalls,0);
 await page.reload();await page.getByRole('button',{name:'Set up authenticator'}).waitFor();assert.equal(dataCalls,0);
 await page.getByRole('button',{name:'Set up authenticator'}).click();await page.getByLabel('Verification code').fill('123456');await page.getByRole('button',{name:'Verify and enable'}).click();await page.locator('.sidebar').waitFor();assert.equal(dataCalls,1);
 loggedIn=true;verified=false;await page.reload();await page.getByRole('button',{name:'Verify and sign in'}).waitFor();assert.equal(dataCalls,1);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/hot-doogy-mfa-verification-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByRole('button',{name:'Back to sign in'}).click();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal(loggedIn,false);assert.deepEqual(errors,[]);
 console.log('Browser MFA passed: enrollment, QR render, invalid code, reload, successful verification, returning login, mobile layout, cancel/logout; workspace data never requested before verification.');
}finally{await browser.close();}
