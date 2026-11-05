// Picks the backend: Supabase when configured, otherwise the in-browser demo.
import { CONFIG } from '../config.js';

let api;
export async function getApi() {
  if (api) return api;
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
    const { createSupabaseApi } = await import('./supabase.js');
    api = await createSupabaseApi(CONFIG);
  } else {
    const { demo } = await import('./demo.js');
    api = demo;
  }
  await api.init();
  return api;
}
