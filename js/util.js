// Small, dependency-free helpers. All HTML goes through h`` which escapes every interpolation.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = s => String(s ?? '').replace(/[&<>"'`]/g, c => ESC[c]);

export class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const fmt = v => v instanceof Safe ? v.s : Array.isArray(v) ? v.map(fmt).join('') : (v === false || v == null ? '' : esc(v));
export const h = (strings, ...vals) => new Safe(strings.reduce((o, s, i) => o + s + (i < vals.length ? fmt(vals[i]) : ''), ''));
export const raw = s => new Safe(String(s));

// Only allow images we created (data:image) or https URLs (Supabase storage).
export const safeImg = u => (typeof u === 'string' && (/^data:image\/(png|jpe?g|webp|svg\+xml);/i.test(u) || /^https:\/\//i.test(u))) ? u : '';

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

export function ageOf(dob) {
  if (!dob) return null;
  const d = new Date(dob), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
  return a;
}

export function timeAgo(t) {
  const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 604800) return Math.floor(s / 86400) + 'd';
  return new Date(t).toLocaleDateString();
}
export const isOnline = t => t && Date.now() - new Date(t).getTime() < 10 * 60 * 1000;

export function haversineKm(a, b) {
  if (a?.lat == null || b?.lat == null) return null;
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}
export const fmtKm = km => km == null ? '' : km < 1 ? '<1 km' : km < 100 ? km + ' km' : km < 1000 ? Math.round(km / 10) * 10 + ' km' : (km / 1000).toFixed(1) + 'k km';

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Resize an uploaded image to a compact JPEG data URL (strips EXIF/GPS metadata as a side effect).
export function resizeImage(file, max = 900, q = 0.82) {
  return new Promise((res, rej) => {
    if (!/^image\//.test(file.type)) return rej(new Error('Please choose an image file.'));
    if (file.size > 15 * 1024 * 1024) return rej(new Error('Image is too large (max 15 MB).'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image.')); };
    img.src = url;
  });
}

let toastTimer;
export function toast(msg, kind = '') {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.append(el); }
  el.className = 'toast show ' + kind;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export const todayKey = () => new Date().toISOString().slice(0, 10);

// Scam Shield — patterns common in romance scams (money asks, off-platform pulls, payment rails).
const SCAM_PATTERNS = [
  [/\b(send|wire|transfer|lend|loan|borrow)\b.{0,25}\b(money|cash|funds|\$|£|€|usd|le\b|leones?)/i, 'money request'],
  [/\b(western\s*union|money\s*gram|orange\s*money|afri\s*money|cash\s*app|zelle|venmo|paypal|remitly|world\s*remit|taptap\s*send|lemfi)\b/i, 'payment service'],
  [/\b(gift\s*cards?|itunes\s*card|steam\s*card|amazon\s*card)\b/i, 'gift cards'],
  [/\b(bitcoin|btc|usdt|crypto|binance|forex|investment\s*plan|double\s*your)\b/i, 'crypto / investment'],
  [/\b(transport|visa|ticket|hospital|school)\s*(fee|money|fare)\b/i, 'fee request'],
  [/\b(whats\s*app|telegram|signal|snap(chat)?|hangouts?)\b/i, 'off-platform contact'],
  [/(\+?\d[\d\s().-]{8,}\d)/, 'phone number'],
  [/(https?:\/\/|www\.)\S+/i, 'external link']
];
export function scamCheck(text) {
  const hits = [];
  for (const [re, label] of SCAM_PATTERNS) if (re.test(text)) hits.push(label);
  return hits;
}
