import {createClient} from '@supabase/supabase-js';
import {SUPABASE_URL,PUBLIC_KEY} from './config.js';
export const db=createClient(SUPABASE_URL,PUBLIC_KEY,{auth:{storageKey:'moto-staff-session',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
export async function admin(action,args={}) {
 const {data:{session}}=await db.auth.getSession();
 if(!session)throw new Error('Please sign in to continue.');
 const response=await fetch(SUPABASE_URL+'/functions/v1/moto-admin',{method:'POST',headers:{apikey:PUBLIC_KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action,...args})});
 const result=await response.json();if(!response.ok){const e=new Error(result.error||result.message||'Unable to connect. Please try again.');e.code=result.code;throw e;}return result;
}
export async function live(){const {data,error}=await db.from('moto_live').select('revision,content,published_at').single();if(error)throw error;return data;}
export function watchLive(currentRevision,onChange){
 let stopped=false,checking=false;
 const accept=next=>{if(!stopped&&next&&next!==currentRevision){currentRevision=next;onChange(next);}};
 const check=async()=>{if(stopped||checking||document.hidden)return;checking=true;try{const {data,error}=await db.from('moto_site_events').select('revision').single();if(!error)accept(data?.revision);}catch{}finally{checking=false;}};
 const channel=db.channel('moto-published-site').on('postgres_changes',{event:'UPDATE',schema:'public',table:'moto_site_events'},payload=>accept(payload.new.revision)).subscribe(status=>{if(status==='SUBSCRIBED')check();});
 const interval=setInterval(check,30000);
 document.addEventListener('visibilitychange',check);window.addEventListener('online',check);
 return ()=>{stopped=true;clearInterval(interval);document.removeEventListener('visibilitychange',check);window.removeEventListener('online',check);db.removeChannel(channel);};
}
export async function request(body){const response=await fetch(SUPABASE_URL+'/functions/v1/moto-request',{method:'POST',headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Your request was not saved. Please try again.');return result;}
export async function upload(file){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5242880)throw new Error('Choose a JPG, PNG or WebP picture smaller than 5 MB.');
 const bitmap=await createImageBitmap(file);const width=bitmap.width,height=bitmap.height;bitmap.close();
 if(width>12000||height>12000)throw new Error('Resize the picture to less than 12,000 pixels on each side.');
 const {data:{user},error}=await db.auth.getUser();if(error||!user)throw new Error('Please sign in again.');
 const path=user.id+'/'+crypto.randomUUID()+'.'+(file.type==='image/jpeg'?'jpg':file.type==='image/png'?'png':'webp');
 const {error:uploadError}=await db.storage.from('moto-media').upload(path,file,{contentType:file.type,upsert:false});if(uploadError)throw uploadError;
 return admin('register-media',{path,name:file.name,width,height});
}
