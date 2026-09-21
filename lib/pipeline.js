import { timingSafeEqual } from 'node:crypto';
import { HttpError } from './validation.js';

export function configuration(env=process.env) {
 const required=['SUPABASE_URL','SUPABASE_SECRET_KEY','RESEND_API_KEY','EMAIL_FROM','OWNER_EMAIL','RATE_LIMIT_SECRET','ALLOWED_ORIGINS','CRON_SECRET'];
 if(required.some(key=>!env[key]))throw new HttpError(503,'The inquiry service is not ready yet. Please use the email link.');
 const url=new URL(env.SUPABASE_URL);
 if(url.protocol!=='https:'||env.RATE_LIMIT_SECRET.length<32||env.CRON_SECRET.length<32)throw new HttpError(503,'The inquiry service is temporarily unavailable. Please use the email link.');
 if(Boolean(env.LEAD_WEBHOOK_URL)!==Boolean(env.LEAD_WEBHOOK_SECRET))throw new HttpError(503,'The inquiry service is temporarily unavailable. Please use the email link.');
 if(env.LEAD_WEBHOOK_URL&&new URL(env.LEAD_WEBHOOK_URL).protocol!=='https:')throw new HttpError(503,'The inquiry service is temporarily unavailable. Please use the email link.');
 return env;
}
export function secretEqual(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
export function createDatabase(env,request=fetch) {
 return async function db(path,{method='POST',body,headers={}}={}) {
  const response=await request(`${env.SUPABASE_URL.replace(/\/$/,'')}/rest/v1/${path}`,{method,headers:{apikey:env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000)});
  if(!response.ok){const e=await response.json().catch(()=>({}));if(e.message==='RATE_LIMIT')throw new HttpError(429,'You’ve sent several inquiries recently. Please try again later.');if(e.message==='ID_CONFLICT')throw new HttpError(409,'This brief has changed. Refresh the page before sending a new inquiry.');throw new Error(`Database request failed (${response.status})`);}
  if(response.status===204)return null;const text=await response.text();return text?JSON.parse(text):null;
 };
}
export function acknowledgment(lead) {
 return `Hi ${lead.name},\n\nThanks for sharing your automation brief. It has been recorded for review.\n\nProject: ${lead.project_type}\nTimeline: ${lead.timeline}\nReference: ${lead.id}\n\nI’ll review the process and follow up with a practical next step. You can reply to this email to add context.\n\nJohn Rys Clanor\nAI Automation Specialist`;
}
export async function deliverJob(job,env,request=fetch) {
 const lead=job.lead;let response;
 if(job.kind==='webhook'){
  response=await request(env.LEAD_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${env.LEAD_WEBHOOK_SECRET}`,'Idempotency-Key':job.id},body:JSON.stringify({event:'lead.created',eventId:job.id,createdAt:lead.created_at,lead}),signal:AbortSignal.timeout(8000),redirect:'error'});
 }else{
  const ack=job.kind==='acknowledgment';
  const body={from:env.EMAIL_FROM,to:[ack?lead.email:env.OWNER_EMAIL],reply_to:ack?env.OWNER_EMAIL:lead.email,subject:ack?'Your automation brief is in':`New automation inquiry · ${lead.route}`,text:ack?acknowledgment(lead):`New inquiry: ${lead.name}\nEmail: ${lead.email}\nCompany: ${lead.company||'Not provided'}\nRole: ${lead.role}\nProject: ${lead.project_type}\nBudget: ${lead.budget}\nTimeline: ${lead.timeline}\nFrequency: ${lead.frequency}\nTools: ${lead.tools||'Not provided'}\n\n${lead.challenge}\n\nRoute: ${lead.route}\nReadiness: ${lead.score}/100\nReason: ${lead.qualification_reason}\nReference: ${lead.id}`};
  response=await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':job.id},body:JSON.stringify(body),signal:AbortSignal.timeout(8000),redirect:'error'});
 }
 if(!response.ok)throw new Error(`Delivery provider returned ${response.status}`);
 return true;
}
export async function drain(db,env,{leadId=null,limit=3,request=fetch}={}) {
 const jobs=await db('rpc/claim_deliveries',{body:{p_lead_id:leadId,p_limit:limit}});
 return Promise.all(jobs.map(async job=>{
  try{
   await deliverJob(job,env,request);
   // Claim token prevents a timed-out worker from updating a newer worker's lease.
   await db(`lead_deliveries?id=eq.${job.id}&claim_token=eq.${job.claim_token}`,{method:'PATCH',body:{status:'sent',sent_at:new Date().toISOString(),locked_until:null,last_error:null}});
   return {kind:job.kind,status:'sent'};
  }catch{
   // Never log request bodies, credentials, or provider responses containing PII.
   const dead=job.attempts>=8;
   await db(`lead_deliveries?id=eq.${job.id}&claim_token=eq.${job.claim_token}`,{method:'PATCH',body:{status:dead?'needs_review':'pending',locked_until:null,next_attempt_at:new Date(Date.now()+Math.min(21600,60*2**job.attempts)*1000).toISOString(),last_error:'Delivery not confirmed. Inspect provider delivery status before manual replay.'}}).catch(()=>{});
   return {kind:job.kind,status:'pending'};
  }
 }));
}
