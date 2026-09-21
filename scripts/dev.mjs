import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import intake from '../api/intake.js';
import retry from '../api/retry-deliveries.js';
const root=resolve(import.meta.dirname,'../public');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.pdf':'application/pdf'};
createServer(async(req,res)=>{
 res.status=code=>{res.statusCode=code;return res;};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/api/intake'||path==='/api/retry-deliveries'){
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>12000){res.status(413).json({error:'Request too large'});return;}chunks.push(chunk);}req.body=Buffer.concat(chunks).toString();
   // Local development must never trust an arbitrary x-real-ip header.
   req.headers['x-real-ip']=req.socket.remoteAddress;
   await (path==='/api/intake'?intake:retry)(req,res);return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.statusCode=405;res.end();return;}
  const file=resolve(root,decodeURIComponent(path==='/'?'/index.html':path).replace(/^\/+/,''));
  if(!file.startsWith(root+sep)||!(await stat(file)).isFile()){res.statusCode=404;res.end('Not found');return;}
  res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');
  res.end(req.method==='HEAD'?undefined:await readFile(file));
 }catch{res.statusCode=404;res.end('Not found');}
}).listen(4173,'127.0.0.1',()=>console.log('Portfolio preview: http://localhost:4173'));
