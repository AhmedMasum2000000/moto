import {createClient} from 'npm:@supabase/supabase-js@2.117.3';
import {validateRequest} from '../moto-admin/schema.mjs';
import {invoiceHtml} from '../_shared/invoice.mjs';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const origins=new Set(['https://motolubebangladesh.com','https://www.motolubebangladesh.com','http://motolubebangladesh.com','http://www.motolubebangladesh.com','https://ahmedmasum2000000.github.io','http://127.0.0.1:8781','http://localhost:8781']);
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
  // The client can prepend anything to X-Forwarded-For, so trust the platform's own header or the last hop it appended.
  const forwarded=(req.headers.get('x-forwarded-for')||'').split(',').map(s=>s.trim()).filter(Boolean);
  const source=req.headers.get('cf-connecting-ip')||forwarded[forwarded.length-1]||req.headers.get('x-real-ip')||'';
  if(!source)throw new Error('Please try again in a moment.');
  const raw=await req.text();if(raw.length>15000)throw new Error('Your request is too large.');const body=JSON.parse(raw);
  const {data:live,error}=await db.from('moto_live').select('content').single();if(error)throw new Error('Please try again in a moment.');
  const validated=validateRequest(body,live.content);
  // Rate-limit by the platform-provided IP hash and independently by phone in SQL.
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const {data:earlier}=await db.from('moto_requests').select('receipt,created_at').eq('idempotency_key',body.key).maybeSingle();
  const {data:receipt,error:saveError}=await db.rpc('moto_submit_request',{p_key:body.key,p_rate_key:hash,p_kind:validated.kind,p_name:validated.name,p_phone:validated.phone,p_details:validated.details});
  if(saveError)throw new Error(saveError.message.includes('RATE_LIMIT')?'Too many requests. Please contact the store or try again later.':saveError.message.includes('REQUEST_CHANGED')?'We already received your earlier request. The team will contact you to confirm.':'Your request was not saved. Please try again.');
  const createdAt=earlier?.created_at||new Date().toISOString();
  const invoice=validated.kind==='order'?{receipt,createdAt,name:validated.name,phone:validated.phone,address:validated.details.address,items:validated.details.items,totalMinor:validated.details.totalMinor}:null;
  // Email the store about each new order. A failed email never loses the saved order.
  if(invoice&&!earlier)await notifyStore(live.content.settings||{},invoice).catch(e=>console.error('Order email failed:',e instanceof Error?e.message:e));
  return new Response(JSON.stringify({receipt,invoice,message:'Request received. The team will contact you to confirm availability and price.'}),{headers});
 }catch(e){return new Response(JSON.stringify({error:e instanceof Error?e.message:'Unable to save request.'}),{status:400,headers});}
});

// Sends the order and its invoice to the store's email address (Website → Store settings → Email).
// With a RESEND_API_KEY secret the email goes through Resend; otherwise through FormSubmit,
// which asks the store to confirm the address once with the first email it sends.
async function notifyStore(store:any,invoice:any){
 const to=String(store.email||'').trim();if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to))return;
 const money=(m:number)=>'BDT '+(m/100).toLocaleString('en-BD');
 const lines=invoice.items.map((i:any)=>`${i.name}${i.colorName?' ('+i.colorName+')':''} x ${i.quantity} = ${money(i.unitPriceMinor*i.quantity)}`).join('\n');
 const subject=`New order ${invoice.receipt} from ${invoice.name}`;
 const signal=AbortSignal.timeout(8000);
 const key=Deno.env.get('RESEND_API_KEY');
 if(key){
  const res=await fetch('https://api.resend.com/emails',{method:'POST',signal,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from:Deno.env.get('ORDER_EMAIL_FROM')||'Moto Market <onboarding@resend.dev>',to:[to],subject,html:invoiceHtml({...invoice,store})})});
  if(!res.ok)throw new Error('Resend '+res.status);return;
 }
 const res=await fetch('https://formsubmit.co/ajax/'+encodeURIComponent(to),{method:'POST',signal,headers:{'Content-Type':'application/json',Accept:'application/json',Origin:'https://motolubebangladesh.com',Referer:'https://motolubebangladesh.com/'},body:JSON.stringify({_subject:subject,_template:'box',_captcha:'false',Order:invoice.receipt,Name:invoice.name,Phone:invoice.phone,Address:invoice.address,Items:lines,Total:money(invoice.totalMinor),Time:new Date(invoice.createdAt).toLocaleString('en-GB',{timeZone:'Asia/Dhaka'})})});
 if(!res.ok)throw new Error('FormSubmit '+res.status);
}
