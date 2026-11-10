// Delivery charges added to every product order bill. The areas and fees come from
// Store settings (settings.delivery), falling back to the defaults. Shared by the
// website and the server, so the customer always sees the same total the store records.
import {STORE_DEFAULTS, storeSettings} from './store-defaults.mjs';

export const defaultDeliveryAreas = STORE_DEFAULTS.delivery;
// Back-compat alias for older imports.
export const deliveryOptions = defaultDeliveryAreas;

// The areas customers can choose, in the order staff set them.
export function deliveryAreas(settings) {
  return storeSettings(settings).delivery.filter(a => a.visible !== false);
}

export function deliveryOption(id, settings) {
  return deliveryAreas(settings).find(o => o.id === id) || null;
}
