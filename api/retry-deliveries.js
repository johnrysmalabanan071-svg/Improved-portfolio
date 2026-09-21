import { configuration, createDatabase, drain, secretEqual } from '../lib/pipeline.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
 if(!process.env.CRON_SECRET||!secretEqual(req.headers.authorization,`Bearer ${process.env.CRON_SECRET}`))return res.status(401).json({error:'Unauthorized'});
 try{const env=configuration(),db=createDatabase(env);const results=await drain(db,env,{limit:10});await db('rpc/clean_intake_limits',{body:{}});return res.status(200).json({processed:results.length,sent:results.filter(r=>r.status==='sent').length});}
 catch{return res.status(503).json({error:'Delivery retry could not complete'});}
}
