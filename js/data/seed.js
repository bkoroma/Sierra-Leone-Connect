// Demo-mode sample community. Avatars are generated illustrations — never photos of real people.
import { CITIES, DISTRICTS, HERITAGE, FAITHS, INTERESTS, PROMPTS, INTENTS, QUESTIONS } from '../constants.js';

const W = ['Fatmata', 'Aminata', 'Mariama', 'Isatu', 'Hawa', 'Kadiatu', 'Zainab', 'Adama', 'Jeneba', 'Christiana', 'Mabinty', 'Salamatu', 'Ramatu', 'Yeabu', 'Memuna', 'Josephine', 'Kumba', 'Finda', 'Nancy', 'Bintu', 'Sia', 'Esther', 'Haja', 'Isha'];
const M = ['Mohamed', 'Abdul', 'Ibrahim', 'Alusine', 'Sahr', 'Foday', 'Sorie', 'Ishmael', 'Joseph', 'Emmanuel', 'Augustine', 'Musa', 'Osman', 'Tamba', 'Kelvin', 'Samuel', 'Abu', 'Sheku', 'Lamin', 'Daniel', 'Brima', 'Santigie', 'Momoh', 'Idrissa'];
const JOBS = ['Nurse', 'Software engineer', 'Teacher', 'Accountant', 'Entrepreneur', 'Pharmacist', 'Banker', 'Student', 'Fashion designer', 'Civil engineer', 'Social worker', 'Lawyer', 'Chef', 'Real estate agent', 'IT support', 'Doctor', 'Journalist', 'Logistics manager'];
const EDU = ['Fourah Bay College', 'Njala University', 'University of Makeni', 'IPAM', 'Bowie State University', 'University of Maryland', 'King\'s College London', 'University of Toronto', 'Community college', 'Secondary school'];
const BIOS = [
  'Salone to the bone 🇸🇱 Family first, faith always. Looking for someone kind who can make me laugh.',
  'Born in Freetown, raised abroad, heart still at Lumley Beach. I cook a mean cassava leaf.',
  'Quiet confidence, loud laugh. I love good music, long talks and Sunday family lunches.',
  'Building my business and my future. Want a partner who dreams big and stays humble.',
  'Proud of where I come from. Let\'s plan a trip home together one day ✈️',
  'Nurse by day, Afrobeats dancer by night 😄 Ready for something real.',
  'God-fearing, hardworking and loyal. I believe in respect and good communication.',
  'Diaspora kid who still speaks Krio fluently — test me 😅',
  'Love football, love jollof, love my people. Simple as that.',
  'Looking for my best friend first. Everything else go follow.'
];
const ANSWERS = [
  'Good jollof, honest talk and patience 😊', 'Cassava leaf with fish — no debate!', 'Church/mosque, family lunch, then a beach walk.',
  'you can laugh at yourself and respect my mama 😄', 'Consistency. Say wetin you go do, do wetin you say.', 'Bo! Di people warm and di food sweet.',
  'Visit all 16 districts.', 'My little brother\'s jokes. He no get sense 😂', 'We close. Sunday lunch is non-negotiable.',
  'Anything by Emmerson. Classic!', 'Lumley Beach for sunset, then grilled fish.', 'Honesty and kindness, always.'
];
const PAL = [['#0F9D58', '#0B5D3B'], ['#0072C6', '#003F73'], ['#FF6B47', '#B83A1E'], ['#D4AF37', '#8A6D12'], ['#7C3AED', '#4C1D95'], ['#0EA5A4', '#075E5D'], ['#E11D48', '#881337'], ['#2563EB', '#1E3A8A']];

function seedAnswers(r, country) {
  const out = {};
  const imp = () => { const x = r(); return x < .1 ? 0 : x < .25 ? 1 : x < .65 ? 2 : x < .95 ? 3 : 4; };
  for (const q of QUESTIONS) {
    if (r() > (q.core ? .95 : .55)) continue;
    let m = Math.floor(r() * q.opts.length);
    if (q.id === 'move_home') m = country === 'Sierra Leone' ? 4 : Math.min(m, 3);
    if (q.id === 'visit_home') m = country === 'Sierra Leone' ? 3 : Math.min(m, 2);
    if (q.id === 'polygamy') m = r() < .75 ? 0 : 1;
    const a = q.opts.map((_, k) => k).filter(k => k === m || r() < .45);
    out[q.id] = { m, a, i: imp() };
  }
  return out;
}

