import {categoryMatches,categoryUrl} from './home-cards.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function homeCards(content,img) {
  const grid=document.querySelector('[data-home-categories]');
  if(grid)grid.innerHTML=content.blocks.filter(b=>b.kind==='category').map(b=>{
    const count=content.products.filter(p=>categoryMatches(p,b)).length;
    return `<a class="home-category" href="${esc(categoryUrl(b))}" aria-label="Explore ${esc(b.name)}"><span class="home-category__count">${count} ${count===1?'product':'products'} <span aria-hidden="true">↗</span></span><img class="home-category__icon" src="${esc(img(b.image))}" alt="" loading="lazy"><h3>${esc(b.name)}</h3><span class="home-category__hint">${esc((b.button||'Explore category').replace(/\s*→\s*$/,''))} →</span><span class="home-category__preview"><img src="${esc(img(b.previewImage||b.image))}" alt="${esc(b.name)}" loading="lazy"><span>${esc(b.description)}</span></span></a>`;
  }).join('');
}

export function homeServices(content,img) {
  const grid=document.querySelector('.home-services .svc-grid');
  if(!grid)return;
  grid.innerHTML=content.blocks.filter(b=>b.kind==='service').map((b,i)=>`<a class="svc" href="book.html?service=${encodeURIComponent(b.target)}" aria-label="Book ${esc(b.name)}"><span class="svc__no">${String(i+1).padStart(2,'0')} — Booking</span><img class="svc__icon" src="${esc(img(b.image))}" alt="" loading="lazy"><h3 class="svc__title">${esc(b.name)}</h3><p class="svc__desc">${esc(b.description)}</p><span class="svc__cta">Book free →</span></a>`).join('');
}
