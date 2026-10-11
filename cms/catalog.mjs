import {stockStatus,availableQuantity,quantityOf} from '../supabase/functions/_shared/inventory.mjs';
export const normalise=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
export function findVehicles(vehicles,query,type='bike'){
 const q=normalise(query);return vehicles.filter(v=>v.visible!==false&&v.type===type&&(!q||normalise(v.brand+' '+v.name).includes(q)||normalise(v.name).includes(q))).sort((a,b)=>Number(normalise(b.name).startsWith(q))-Number(normalise(a.name).startsWith(q))).slice(0,12);
}
export function fitsVehicle(product,vehicle){
 if(!vehicle)return true;
 return product.fitment==='Selected vehicles'&&product.vehicleIds?.includes(vehicle.id)||product.fitment==='Universal'&&product.vehicleTypes?.includes(vehicle.type);
}
export function availableColour(product,id){return product.colors?.find(c=>c.id===id&&stockStatus(product,c)!=='Out of stock');}
export function cartLine(product,previous){
 if(!product||stockStatus(product)==='Out of stock')return null;
 const color=availableColour(product,previous.colorId);
 if(product.colors?.length&&!color)return null;
 return {id:product.id,lineKey:product.id+'::'+(color?.id||''),name:product.name,cat:product.category,price:product.sale||product.price,qty:Math.min(50,availableQuantity(product,color)??50,Math.max(1,Math.floor(Number(previous.qty)||1))),colorId:color?.id||'',colorName:color?.name||'',unit:product.unit||'piece'};
}
export function cartInventory(products,items){
 const totals=new Map(),lines=new Set(),result=[];
 for(const previous of items){
  const product=products.find(p=>p.id===previous.id),line=cartLine(product,previous);
  if(!line||lines.has(line.lineKey))continue;
  lines.add(line.lineKey);
  const remaining=quantityOf(product)===null?50:Math.max(0,quantityOf(product)-(totals.get(product.id)||0));
  line.qty=Math.min(line.qty,remaining);if(!line.qty)continue;
  totals.set(product.id,(totals.get(product.id)||0)+line.qty);result.push(line);
 }
 return result;
}
