// Shared content model (ids, normalise, layout, references). The implementation lives next to the
// other modules the moto-admin Edge Function bundles (supabase/functions/_shared), so the server
// schema and the browser import the very same code and derive identical ids.
export * from '../supabase/functions/_shared/content-model.mjs';
