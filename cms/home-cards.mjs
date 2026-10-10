export const removedHomeSections = ['index-pricing','index-process','index-section-4','index-faq','index-contact'];

export function categoryMatches(product, card) {
  return product.category === card.target && (!card.subcategories?.length || card.subcategories.includes(product.subcategory));
}

export function categoryUrl(card) {
  const query = new URLSearchParams({cat:card.target});
  if (card.subcategories?.length) query.set('collection',card.id);
  return 'shop.html?' + query;
}

// Move within one group without moving the other group's cards.
export function moveCard(blocks, id, direction) {
  const index = blocks.findIndex(b=>b.id===id);
  if (index<0 || ![-1,1].includes(direction)) return false;
  const group = blocks.map((b,i)=>b.kind===blocks[index].kind ? i : -1).filter(i=>i>=0);
  const other = group[group.indexOf(index)+direction];
  if (other===undefined) return false;
  [blocks[index],blocks[other]]=[blocks[other],blocks[index]];
  return true;
}

export function updateHomepage(data) {
  const make = (target,name,image,description,subcategories=[]) => {
    const old = data.blocks.find(b=>b.kind==='category'&&b.target===target&&!['gear-card','after-card'].includes(b.id));
    return {...old,id:old?.id||target+'-card',kind:'category',target,name,image,description,previewImage:old?.previewImage||'',subcategories,button:'Explore',included:old?.included||[],visible:true};
  };
  const cards = [
    make('oil','Oil & Lubricants','assets/icons/engine-oil.png','Keep your engine running smoothly. Explore oils and everyday lubricants.'),
    make('parts','Spare Parts','assets/icons/spare-parts.png','Brakes, chains and the everyday parts that keep your ride on the road.'),
    make('after','Aftermarket Parts','assets/icons/modifications.png','Make it your own. Explore performance parts, lighting and upgrades.'),
    {id:'gear-card',kind:'category',target:'helmets',name:'Riding Gear',image:'assets/icons/riding-gear.png',previewImage:'',description:'Get ready for the ride with gloves, jackets and protective essentials.',subcategories:['Hand Gloves','Rider Jacket','Raincoat','Intercom','Windbreaker','Safety Item'],button:'Explore',included:[],visible:true},
    make('tyres','Tyre','assets/icons/tyres.png','Find your next set of tyres. Ask our team to confirm the right size.'),
    make('helmets','Helmet','assets/icons/helmets.png','Find a lid that suits your ride. Check the fit and certification before you buy.',['Helmets'])
  ];
  const serviceNames={servicing:['Bike Servicing','A little care. A better ride. Mechanical checks, maintenance and tuning.'],modifications:['Modification','Your bike, your way. Talk upgrades, comfort and custom details.'],painting:['Painting','Fresh colour. Fresh attitude. Panel resprays and full colour changes.'],washing:['Washing','Give your ride a fresh start with a wash and finishing care.']};
  const services=data.blocks.filter(b=>b.kind==='service').map(b=>({...b,...(serviceNames[b.target]?{name:serviceNames[b.target][0],description:serviceNames[b.target][1]}:{}),previewImage:b.previewImage||''}));
  data.blocks=[...cards,...data.blocks.filter(b=>b.kind==='category'&&!cards.some(c=>c.id===b.id)),...services];
  for(const p of data.products){if(['hel-agv-k1','hel-smk','hel-mt-thunder'].includes(p.id)&&!p.subcategory)p.subcategory='Helmets';if(p.id==='hel-gloves'&&!p.subcategory)p.subcategory='Hand Gloves';}
  data.content=data.content.filter(s=>!removedHomeSections.includes(s.id));
  const fields = (prefix,label,title,intro) => [
    {id:prefix+'-label',kind:'text',label:'Small label',value:label},
    {id:prefix+'-title',kind:'text',label:'Heading',value:title},
    {id:prefix+'-intro',kind:'text',label:'Introduction',value:intro}
  ];
  const category=data.content.find(s=>s.id==='index-brands');
  if(category){category.name='Homepage categories';category.fields=fields('home-category','SHOP BY CATEGORY','Category','Your next upgrade starts here. Hover for a closer look, or tap to explore.');}
  const service=data.content.find(s=>s.id==='index-services');
  if(service){service.name='Homepage servicing';service.fields=fields('home-service','TAKE CARE OF YOUR RIDE','Servicing','From everyday care to a fresh new look. Choose a service to see what is included.');data.content.splice(data.content.indexOf(service),1);data.content.splice(data.content.findIndex(s=>s.id==='index-brands')+1,0,service);}
  data.content.forEach((s,i)=>{s.order=i;for(const f of s.fields){if(f.kind==='link'&&f.value==='index.html#pricing')f.value='book.html';if(f.kind==='text'&&f.value==='Pricing')f.value='Book a service';if(s.id==='index-section-5'&&f.value==='Come by the bay')f.value='Contact';}});
  return data;
}