function rng(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }

export function avatarSVG(name, idx, variant = 0) {
  const [a, b] = PAL[(idx + variant) % PAL.length];
  const skin = ['#5B3A29', '#6B4430', '#4A2E20', '#7A4E35'][(idx + variant) % 4];
  const initial = (name || '?')[0].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 520"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><radialGradient id="r" cx=".5" cy=".3" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="400" height="520" fill="url(#g)"/><rect width="400" height="520" fill="url(#r)"/><g opacity=".12" fill="#fff">${variant % 2 ? '<circle cx="330" cy="90" r="70"/><circle cx="60" cy="430" r="40"/>' : '<path d="M0 380 Q200 300 400 380 V520 H0Z"/><circle cx="70" cy="80" r="30"/>'}</g><circle cx="200" cy="215" r="78" fill="${skin}"/><path d="M60 520 C70 380 140 330 200 330 C260 330 330 380 340 520Z" fill="${skin}"/><text x="200" y="482" font-family="Sora,Arial,sans-serif" font-size="44" font-weight="700" fill="#fff" fill-opacity=".9" text-anchor="middle">${initial}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function seedProfiles(n = 48) {
  const r = rng(20261028);
  const pick = a => a[Math.floor(r() * a.length)];
  const pickN = (a, k) => { const c = [...a], o = []; while (o.length < k && c.length) o.push(c.splice(Math.floor(r() * c.length), 1)[0]); return o; };
  const out = [];
  const year = new Date().getFullYear();
  for (let i = 0; i < n; i++) {
    const woman = i % 2 === 0;
    const name = woman ? W[(i / 2) % W.length | 0] : M[((i - 1) / 2) % M.length | 0];
    const city = r() < 0.38 ? pick(CITIES.slice(0, 7)) : pick(CITIES.slice(7));
    const age = 21 + Math.floor(r() * 22);
    const dob = `${year - age}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 27)).padStart(2, '0')}`;
    const prompts = pickN(PROMPTS.map((q, k) => ({ q, a: ANSWERS[k] })), 3);
    const photos = [0, 1, 2].slice(0, 2 + Math.floor(r() * 2)).map(v => avatarSVG(name, i, v));
    const langs = ['Krio', 'English', ...pickN(['Mende', 'Temne', 'Limba', 'Fula', 'Mandingo', 'Kono', 'French'], Math.floor(r() * 2))];
    out.push({
      id: 'seed-' + i,
      name, username: name.toLowerCase() + '.' + (i + 7), dob, gender: woman ? 'woman' : 'man',
      intent: pick(INTENTS).id,
      city: city.city, country: city.country,
      lat: city.lat + (r() - 0.5) * 0.08, lng: city.lng + (r() - 0.5) * 0.08,
      homeDistrict: pick(DISTRICTS), heritage: pick(HERITAGE.slice(0, 12)), faith: pick(FAITHS.slice(0, 3)),
      languages: langs, interests: pickN(INTERESTS, 4 + Math.floor(r() * 4)), prompts, photos,
      bio: BIOS[i % BIOS.length], job: pick(JOBS), education: pick(EDU), heightCm: 155 + Math.floor(r() * 35),
      prefs: { ageMin: 21, ageMax: 50, seeking: [woman ? 'man' : 'woman'], mode: 'worldwide', maxKm: 100 },
      verified: r() < 0.55, verificationStatus: 'none',
      lastActive: new Date(Date.now() - Math.floor(r() * 5 * 864e5)).toISOString(),
      createdAt: new Date(Date.now() - Math.floor(r() * 60 * 864e5)).toISOString(),
      completeness: 80 + Math.floor(r() * 20),
      answers: seedAnswers(r, city.country),
      likesNewUsers: r() < 0.45, // demo only: whether this sample member "likes" you
      bot: true
    });
  }
  out.slice(0, 6).forEach((p, k) => p.createdAt = new Date(Date.now() - (k + 1) * 6 * 36e5).toISOString()); // "New here"
  // Mark a few online right now
  out.slice(0, 10).forEach(p => p.lastActive = new Date(Date.now() - Math.floor(r() * 6) * 60000).toISOString());
  return out;
}
