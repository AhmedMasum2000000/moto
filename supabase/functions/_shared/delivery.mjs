// Delivery charges added to every product order bill. Shared by the website and the server,
// so the customer always sees the same total the store records.
export const deliveryOptions = [
  {id: 'inside', label: 'Inside Kushtia', fee: 120},
  {id: 'outside', label: 'Outside Kushtia', fee: 150},
];

export function deliveryOption(id) {
  return deliveryOptions.find(o => o.id === id) || null;
}
