// WhatsApp messages the website prefills. Built from Store settings (name, greeting,
// delivery areas), so the default output equals the text the website always sent.
import {storeSettings} from '../supabase/functions/_shared/store-defaults.mjs';
import {deliveryAreas} from '../supabase/functions/_shared/delivery.mjs?v=dyn-2';

// "Inside Kushtia" reads "৳120 inside Kushtia" mid-sentence; place names such as "Dhaka" keep their capital.
const lowerFirst = s => /^(inside|outside|within|near|beyond|around|across|rest|other|city|anywhere|all|same|next)\b/i.test(s || '') ? s[0].toLowerCase() + s.slice(1) : s;

// "Assalamu alaikum, Moto Market."
export function greetingLine(settings) {
  const s = storeSettings(settings);
  return `${s.whatsappGreeting}, ${String(s.name || '').trim() || 'Moto Market'}.`;
}

// items: [{name, colorName?, qty, price}] (price per unit, whole taka); total: products total.
export function orderMessage(items, total, settings) {
  const hello = greetingLine(settings);
  if (!items?.length) return `${hello} I'd like to ask about a part.`;
  const lines = items.map(i => `• ${i.name}${i.colorName ? ' (' + i.colorName + ')' : ''} ×${i.qty} — ৳${i.price * i.qty}`).join('\n');
  const fees = deliveryAreas(settings).map(a => `৳${a.fee} ${lowerFirst(a.label)}`).join(' / ');
  return `${hello} I'd like to order:\n${lines}\n\nProducts total: ৳${total} + delivery charge (${fees})`;
}

// The fitment scanner's "Not listed?" message.
export function rideMessage(model, settings) {
  return `${greetingLine(settings)} I ride a ${model}. Can you check parts for it?`;
}
