export function websiteMotion(){
 const style=document.createElement('link');style.rel='stylesheet';style.href='cms/motion.css?v=1';document.head.append(style);
 if(matchMedia('(prefers-reduced-motion:reduce)').matches||!('IntersectionObserver' in window))return;
 const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;entry.target.classList.add('motion-visible');observer.unobserve(entry.target);}}, {threshold:.12});
 document.querySelectorAll('.home-category,.home-services .svc,.popular-products__heading,.brand-partners__head').forEach((element,index)=>{
  element.classList.add('motion-reveal');element.style.setProperty('--motion-delay',`${index%4*65}ms`);observer.observe(element);
 });
 const timers=new Set();
 const typing=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;
  const heading=entry.target,copy=heading.textContent.trim();typing.unobserve(heading);if(!copy)continue;
  heading.setAttribute('aria-label',copy);heading.classList.add('motion-type');
  const space=document.createElement('span'),visual=document.createElement('span');space.className='motion-type__space';visual.className='motion-type__visual';space.setAttribute('aria-hidden','true');visual.setAttribute('aria-hidden','true');space.textContent=copy;heading.replaceChildren(space,visual);
  const letters=Array.from(copy);let position=0;heading.classList.add('is-typing');
  const timer=setInterval(()=>{visual.textContent=letters.slice(0,++position).join('');if(position>=letters.length){clearInterval(timer);timers.delete(timer);heading.classList.remove('is-typing');}},Math.max(18,Math.min(45,700/letters.length)));timers.add(timer);
 }},{threshold:.65});
 document.querySelectorAll('#popular-title,#brands-title,#services-title,#partner-title').forEach(h=>typing.observe(h));
 addEventListener('pagehide',()=>{observer.disconnect();typing.disconnect();timers.forEach(clearInterval);},{once:true});
}
