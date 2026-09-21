import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, qualify } from '../lib/validation.js';
import { createHandler } from '../api/intake.js';
import { drain, secretEqual } from '../lib/pipeline.js';
const input={name:'Test Visitor',email:'TEST@example.com',company:'Example',role:'Business owner',projectType:'Lead response',challenge:'We manually copy inbound leads into the CRM every day.',tools:'Gmail',frequency:'Every day',budget:'$1,500–$5,000',timeline:'Within a month',consent:true,submissionId:'aece7a9a-12cf-46a5-9000-abcdef123456'};
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',RESEND_API_KEY:'re_test',EMAIL_FROM:'Test <test@example.com>',OWNER_EMAIL:'owner@example.com',RATE_LIMIT_SECRET:'x'.repeat(32),CRON_SECRET:'y'.repeat(32),ALLOWED_ORIGINS:'https://portfolio.example'};
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.data=data;return this;}};}
const req=body=>({method:'POST',headers:{origin:'https://portfolio.example','content-type':'application/json','x-real-ip':'192.0.2.1'},body});
test('normalizes email, strips unexpected keys, requires consent and valid enums',()=>{
 const result=validate({...input,score:100,route:'spoofed'});assert.equal(result.email,'test@example.com');assert.equal(result.score,undefined);
 for(const value of [{...input,consent:false},{...input,projectType:'Other value'},{...input,email:'invalid'},{...input,challenge:'too short'},{...input,submissionId:'not-a-uuid'}])assert.throws(()=>validate(value));
});
test('qualification keeps uncertain and career inquiries rather than rejecting them',()=>{
 assert.equal(qualify(input).score,100);assert.equal(qualify({...input,role:'Recruiter / hiring manager'}).route,'Career inquiry');
 assert.equal(qualify({...input,projectType:'Not sure yet',frequency:'New process',budget:'Need guidance',timeline:'Just exploring'}).route,'Scoping conversation');
});
test('fails closed without config and rejects foreign origins before contacting providers',async()=>{
 let called=false;const request=async()=>{called=true;throw Error();};
 let res=response();await createHandler({env:{},request})(req(input),res);assert.equal(res.code,503);
 res=response();await createHandler({env,request})({...req(input),headers:{...req(input).headers,origin:'https://attacker.example'}},res);assert.equal(res.code,403);assert.equal(called,false);
});
test('validation, honeypot, size and HTTP method do not reach storage',async()=>{
 const handler=createHandler({env,request:()=>{throw Error('Unexpected request');}});
 for(const [request,code] of [[{...req(input),method:'GET'},405],[req({...input,website:'spam'}),400],[req({...input,consent:false}),400],[req('bad json'),400],[req('x'.repeat(13000)),413]]){const res=response();await handler(request,res);assert.equal(res.code,code);}
});
test('database failure cannot display success',async()=>{
 const res=response();await createHandler({env,request:async()=>new Response('{}',{status:500})})(req(input),res);assert.equal(res.code,503);assert.equal(res.data.ok,undefined);
});
test('rate limit is returned explicitly',async()=>{
 const res=response();await createHandler({env,request:async()=>new Response(JSON.stringify({message:'RATE_LIMIT'}),{status:400})})(req(input),res);assert.equal(res.code,429);
});
test('lead remains accepted when delivery is unavailable',async()=>{
 const urls=[];const request=async(url,init)=>{urls.push(url);if(url.endsWith('rpc/submit_lead')){const data=JSON.parse(init.body);assert.equal(data.p_record.score,100);assert.notEqual(data.p_ip_hash,'192.0.2.1');return new Response(JSON.stringify(input.submissionId));}if(url.endsWith('rpc/claim_deliveries'))throw Error('Temporary outage');return new Response('[]');};
 const res=response();await createHandler({env,request})(req(input),res);assert.equal(res.code,202);assert.equal(res.data.ok,true);assert.equal(res.data.emailStatus,'pending');assert.equal(urls.length,3);
});
test('failed job is kept for retry; successful job is marked sent with a claim token',async()=>{
 const updates=[];const job={id:'event-1',claim_token:'lease-1',kind:'acknowledgment',attempts:1,lead:{id:input.submissionId,name:input.name,email:input.email,project_type:'Operations',timeline:'Within a month'}};
 const db=async(path,init)=>{if(path.startsWith('rpc/'))return [job];updates.push([path,init.body]);};
 let results=await drain(db,env,{request:async()=>{throw Error('Outage');}});assert.equal(results[0].status,'pending');assert.equal(updates[0][1].status,'pending');assert.match(updates[0][0],/claim_token=eq.lease-1/);
 results=await drain(db,env,{request:async(url,init)=>{assert.equal(init.headers['Idempotency-Key'],'event-1');return new Response('{}');}});assert.equal(results[0].status,'sent');assert.equal(updates[1][1].status,'sent');
});
test('webhook contains an event ID, authorization, and no credentials in its body',async()=>{
 const job={id:'event-2',claim_token:'lease-2',kind:'webhook',attempts:1,lead:{id:input.submissionId}};
 const db=async(path)=>path.startsWith('rpc/')?[job]:null;
 await drain(db,{...env,LEAD_WEBHOOK_URL:'https://workflow.example/hook',LEAD_WEBHOOK_SECRET:'secret'},{request:async(url,init)=>{assert.equal(url,'https://workflow.example/hook');assert.equal(init.headers.Authorization,'Bearer secret');assert.equal(JSON.parse(init.body).eventId,'event-2');assert.equal(init.body.includes('sb_secret'),false);return new Response('{}');}});
});
test('cron credentials require an exact match',()=>{assert.equal(secretEqual('abc','abc'),true);assert.equal(secretEqual('abc','abcd'),false);assert.equal(secretEqual(undefined,'abc'),false);});
