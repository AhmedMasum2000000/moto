import {ridePreferences,CHOICE_KEY} from './preferences.mjs';

export const cookieSection={
 id:'index-cookie-consent',page:'index',name:'Cookie card · shown across the website',visible:true,
 fields:[
  {id:'cookie-label',kind:'text',label:'Small label',value:'Pit stop · Cookie check'},
  {id:'cookie-joke',kind:'text',label:'Biker joke',value:'Cookies? Relax. Your helmet will still fit.'},
  {id:'cookie-help',kind:'text',label:'Choice explanation',value:'Save your ride for next time. Your cart works either way.'},
  {id:'cookie-mascot',kind:'image',label:'Biker mascot',value:'assets/mascot/cookie-rider.webp'}
 ]
};

export function cookieCard(content,imageUrl){
 window.MM_RIDE_STORAGE=ridePreferences;
 const section=content?.content?.find(s=>s.id===cookieSection.id);
 const values=new Map((section?.fields||cookieSection.fields).map(f=>[f.id,f.value]));
 const value=id=>values.get(id)??cookieSection.fields.find(f=>f.id===id)?.value??'';
 const style=document.createElement('link');style.rel='stylesheet';style.href='cms/cookies.css';
 document.head.append(style);
 const panel=document.createElement('aside');panel.className='cookie-card';panel.hidden=true;
 panel.setAttribute('aria-labelledby','cookie-joke');panel.setAttribute('aria-describedby','cookie-help');
 panel.setAttribute('role','region');
 panel.innerHTML='<div class="cookie-card__top"><img class="cookie-card__mascot" alt="" width="104" height="112"><div class="cookie-card__copy"><p class="cookie-card__label"></p><h2 id="cookie-joke" tabindex="-1"></h2></div></div><p id="cookie-help" class="cookie-card__help"></p><div class="cookie-card__choices"><button type="button" data-cookie-choice="accept">Accept cookies <span aria-hidden="true">→</span></button><button type="button" data-cookie-choice="essential">Only essentials</button></div><p class="cookie-card__status" role="status" hidden></p>';
 panel.querySelector('.cookie-card__label').textContent=value('cookie-label');
 panel.querySelector('h2').textContent=value('cookie-joke');
 panel.querySelector('#cookie-help').textContent=value('cookie-help');
 const mascot=panel.querySelector('img');mascot.src=imageUrl(value('cookie-mascot'));
 mascot.addEventListener('error',()=>{mascot.hidden=true;panel.classList.add('cookie-card--no-image');});
 document.body.append(panel);
 const settings=document.createElement('button');settings.type='button';settings.className='cookie-settings label';settings.textContent='Cookie settings';
 settings.setAttribute('aria-controls','moto-cookie-card');settings.setAttribute('aria-expanded','false');panel.id='moto-cookie-card';
 (document.querySelector('.footer__bar')||document.querySelector('footer')||document.body).append(settings);
 let openedFromSettings=false,closeButton;
 function show(fromSettings=false){
  openedFromSettings=fromSettings;panel.hidden=false;settings.setAttribute('aria-expanded','true');
  if(fromSettings){
   const choice=ridePreferences.getChoice();
   panel.querySelector('.cookie-card__status').hidden=!choice;
   panel.querySelector('.cookie-card__status').textContent=choice?.rememberRide?'Current choice: remember my ride.':'Current choice: essentials only.';
   if(!closeButton){closeButton=document.createElement('button');closeButton.type='button';closeButton.className='cookie-card__close';closeButton.textContent='×';closeButton.setAttribute('aria-label','Close cookie settings');closeButton.onclick=()=>hide();panel.prepend(closeButton);}
   closeButton.hidden=false;panel.querySelector('h2').focus({preventScroll:true});
  }else if(closeButton)closeButton.hidden=true;
 }
 function hide(){panel.hidden=true;settings.setAttribute('aria-expanded','false');if(openedFromSettings)settings.focus({preventScroll:true});}
 settings.onclick=()=>show(true);
 panel.addEventListener('click',event=>{
  const button=event.target.closest('[data-cookie-choice]');if(!button)return;
  ridePreferences.choose(button.dataset.cookieChoice==='accept');hide();
  window.dispatchEvent(new CustomEvent('mm:preferences',{detail:ridePreferences.getChoice()}));
 });
 panel.addEventListener('keydown',event=>{if(event.key==='Escape'&&openedFromSettings){event.preventDefault();hide();}});
 window.addEventListener('storage',event=>{if(event.key===CHOICE_KEY){ridePreferences.sync();if(ridePreferences.getChoice())hide();}});
 // Keep the first page impression clear; never take focus away from the rider.
 if(!ridePreferences.getChoice()){
  let ready=false;const reveal=()=>{if(ready)return;ready=true;setTimeout(()=>{if(!ridePreferences.getChoice())show();},1400);};
  style.addEventListener('load',reveal,{once:true});style.addEventListener('error',reveal,{once:true});if(style.sheet)reveal();
 }
}
