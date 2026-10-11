import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationService,sanitizeHistory,conversationSettings,buildSettingsPatch} from '../server/doogy-chat.mjs';
const session={channel:'whatsapp',key:'agent:main:whatsapp:group:123@g.us',kind:'group',origin:{to:'123@g.us',accountId:'default'}};
const config={hash:'version-one',config:{channels:{whatsapp:{groups:{'*':{systemPrompt:'Default context'},'123@g.us':{systemPrompt:'Existing',requireMention:false,tools:{deny:['exec']}}}}}}};
const id='default:123@g.us',requestId='11111111-1111-4111-8111-111111111111';
test('history exposes conversation text, never tools, reasoning or message internals',()=>{
 const h=sanitizeHistory({messages:[{role:'toolResult',content:'SECRET'},{role:'assistant',content:[{type:'thinking',text:'PRIVATE'},{type:'toolCall',arguments:'SECRET'},{type:'text',text:'Visible'}],timestamp:1,__openclaw:{id:'a',secret:'PRIVATE'}},{role:'user',content:'Hello'},{role:'assistant',content:'NO_REPLY'}],hasMore:true,nextOffset:100});
 assert.deepEqual(h.messages.map(m=>m.text),['Visible','Hello']);assert.doesNotMatch(JSON.stringify(h),/SECRET|PRIVATE|NO_REPLY/);assert.equal(h.nextOffset,100);
});
test('conversation resolution rejects non-admin users and forged conversations before reads or sends',async()=>{
 const calls=[];const service=createConversationService(async(m,p)=>{calls.push(m);return {sessions:[session,{channel:'webchat',origin:{to:'other'},key:'private'}]};});
 await assert.rejects(service.history('staff',id),/administrators/);assert.equal(calls.length,0);
 await assert.rejects(service.history('owner','default:other'),/not found/);assert.ok(!calls.includes('chat.history'));
 await assert.rejects(service.history('owner',id,-1),/history page/);
});
test('settings patch changes only the selected chat, preserves tool rules and detects stale settings',()=>{
 const settings=conversationSettings(config,session);const patch=buildSettingsPatch(settings,{version:'version-one',prompt:"Context ' $(bad)",requireMention:true});
 assert.deepEqual(JSON.parse(patch.raw),{channels:{whatsapp:{groups:{'123@g.us':{systemPrompt:"Context ' $(bad)",requireMention:true}}}}});
 assert.equal(settings.inheritedPrompt,'Default context');assert.throws(()=>buildSettingsPatch(settings,{version:'old',prompt:'new',requireMention:true}),/changed/);
 const direct=conversationSettings({hash:'v',config:{channels:{whatsapp:{accounts:{work:{direct:{'+15551234567':{systemPrompt:'DM'}}}}}}}},{kind:'direct',origin:{to:'+15551234567',accountId:'work'}});
 assert.deepEqual(direct.path,['channels','whatsapp','accounts','work','direct','+15551234567']);assert.equal(direct.prompt,'DM');
});
test('send binds the target to the directory and reuses gateway idempotency after uncertainty',async()=>{
 const calls=[];let failed=false;const service=createConversationService(async(method,params)=>{calls.push({method,params});if(method==='sessions.list')return {sessions:[session]};if(method==='send'&&!failed){failed=true;throw Error('Timeout');}return {messageId:'sent'};});
 const input={text:'Hello',requestId};await assert.rejects(service.send('admin','actor',id,input),/Timeout/);
 await assert.rejects(service.send('admin','actor',id,{...input,text:'Changed'}),/original message/);
 assert.equal((await service.send('admin','actor',id,input)).sent,true);await service.send('admin','actor',id,input);
 const sent=calls.filter(c=>c.method==='send');assert.equal(sent.length,2);assert.equal(sent[0].params.idempotencyKey,sent[1].params.idempotencyKey);assert.equal(sent[0].params.channel,'whatsapp');assert.equal(sent[0].params.to,'123@g.us');assert.equal(sent[0].params.sessionKey,session.key);
});
test('settings returned to the browser omit the global config and internal write path',async()=>{
 const service=createConversationService(async m=>m==='sessions.list'?{sessions:[session]}:{...config,raw:'SECRET',token:'SECRET'});
 const s=await service.settings('owner',id);assert.equal(s.prompt,'Existing');assert.doesNotMatch(JSON.stringify(s),/SECRET|"path"/);
});
