export const normalise=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
export function findVehicles(vehicles,query,type='bike'){
 const q=normalise(query);return vehicles.filter(v=>v.visible!==false&&v.type===type&&(!q||normalise(v.brand+' '+v.name).includes(q)||normalise(v.name).includes(q))).sort((a,b)=>Number(normalise(b.name).startsWith(q))-Number(normalise(a.name).startsWith(q))).slice(0,12);
}
export function fitsVehicle(product,vehicle){
 if(!vehicle)return true;
 return product.fitment==='Selected vehicles'&&product.vehicleIds?.includes(vehicle.id)||product.fitment==='Universal'&&product.vehicleTypes?.includes(vehicle.type);
}
export function availableColour(product,id){return product.colors?.find(c=>c.id===id&&c.stock!=='Out of stock');}
export function cartLine(product,previous){
 if(!product||product.stock==='Out of stock')return null;
 const color=availableColour(product,previous.colorId);
 if(product.colors?.length&&!color)return null;
 return {id:product.id,lineKey:product.id+'::'+(color?.id||''),name:product.name,cat:product.category,price:product.sale||product.price,qty:Math.min(50,Math.max(1,Math.floor(Number(previous.qty)||1))),colorId:color?.id||'',colorName:color?.name||''};
}
