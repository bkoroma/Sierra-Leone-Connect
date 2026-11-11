// Fills operator and contact details on the public legal pages. The SuperAdmin sets these in
// App settings (support / safety e-mail, business name, address, country); config.js is the fallback.
import { CONFIG } from './config.js';
const map = { support: CONFIG.SUPPORT_EMAIL, safety: CONFIG.SAFETY_EMAIL || CONFIG.SUPPORT_EMAIL, operator: CONFIG.OPERATOR || 'Sierra Leone Connect', url: CONFIG.APP_URL, address: '', country: '' };
const fill = () => {
  document.querySelectorAll('[data-cfg]').forEach(el => {
    const v = map[el.dataset.cfg]; if (!v) return;
    el.textContent = v;
    if (el.tagName === 'A') el.href = /@/.test(v) ? 'mailto:' + v : v;
  });
  document.querySelectorAll('[data-needs]').forEach(el => { el.hidden = !map[el.dataset.needs]; });
};
document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
fill();
const apply = s => {
  if (!s) return;
  if (s.supportEmail) map.support = s.supportEmail;
  if (s.safetyEmail || s.supportEmail) map.safety = s.safetyEmail || s.supportEmail;
  if (s.operatorName) map.operator = s.operatorName;
  if (s.operatorAddress) map.address = s.operatorAddress;
  if (s.operatorCountry) map.country = s.operatorCountry;
  fill();
};
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), 4000);
  fetch(CONFIG.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/get_settings', {
    method: 'POST', signal: ctl.signal,
    headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: '{}'
  }).then(r => r.ok ? r.json() : null).then(apply).catch(() => { /* keep config.js values */ });
} else {
  try { apply(JSON.parse(localStorage.getItem('slc_db_v2') || 'null')?.settings); } catch { /* demo data unavailable */ }
}
