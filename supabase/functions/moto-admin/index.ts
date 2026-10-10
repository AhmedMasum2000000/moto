import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { validateContent,publicDocument,mediaReferences,resolveMedia,UUID,assert } from './schema.mjs';
const url=Deno.env.get('SUPABASE_URL')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const allowed=new Set(['https://ahmedmasum2000000.github.io','http://127.0.0.1:8781','http://localhost:8781']);
const cors=(origin:string)=>({'Access-Control-Allow-Origin':allowed.has(origin)?origin:'https://ahmedmasum2000000.github.io','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'});
async function result(query:any){const {data,error}=await query;if(error)throw new Error(error.message);return data;}
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'',headers={...cors(origin),'Content-Type':'application/json','Cache-Control':'no-store'};
 if(origin&&!allowed.has(origin))return new Response(JSON.stringify({error:'Origin not allowed'}),{status:403,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers});
 try{
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');
  const {data:auth,error:authError}=await db.auth.getUser(token);if(authError||!auth.user||!auth.user.email_confirmed_at)return new Response(JSON.stringify({error:'Please sign in again.'}),{status:401,headers});
  const staff=await result(db.from('moto_staff').select('*').eq('user_id',auth.user.id).eq('active',true).maybeSingle());
  if(!staff)return new Response(JSON.stringify({error:'This account does not have store access.'}),{status:403,headers});
  const raw=await req.text();assert(new TextEncoder().encode(raw).length<2000000,'Update is too large.');const body=JSON.parse(raw),action=body.action;
  const editor=staff.role==='owner'||staff.role==='editor',owner=staff.role==='owner';
  if(action==='sync'){
   const requests=await result(db.from('moto_requests').select('*').order('created_at',{ascending:false}).limit(200));
   if(!editor)return new Response(JSON.stringify({staff,requests}),{headers});
   const [draft,live]=await Promise.all([result(db.from('moto_draft').select('version').single()),result(db.from('moto_live').select('revision').single())]);
   return new Response(JSON.stringify({staff,requests,version:draft.version,revision:live.revision}),{headers});
  }
  if(action==='load'){
   const requests=await result(db.from('moto_requests').select('*').order('created_at',{ascending:false}).limit(200));
   if(!editor)return new Response(JSON.stringify({staff,requests}),{headers});
   const [draft,live,revisions,media]=await Promise.all([result(db.from('moto_draft').select('*').single()),result(db.from('moto_live').select('*').single()),result(db.from('moto_revisions').select('id,summary,created_at').order('created_at',{ascending:false}).limit(30)),result(db.from('moto_media').select('*').order('created_at',{ascending:false}).limit(2000))]);
   let signed:any[]=[];if(media.length)signed=await result(db.storage.from('moto-media').createSignedUrls(media.map((m:any)=>m.path),3600));
   const mediaUrls=Object.fromEntries(media.map((m:any,i:number)=>[m.id,signed[i]?.signedUrl||'']));
   return new Response(JSON.stringify({staff,draft,live,revisions,media,mediaUrls,requests}),{headers});
  }
  if(action==='save'){assert(editor,'You can manage requests, but not website content.');validateContent(body.content);assert(Array.isArray(body.changes)&&body.changes.length<=1000,'Invalid change list.');const version=await result(db.rpc('moto_save_draft',{p_actor:staff.user_id,p_expected:body.version,p_content:body.content,p_changes:body.changes}));return new Response(JSON.stringify({version}),{headers});}
  if(action==='publish'){
   assert(owner||staff.can_publish,'Ask the store owner to publish these changes.');const draft=await result(db.from('moto_draft').select('*').single());assert(draft.version===body.version,'DRAFT_CONFLICT');validateContent(draft.content);let content=publicDocument(draft.content);const refs=[...mediaReferences(content)],mediaUrls:Record<string,string>={};
   for(const id of refs){assert(UUID.test(id),'Invalid picture reference.');const media=await result(db.from('moto_media').select('*').eq('id',id).single());const blob=await result(db.storage.from('moto-media').download(media.path));const ext=media.mime_type==='image/jpeg'?'jpg':media.mime_type==='image/png'?'png':'webp',name=id+'.'+ext;const {error}=await db.storage.from('moto-public').upload(name,blob,{contentType:media.mime_type,cacheControl:'31536000',upsert:false});if(error&&!/already exists|duplicate/i.test(error.message))throw error;mediaUrls[id]=db.storage.from('moto-public').getPublicUrl(name).data.publicUrl;}
   content=resolveMedia(content,mediaUrls);const saved=await result(db.rpc('moto_publish',{p_actor:staff.user_id,p_expected:body.version,p_public_content:content,p_summary:`${draft.changes.length} content changes published`}));return new Response(JSON.stringify(saved),{headers});
  }
  if(action==='restore'){assert(owner,'Only the store owner can restore a version.');assert(UUID.test(body.revision),'Choose a version.');const saved=await result(db.rpc('moto_restore',{p_actor:staff.user_id,p_expected:body.version,p_revision:body.revision}));return new Response(JSON.stringify(saved),{headers});}
  if(action==='register-media'){
   assert(editor,'Picture uploads are not enabled for this account.');assert(typeof body.path==='string'&&body.path.startsWith(staff.user_id+'/')&&/^[a-zA-Z0-9/_.-]+$/.test(body.path)&&!body.path.includes('..'),'Invalid upload path.');const blob=await result(db.storage.from('moto-media').download(body.path));const bytes=new Uint8Array(await blob.arrayBuffer());assert(bytes.length>0&&bytes.length<=5242880,'Choose a picture smaller than 5 MB.');let mime='';if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)mime='image/png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')mime='image/webp';assert(mime,'Choose a JPG, PNG or WebP image.');assert(typeof body.name==='string'&&body.name.length<200,'Choose a shorter photo name.');const item=await result(db.from('moto_media').insert({path:body.path,name:body.name,mime_type:mime,size_bytes:bytes.length,width:body.width,height:body.height,created_by:staff.user_id}).select().single());const signed=await result(db.storage.from('moto-media').createSignedUrl(item.path,3600));return new Response(JSON.stringify({media:item,url:signed.signedUrl}),{headers});
  }
  if(action==='request-update'){assert(UUID.test(body.id),'Choose a request.');const version=await result(db.rpc('moto_update_request',{p_actor:staff.user_id,p_id:body.id,p_expected:body.version,p_status:body.status,p_notes:String(body.notes||'')}));return new Response(JSON.stringify({version}),{headers});}
  if(action==='staff-list'){assert(owner,'Only the owner can manage staff.');return new Response(JSON.stringify({staff:await result(db.from('moto_staff').select('user_id,username,display_name,role,can_publish,active,created_at').order('created_at'))}),{headers});}
  if(action==='staff-update'){
   assert(owner,'Only an Administrator can change staff access.');assert(UUID.test(body.userId),'Choose a staff member.');
   assert(/^[a-z][a-z0-9_-]{2,29}$/.test(body.username),'Use 3–30 lowercase letters, numbers, underscores or hyphens.');
   assert(['owner','editor','service'].includes(body.role),'Choose a valid role.');assert(body.userId!==staff.user_id||body.role==='owner','You cannot remove your own Administrator access.');
   assert(typeof body.name==='string'&&body.name.trim().length>0&&body.name.length<=100,'Enter a staff name.');
   const current=await result(db.from('moto_staff').select('*').eq('user_id',body.userId).single());
   const duplicate=await result(db.from('moto_staff').select('user_id').eq('username',body.username).neq('user_id',body.userId).maybeSingle());assert(!duplicate,'This username is already in use.');
   const update:any={};if(body.username!==current.username){update.email=body.username+'@staff.motomarket.invalid';update.email_confirm=true;}
   if(body.password){assert(typeof body.password==='string'&&body.password.length>=14&&body.password.length<=100,'Use at least 14 characters for the new password.');update.password=body.password;}
   if(Object.keys(update).length){const {error}=await db.auth.admin.updateUserById(body.userId,update);if(error)throw new Error(error.message);}
   await result(db.from('moto_staff').update({username:body.username,display_name:body.name,role:body.role,can_publish:body.role==='owner'||body.role==='editor'&&!!body.canPublish}).eq('user_id',body.userId));
   await db.from('moto_audit').insert({actor:staff.user_id,action:'staff_updated',details:{user:body.userId,role:body.role,passwordReset:!!body.password}});
   return new Response(JSON.stringify({success:true}),{headers});
  }
  if(action==='staff-create'){
   assert(owner,'Only the owner can add staff.');assert(/^[a-z][a-z0-9_-]{2,29}$/.test(body.username),'Use 3–30 lowercase letters, numbers, underscores or hyphens.');assert(typeof body.password==='string'&&body.password.length>=14&&body.password.length<=100,'Use a temporary password of at least 14 characters.');assert(['owner','editor','service'].includes(body.role),'Choose a staff role.');assert(typeof body.name==='string'&&body.name.trim().length>0&&body.name.length<=100,'Enter the staff name.');const {data:created,error}=await db.auth.admin.createUser({email:body.username+'@staff.motomarket.invalid',password:body.password,email_confirm:true});if(error)throw new Error(error.message);const {error:staffError}=await db.from('moto_staff').insert({user_id:created.user!.id,username:body.username,display_name:body.name,role:body.role,can_publish:body.role==='owner'||body.role==='editor'&&!!body.canPublish});if(staffError){await db.auth.admin.deleteUser(created.user!.id);throw new Error('Unable to create staff access. Try a different username.');}await db.from('moto_audit').insert({actor:staff.user_id,action:'staff_created',details:{user:created.user!.id,role:body.role}});return new Response(JSON.stringify({success:true}),{headers});
  }
  if(action==='staff-disable'){assert(owner,'Only the owner can change access.');assert(UUID.test(body.userId)&&body.userId!==staff.user_id,'You cannot disable your own account.');await result(db.from('moto_staff').update({active:!body.disabled}).eq('user_id',body.userId));return new Response(JSON.stringify({success:true}),{headers});}
  return new Response(JSON.stringify({error:'Unknown action'}),{status:400,headers});
 }catch(e){const message=e instanceof Error?e.message:'Unable to complete this action.';const conflict=message.includes('CONFLICT');return new Response(JSON.stringify({error:conflict?'Someone saved a newer version. Reload the latest draft before saving again.':message,code:conflict?'CONFLICT':'INVALID_REQUEST'}),{status:conflict?409:400,headers});}
});

