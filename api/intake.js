import { createHash, createHmac } from 'node:crypto';
import { validate, qualify, HttpError } from '../lib/validation.js';
import { configuration, createDatabase, drain } from '../lib/pipeline.js';

export function createHandler({env=process.env,request=fetch}={}){
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Use POST to submit an inquiry.'});}
  try{
   configuration(env);
   const origins=env.ALLOWED_ORIGINS.split(',').map(s=>s.trim()).filter(Boolean);
   if(!origins.includes(req.headers.origin))throw new HttpError(403,'Please submit from the portfolio website.');
   if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new HttpError(415,'A JSON project brief is required.');
   const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body??{});
   if(Buffer.byteLength(raw)>12000)throw new HttpError(413,'Please shorten the project brief.');
   let input;try{input=JSON.parse(raw);}catch{throw new HttpError(400,'Please send a valid project brief.');}
   if(input?.website)throw new HttpError(400,'This submission could not be accepted.');
   const lead=validate(input),qualification=qualify(lead),db=createDatabase(env,request);
   // Vercel supplies/overwrites x-real-ip. Never trust a client-provided forwarded chain.
   const ip=String(req.headers['x-real-ip']||req.socket?.remoteAddress||'unknown');
   const hash=value=>createHmac('sha256',env.RATE_LIMIT_SECRET).update(value).digest('hex');
   const record={id:lead.submissionId,name:lead.name,email:lead.email,company:lead.company,role:lead.role,project_type:lead.projectType,challenge:lead.challenge,tools:lead.tools,frequency:lead.frequency,budget:lead.budget,timeline:lead.timeline,consent:true,consent_version:'2026-09-21',score:qualification.score,route:qualification.route,qualification_reason:qualification.reason};
   await db('rpc/submit_lead',{body:{p_record:record,p_payload_hash:createHash('sha256').update(JSON.stringify(record)).digest('hex'),p_ip_hash:hash(ip),p_email_hash:hash(lead.email),p_webhook:Boolean(env.LEAD_WEBHOOK_URL)}});
   // The durable transaction completed. A delivery outage must not lose the lead
   // or make the browser believe the saved record failed.
   await drain(db,env,{leadId:record.id,request}).catch(()=>{});
   let emailStatus='pending';
   try{const jobs=await db(`lead_deliveries?lead_id=eq.${record.id}&kind=eq.acknowledgment&select=status`,{method:'GET'});if(jobs[0]?.status==='sent')emailStatus='sent';}catch{}
   return res.status(202).json({ok:true,reference:record.id,emailStatus});
  }catch(error){
   const status=error instanceof HttpError?error.status:503;
   if(status===429)res.setHeader('Retry-After','3600');
   return res.status(status).json({error:error instanceof HttpError?error.message:'We couldn’t confirm your brief was saved. Please retry, or use the email link. Retrying the same brief will not create another record.'});
  }
 };
}
export default createHandler();
