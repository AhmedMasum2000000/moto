import {categoryMatches,categoryUrl} from './home-cards.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function homeCards(content,img) {
  const grid=document.querySelector('[data-home-categories]');
  if(grid)grid.innerHTML=content.blocks.filter(b=>b.kind==='category').map(b=>{
    const count=content.products.filter(p=>categoryMatches(p,b)).length;
    return `<a class="home-category" href="${esc(categoryUrl(b))}" aria-label="Explore ${esc(b.name)}"><span class="home-category__count">${count} ${count===1?'product':'products'} <span aria-hidden="true">↗</span></span><img class="home-category__icon" src="${esc(img(b.image))}" alt="" loading="lazy"><h3>${esc(b.name)}</h3><span class="home-category__hint">Explore category →</span><span class="home-category__preview"><img src="${esc(img(b.previewImage||b.image))}" alt="${esc(b.name)}" loading="lazy"><span>${esc(b.description)}</span></span></a>`;
  }).join('');
}
