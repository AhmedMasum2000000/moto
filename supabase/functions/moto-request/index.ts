import {createClient} from 'npm:@supabase/supabase-js@2.117.3';
import {validateRequest} from '../moto-admin/schema.mjs';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const origins=new Set(['https://ahmedmasum2000000.github.io','http://127.0.0.1:8781','http://localhost:8781']);
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://ahmedmasum2000000.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Content-Type':'application/json','Cache-Control':'no-store'};
 if(origin&&!origins.has(origin))return new Response(JSON.stringify({error:'Origin not allowed'}),{status:403,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers});
 // Guest submissions use the site's publishable API key rather than a staff JWT.
 // This grants no read access to requests or permission to change website content.
 const publishableKeys=Object.values(JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}'));
 if(!publishableKeys.includes(req.headers.get('apikey')||''))return new Response(JSON.stringify({error:'Invalid website key.'}),{status:401,headers});
 try{
  const raw=await req.text();if(raw.length>15000)throw new Error('Your request is too large.');const body=JSON.parse(raw);
  const {data:live,error}=await db.from('moto_live').select('content').single();if(error)throw new Error('Please try again in a moment.');
  const validated=validateRequest(body,live.content);
  // Rate-limit by the platform-provided IP hash and independently by phone in SQL.
  const source=(req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const {data:receipt,error:saveError}=await db.rpc('moto_submit_request',{p_key:body.key,p_rate_key:hash,p_kind:validated.kind,p_name:validated.name,p_phone:validated.phone,p_details:validated.details});
  if(saveError)throw new Error(saveError.message.includes('RATE_LIMIT')?'Too many requests. Please contact the store or try again later.':'Your request was not saved. Please try again.');
  return new Response(JSON.stringify({receipt,message:'Request received. The team will contact you to confirm availability and price.'}),{headers});
 }catch(e){return new Response(JSON.stringify({error:e instanceof Error?e.message:'Unable to save request.'}),{status:400,headers});}
});
