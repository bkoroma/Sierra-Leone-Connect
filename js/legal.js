// Fills contact details on the public policy pages. The SuperAdmin can change the support / safety
// e-mail in App settings; those values win over config.js.
import { CONFIG } from './config.js';
const map = { support: CONFIG.SUPPORT_EMAIL, safety: CONFIG.SAFETY_EMAIL || CONFIG.SUPPORT_EMAIL, operator: CONFIG.OPERATOR || 'Sierra Leone Connect', url: CONFIG.APP_URL };
const fill = () => document.querySelectorAll('[data-cfg]').forEach(el => {
  const v = map[el.dataset.cfg]; if (!v) return;
  el.textContent = v;
  if (el.tagName === 'A') el.href = /@/.test(v) ? 'mailto:' + v : v;
});
document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
fill();
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), 4000);
  fetch(CONFIG.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/get_settings', {
    method: 'POST', signal: ctl.signal,
    headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: '{}'
  }).then(r => r.ok ? r.json() : null).then(s => {
    if (!s) return;
    if (s.supportEmail) map.support = s.supportEmail;
    if (s.safetyEmail || s.supportEmail) map.safety = s.safetyEmail || s.supportEmail;
    fill();
  }).catch(() => { /* keep config.js values */ });
}
