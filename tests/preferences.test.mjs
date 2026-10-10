import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreferences,CHOICE_KEY,RIDE_KEY} from '../cms/preferences.mjs';
const storage=()=>{const items=new Map();return {getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)};};
const ride={id:'bike-yamaha-6',type:'bike',brand:'Yamaha',model:'Ray ZR'};

test('before a choice and with essentials only, the ride lasts for the visit',()=>{
 const local=storage(),session=storage(),prefs=createPreferences(local,session);
 prefs.saveRide(ride);assert.equal(local.getItem(RIDE_KEY),null);
 assert.deepEqual(createPreferences(local,session).readRide(),ride);
 prefs.choose(false);assert.equal(local.getItem(RIDE_KEY),null);
 assert.equal(createPreferences(local,storage()).readRide(),null);
 assert.equal(createPreferences(local,storage()).getChoice().rememberRide,false);
});
test('accept remembers a current ride across visits, and withdrawing moves it back to the visit',()=>{
 const local=storage(),session=storage(),prefs=createPreferences(local,session);
 prefs.saveRide(ride);prefs.choose(true);
 assert.deepEqual(createPreferences(local,storage()).readRide(),ride);
 assert.equal(session.getItem(RIDE_KEY),null);
 prefs.choose(false);assert.equal(local.getItem(RIDE_KEY),null);
 assert.deepEqual(createPreferences(local,session).readRide(),ride);
 assert.equal(createPreferences(local,storage()).readRide(),null);
 prefs.choose(true);prefs.forgetRide();assert.equal(local.getItem(RIDE_KEY),null);assert.equal(session.getItem(RIDE_KEY),null);
});
test('legacy selections are retained for the current visit without silently accepting',()=>{
 const local=storage(),session=storage();local.setItem(RIDE_KEY,JSON.stringify(ride));
 const prefs=createPreferences(local,session);assert.equal(prefs.getChoice(),null);
 assert.deepEqual(prefs.readRide(),ride);assert.equal(local.getItem(RIDE_KEY),null);
});
test('unavailable or malformed browser storage never breaks the ride tools',()=>{
 const broken={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 const prefs=createPreferences(broken,broken);prefs.saveRide(ride);
 assert.deepEqual(prefs.readRide(),ride);assert.equal(prefs.choose(true).persisted,false);assert.deepEqual(prefs.readRide(),ride);
 prefs.forgetRide();assert.equal(prefs.readRide(),null);
 const local=storage();local.setItem(CHOICE_KEY,'{oops');local.setItem(RIDE_KEY,'{oops');assert.equal(createPreferences(local,storage()).readRide(),null);
});
