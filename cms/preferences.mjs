export const CHOICE_KEY='mm.cookie-choice.v1';
export const RIDE_KEY='mm.vehicle.v1';

// A ride can follow the current visit without being remembered for future visits.
export function createPreferences(persistent,session){
 const get=(store,key)=>{try{return JSON.parse(store?.getItem(key)||'null');}catch{return null;}};
 const put=(store,key,value)=>{try{if(!store)return false;store.setItem(key,JSON.stringify(value));return true;}catch{return false;}};
 const remove=(store,key)=>{try{store?.removeItem(key);}catch{}};
 const loadChoice=()=>{const c=get(persistent,CHOICE_KEY);return c?.version===1&&typeof c.rememberRide==='boolean'?c:null;};
 let choice=loadChoice(),memoryRide=null;
 const accepted=()=>choice?.rememberRide===true;
 function readRide(){return (accepted()?get(persistent,RIDE_KEY):get(session,RIDE_KEY))||memoryRide;}
 function saveRide(ride){memoryRide=ride;put(accepted()?persistent:session,RIDE_KEY,ride);remove(accepted()?session:persistent,RIDE_KEY);}
 function forgetRide(){memoryRide=null;remove(persistent,RIDE_KEY);remove(session,RIDE_KEY);}
 // Preserve an existing selection during the visit while waiting for a choice.
 const legacy=get(persistent,RIDE_KEY),current=get(session,RIDE_KEY);
 if(accepted()){if(!legacy&&current)saveRide(current);}
 else if(current||legacy)saveRide(current||legacy);
 function choose(rememberRide){
  const ride=readRide();choice={version:1,rememberRide:rememberRide===true};
  const persisted=put(persistent,CHOICE_KEY,choice);
  if(ride)saveRide(ride);else forgetRide();
  return {choice:{...choice},persisted};
 }
 function sync(){const ride=readRide();choice=loadChoice();if(ride)saveRide(ride);}
 return {readRide,saveRide,forgetRide,choose,sync,getChoice:()=>choice?{...choice}:null};
}

let persistent,session;
try{persistent=globalThis.localStorage;}catch{}
try{session=globalThis.sessionStorage;}catch{}
export const ridePreferences=createPreferences(persistent,session);
