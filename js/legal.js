// Fills contact details on the public policy pages from config.js
import { CONFIG } from './config.js';
const map = { support: CONFIG.SUPPORT_EMAIL, safety: CONFIG.SAFETY_EMAIL || CONFIG.SUPPORT_EMAIL, operator: CONFIG.OPERATOR || 'Sierra Leone Connect', url: CONFIG.APP_URL };
document.querySelectorAll('[data-cfg]').forEach(el => {
  const v = map[el.dataset.cfg]; if (!v) return;
  el.textContent = v;
  if (el.tagName === 'A') el.href = /@/.test(v) ? 'mailto:' + v : v;
});
document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
