export const units=['piece','bottle','can','set','pair','pack','litre'];
export const counted=value=>Number.isSafeInteger(value)&&value>=0;
export function quantityOf(product){
  if(counted(product.quantity))return product.quantity;
  if(product.colors?.length&&product.colors.every(c=>counted(c.quantity)))return product.colors.reduce((n,c)=>n+(c.stock==='Out of stock'?0:c.quantity),0);
  return null;
}
export function availableQuantity(product,colour){
  const total=quantityOf(product),variant=colour&&counted(colour.quantity)?colour.quantity:null;
  return total===null?variant:variant===null?total:Math.min(total,variant);
}
export function stockStatus(product,colour){
  if(product.stock==='Out of stock'||colour?.stock==='Out of stock'||availableQuantity(product,colour)===0||product.colors?.length&&product.colors.every(c=>c.stock==='Out of stock'||c.quantity===0))return 'Out of stock';
  return product.stock==='Ask us'?'Ask us':'In stock';
}
export function stockLabel(product,colour){
  const status=stockStatus(product,colour),quantity=availableQuantity(product,colour);
  if(status==='Out of stock'||quantity===null)return status;
  const unit=product.unit||'piece';
  return `${quantity} ${unit}${quantity===1?'':'s'} available`;
}
