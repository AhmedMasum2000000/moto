// Store-wide settings that staff edit in Control Room → Store settings.
// Every value is optional in the saved document: a missing value falls back to the
// default below, which equals what the website showed before these became editable.
export const STORE_DEFAULTS = Object.freeze({
  // Delivery areas offered on product orders. fee is whole taka.
  delivery: Object.freeze([
    Object.freeze({id: 'inside', label: 'Inside Kushtia', fee: 120}),
    Object.freeze({id: 'outside', label: 'Outside Kushtia', fee: 150}),
  ]),
  // Private: where new-order emails go. Empty = the public store email. Never published.
  orderEmail: '',
  // "Moto Market — a sister concern of …". An explicit empty string hides the line.
  parentCompany: 'Motolube Bangladesh',
  invoiceNote: 'Our team will call to confirm stock and price before delivery.',
  paymentMethods: 'Cash · bKash · Nagad',
  requestReceived: 'Request received. The team will contact you to confirm availability and price.',
  // Booking time choices after the always-present "Any time".
  bookingSlots: Object.freeze(['Morning · 9:00 – 12:00', 'Afternoon · 12:00 – 4:00', 'Evening · 4:00 – 8:00']),
  whatsappGreeting: 'Assalamu alaikum',
});

const isText = v => typeof v === 'string';

// Settings with defaults filled in. Never mutates the input.
export function storeSettings(settings = {}) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const out = {...s};
  for (const key of ['invoiceNote', 'paymentMethods', 'requestReceived', 'whatsappGreeting'])
    out[key] = isText(s[key]) && s[key].trim() ? s[key].trim() : STORE_DEFAULTS[key];
  out.orderEmail = isText(s.orderEmail) ? s.orderEmail.trim() : '';
  // parentCompany: absent → default; '' → hidden on purpose.
  out.parentCompany = isText(s.parentCompany) ? s.parentCompany.trim() : STORE_DEFAULTS.parentCompany;
  out.bookingSlots = Array.isArray(s.bookingSlots)
    ? s.bookingSlots.filter(x => isText(x) && x.trim()).map(x => x.trim())
    : [...STORE_DEFAULTS.bookingSlots];
  out.delivery = Array.isArray(s.delivery) && s.delivery.some(a => a && a.visible !== false)
    ? s.delivery.map(a => ({...a}))
    : STORE_DEFAULTS.delivery.map(a => ({...a}));
  return out;
}
