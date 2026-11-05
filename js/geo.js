// Location helpers for sign-up. No third-party services: GPS is matched to our own city list,
// and the device time zone is the fallback (works even when location permission is denied).
import { COUNTRIES, TZ_COUNTRY } from './geo-data.js';
import { CITIES } from './constants.js';
import { haversineKm } from './util.js';

export const countryByCode = c => (COUNTRIES.find(x => x[0] === c) || [])[1] || '';
export const codeByCountry = n => (COUNTRIES.find(x => x[1] === n) || [])[0] || '';

export function guessFromTimezone() {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
  const code = TZ_COUNTRY[tz];
  return code ? { code, country: countryByCode(code), city: '', lat: null, lng: null, source: 'timezone' } : null;
}

export function detectLocation({ timeout = 12000 } = {}) {
  const fallback = () => guessFromTimezone() || { code: '', country: '', city: '', lat: null, lng: null, source: 'none' };
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(fallback());
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = +pos.coords.latitude.toFixed(2), lng = +pos.coords.longitude.toFixed(2); // ~1 km precision only
      const near = CITIES.map(c => ({ c, km: haversineKm({ lat, lng }, c) })).sort((a, b) => a.km - b.km)[0];
      if (near && near.km <= 120) return resolve({ code: codeByCountry(near.c.country), country: near.c.country, city: near.c.city, lat, lng, source: 'gps' });
      const tz = guessFromTimezone();
      resolve({ ...(tz || { code: '', country: '' }), city: '', lat, lng, source: tz ? 'gps+timezone' : 'gps' });
    }, () => resolve(fallback()), { enableHighAccuracy: false, timeout, maximumAge: 10 * 60 * 1000 });
  });
}

export const USERNAME_RE = /^(?![._])(?!.*[._]$)(?!.*[._]{2})[a-z0-9._]{3,20}$/;
export const normalizeUsername = u => String(u || '').trim().replace(/^@+/, '').toLowerCase();
