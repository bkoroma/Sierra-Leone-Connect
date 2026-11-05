// Sierra Leone Connect — member app
import { getApi } from './data/index.js';
import { $, $$, h, raw, esc, safeImg, ageOf, timeAgo, isOnline, fmtKm, toast, resizeImage, todayKey, scamCheck } from './util.js';
import { DISTRICTS, HERITAGE, FAITHS, LANGUAGES, INTENTS, intentById, INTERESTS, PROMPTS, CITIES, flagOf, REPORT_REASONS, DECK_MODES, ICEBREAKERS, QUESTIONS, Q_CATS, IMPORTANCE, qById, THIS_OR_THAT } from './constants.js';
import { rankDeck, score, completeness, openers, defaultPrefs, fullPrefs } from './match.js';
import { I } from './icons.js';
import { COUNTRIES } from './geo-data.js';
import { detectLocation, USERNAME_RE, normalizeUsername } from './geo.js';
import { debounce } from './util.js';

let api, session, me, settings, autoLocateRef = () => {};
const S = { mode: localStorage.getItem('slc_mode') || 'worldwide', deck: [], deckLoaded: false, lastSwiped: null, likes: [], matches: [], unread: 0, likeCount: 0, chatUnsub: null };

const bg = u => `background-image:url("${safeImg(u).replace(/["'()\\\s]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))}")`;
const photo = p => (p?.photos || [])[0] || '';
const nameAge = p => h`<span>${p.name}<span class="age">, ${ageOf(p.dob) ?? ''}</span></span>`;
const vbadge = p => p?.verified ? h`<span class="verified" title="Photo verified" aria-label="Verified">✓</span>` : '';
const place = p => h`${flagOf(p.country)} ${p.city || p.country || ''}`;

// ───────────────────────── Boot ─────────────────────────
boot().catch(e => { console.error(e); document.body.innerHTML = `<p style="padding:24px">Something went wrong loading the app. ${esc(e.message)}</p>`; });

async function boot() {
  const native = !!window.Capacitor?.isNativePlatform?.();
  if (native) setupNative(); // Android app: files ship inside the APK, so no service worker
  else if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  $('#yr').textContent = new Date().getFullYear();
  api = await getApi();
  settings = await api.settings();
  session = await api.session();
  if (api.mode === 'demo') $('#demo-note').classList.remove('hidden');
  bindLanding();
  if (!session) return showLanding();
  await enter();
}

// ───────────────────────── Landing & auth ─────────────────────────
function showLanding() {
  document.body.classList.remove('in-app');
  $('#root').innerHTML = '';
  $('#landing').classList.remove('hidden');
  $('#tab-login')?.click();
  if (/^#(terms|privacy|safety)$/.test(location.hash)) infoSheet(location.hash.slice(1));
}

function bindLanding() {
  const setTab = t => {
    $('#tab-login').setAttribute('aria-selected', t === 'login');
    $('#tab-signup').setAttribute('aria-selected', t === 'signup');
    $('#form-login').classList.toggle('hidden', t !== 'login');
    $('#form-signup').classList.toggle('hidden', t !== 'signup');
  };
  $('#tab-login').onclick = () => setTab('login');
  $('#tab-signup').onclick = () => { setTab('signup'); autoLocate(); };
  $$('[data-goto]').forEach(b => b.onclick = () => { setTab(b.dataset.goto); if (b.dataset.goto === 'signup') autoLocate(); $('#auth').scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => $(`#form-${b.dataset.goto} input`).focus(), 350); });
  $$('.js-info').forEach(a => a.onclick = e => { e.preventDefault(); infoSheet(a.getAttribute('href').slice(1)); });

  $('#form-login').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), btn = e.target.querySelector('[type=submit]');
    $('#login-err').textContent = ''; btn.disabled = true;
    try {
      session = await api.signIn({ email: f.get('email'), password: f.get('password') });
      session = await api.session();
      await enter();
    } catch (err) { $('#login-err').textContent = err.message; }
    btn.disabled = false;
  };
  $('#forgot').onclick = async () => {
    const email = $('#form-login [name=email]').value.trim();
    if (!email) { $('#login-err').textContent = 'Enter your email above first.'; return; }
    try { const r = await api.resetPassword(email); toast(r?.note || 'Check your email for a reset link.'); } catch (err) { $('#login-err').textContent = err.message; }
  };
  // ── Sign-up: names, unique username, auto-detected country ──
  const sel = $('#su-country');
  sel.insertAdjacentHTML('beforeend', COUNTRIES.map(([code, name]) => h`<option value="${name}" data-code="${code}">${flagOf(name)} ${name}</option>`).join(''));
  const geo = { lat: null, lng: null, city: '' };
  let located = false;
  const geoHint = $('#su-geo-hint');
  async function autoLocate(force = false) {
    if (located && !force) return; located = true;
    geoHint.textContent = '📍 Detecting your location…'; geoHint.className = 'hint';
    const r = await detectLocation();
    Object.assign(geo, { lat: r.lat, lng: r.lng, city: r.city || '' });
    if (r.country && [...sel.options].some(o => o.value === r.country)) sel.value = r.country;
    geoHint.innerHTML = r.country
      ? h`${r.source === 'timezone' ? '🕑 Guessed from your time zone' : '📍 Detected'}: ${r.city ? r.city + ', ' : ''}${r.country}. <button type="button" class="link" id="su-geo">Detect again</button>`.toString()
      : h`Couldn't detect your location — please choose your country. <button type="button" class="link" id="su-geo">Try again</button>`.toString();
    geoHint.className = 'hint' + (r.country ? ' ok' : '');
    $('#su-geo').onclick = () => autoLocate(true);
  }
  autoLocateRef = autoLocate;
  $('#su-geo').onclick = () => autoLocate(true);
  sel.onchange = () => { geo.city = ''; geo.lat = geo.lng = null; geoHint.textContent = 'Country set manually.'; geoHint.className = 'hint'; };

  const pw1 = $('#form-signup [name=password]'), pw2 = $('#form-signup [name=password2]'), pwHint = $('#su-pw-hint');
  const checkPw = () => {
    if (!pw2.value) { pwHint.textContent = ''; pwHint.className = 'hint'; return; }
    const same = pw1.value === pw2.value;
    pwHint.textContent = same ? '✓ Passwords match' : 'Passwords don\'t match';
    pwHint.className = 'hint ' + (same ? 'ok' : 'bad');
  };
  pw1.addEventListener('input', checkPw); pw2.addEventListener('input', checkPw);
  const uIn = $('#form-signup [name=username]'), uHint = $('#su-user-hint');
  let userOk = false;
  const checkUser = debounce(async () => {
    const u = normalizeUsername(uIn.value);
    if (uIn.value !== u) uIn.value = u;
    userOk = false;
    if (!u) { uHint.textContent = '3–20 letters, numbers, dots or underscores.'; uHint.className = 'hint'; return; }
    if (!USERNAME_RE.test(u)) { uHint.textContent = 'Use 3–20 letters, numbers, single dots or underscores (not at the start or end).'; uHint.className = 'hint bad'; return; }
    try {
      const free = await api.usernameAvailable(u);
      if (normalizeUsername(uIn.value) !== u) return;
      userOk = free;
      uHint.textContent = free ? `✓ @${u} is available` : `@${u} is taken — try another.`;
      uHint.className = 'hint ' + (free ? 'ok' : 'bad');
    } catch { uHint.textContent = ''; }
  }, 350);
  uIn.oninput = checkUser;

  $('#form-signup').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), btn = e.target.querySelector('[type=submit]');
    const err = $('#signup-err'); err.textContent = '';
    const firstName = String(f.get('firstName') || '').trim(), lastName = String(f.get('lastName') || '').trim();
    const username = normalizeUsername(f.get('username')), country = f.get('country'), dob = f.get('dob'), gender = f.get('gender');
    if (firstName.length < 2) { err.textContent = 'Enter your first name.'; return; }
    if (lastName.length < 2) { err.textContent = 'Enter your last name.'; return; }
    if (!['woman', 'man'].includes(gender)) { err.textContent = 'Choose your gender.'; return; }
    if (!USERNAME_RE.test(username)) { err.textContent = 'Choose a valid username.'; return; }
    if (!country) { err.textContent = 'Choose your country.'; return; }
    if (String(f.get('password')).length < 8) { err.textContent = 'Password must be at least 8 characters.'; return; }
    if (f.get('password') !== f.get('password2')) { err.textContent = 'Passwords don\'t match.'; pw2.focus(); return; }
    if (!dob || ageOf(dob) < (settings.minAge || 18)) { err.textContent = `You must be ${settings.minAge || 18} or older to join.`; return; }
    if (!f.get('agree')) { err.textContent = 'Please confirm you are 18+ and agree to the terms.'; return; }
    btn.disabled = true;
    try {
      if (!(await api.usernameAvailable(username))) { err.textContent = `@${username} is taken — try another.`; btn.disabled = false; return; }
      await api.signUp({ email: f.get('email'), password: f.get('password'), dob, gender, firstName, lastName, username, country, city: geo.city, lat: geo.lat, lng: geo.lng });
      session = await api.session();
      if (!session) { err.textContent = ''; toast('Check your email to confirm your account, then log in.'); setTab('login'); btn.disabled = false; return; }
      await enter();
    } catch (x) { err.textContent = /database error/i.test(x.message) ? 'We couldn\'t create your account — that username may have just been taken. Try another.' : x.message; }
    btn.disabled = false;
  };
}

async function enter() {
  if (session?.status && session.status !== 'active') {
    const st = session.status, why = session.statusReason;
    await api.signOut(); session = null; showLanding();
    $('#login-err').textContent = st === 'banned' ? 'This account has been banned.' : 'This account is suspended.' + (why ? ' ' + why : '');
    return;
  }
  if (settings.maintenance && !['admin', 'superadmin'].includes(session.role)) {
    $('#landing').classList.add('hidden');
    $('#root').innerHTML = `<div class="empty" style="padding-top:20vh"><div class="big">🛠️</div><h3>We'll be right back</h3><p>Sierra Leone Connect is getting an upgrade. Please check back soon.</p></div>`;
    return;
  }
  me = await api.me();
  $('#landing').classList.add('hidden');
  if (!me.onboarded) return onboarding();
  shell();
}

// ───────────────────────── Onboarding ─────────────────────────
const STEPS = ['basics', 'roots', 'location', 'intent', 'interests', 'questions', 'prompts', 'photos'];

function onboarding(stepIdx = 0) {
  document.body.classList.add('in-app');
  const o = { ...me, languages: me.languages?.length ? me.languages : ['Krio', 'English'], interests: me.interests || [], prompts: me.prompts?.length ? me.prompts : [{ q: PROMPTS[0], a: '' }, { q: PROMPTS[1], a: '' }, { q: PROMPTS[3], a: '' }], photos: me.photos || [], prefs: fullPrefs(me) };
  let i = stepIdx;
  const render = () => {
    $('#root').innerHTML = `<div class="onb"><div class="onb-top"><span class="logo"><span class="logo-mark"></span>Sierra Leone Connect</span><div class="onb-progress">${STEPS.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div></div><div class="onb-body" id="onb-body"></div><div class="onb-foot">${i > 0 ? '<button class="btn btn-ghost" id="onb-back">Back</button>' : ''}<button class="btn btn-primary" style="flex:1" id="onb-next">${i === STEPS.length - 1 ? 'Start matching 🎉' : 'Continue'}</button></div></div>`;
    STEP[STEPS[i]].render($('#onb-body'), o);
    if ($('#onb-back')) $('#onb-back').onclick = () => { i--; render(); };
    $('#onb-next').onclick = async () => {
      const msg = STEP[STEPS[i]].validate(o);
      if (msg) return toast(msg, 'error');
      const btn = $('#onb-next'); btn.disabled = true;
      try {
        if (i < STEPS.length - 1) { await api.saveProfile(clean(o)); i++; render(); return; }
        if (!o.prefs.seeking?.length) o.prefs.seeking = [o.gender === 'man' ? 'woman' : 'man'];
        me = await api.saveProfile({ ...clean(o), onboarded: true });
        confetti();
        shell();
        toast(`Welcome, ${me.name}! Your community is waiting 🇸🇱`);
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    };
  };
  render();
}

const clean = o => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_') && !['answers', 'answersCount', 'completeness', 'id', 'createdAt', 'lastActive', 'verified', 'verificationStatus', 'streak', 'streakDay', 'qotdDay', 'email'].includes(k)));

// Step editors are shared by onboarding and "Edit profile".
const chipToggle = (wrap, arr, max, onChange) => wrap.addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  const v = b.dataset.v, k = arr.indexOf(v);
  if (k >= 0) arr.splice(k, 1); else { if (max && arr.length >= max) return toast(`Pick up to ${max}.`); arr.push(v); }
  b.setAttribute('aria-pressed', arr.includes(v)); onChange?.();
});
const chips = (list, sel) => list.map(v => h`<button type="button" class="chip" data-v="${v}" aria-pressed="${sel.includes(v)}">${v}</button>`);
const opts = (list, v) => list.map(x => h`<option ${x === v ? 'selected' : ''}>${x}</option>`);

const STEP = {
  basics: {
    render(el, o) {
      o.prefs = fullPrefs(o);
      if (!o.prefs.seeking?.length && o.gender) o.prefs.seeking = [o.gender === 'man' ? 'woman' : 'man']; // sensible default from sign-up gender
      el.innerHTML = h`<h1>Let's start with you</h1><p class="sub">Members see your username${o.username ? h` (@${o.username})` : ''} — your name stays private.</p>
        <label class="field"><span>First name (private)</span><input class="input" id="f-name" maxlength="30" value="${o.name || ''}" autocomplete="given-name"></label>
        <label class="field"><span>Date of birth</span><input class="input" type="date" id="f-dob" value="${o.dob || ''}"></label>
        <div class="field"><span>I am a</span><div class="chips" id="f-gender">${['woman', 'man'].map(g => h`<button type="button" class="chip" data-v="${g}" aria-pressed="${o.gender === g}">${g === 'woman' ? 'Woman' : 'Man'}</button>`)}</div></div>
        <div class="field"><span>Show me</span><div class="chips" id="f-seek">${['woman', 'man'].map(g => h`<button type="button" class="chip" data-v="${g}" aria-pressed="${(o.prefs.seeking || []).includes(g)}">${g === 'woman' ? 'Women' : 'Men'}</button>`)}</div></div>
        <div class="row"><label class="field"><span>Job (optional)</span><input class="input" id="f-job" maxlength="50" value="${o.job || ''}"></label><label class="field"><span>Height cm (optional)</span><input class="input" id="f-h" type="number" min="120" max="230" value="${o.heightCm || ''}"></label></div>
        <label class="field"><span>Education (optional)</span><input class="input" id="f-edu" maxlength="60" value="${o.education || ''}"></label>`;
      $('#f-name', el).oninput = e => o.name = e.target.value.trim();
      $('#f-dob', el).onchange = e => o.dob = e.target.value;
      $('#f-job', el).oninput = e => o.job = e.target.value.trim();
      $('#f-edu', el).oninput = e => o.education = e.target.value.trim();
      $('#f-h', el).oninput = e => o.heightCm = Number(e.target.value) || null;
      $('#f-gender', el).onclick = e => { const b = e.target.closest('.chip'); if (!b) return; o.gender = b.dataset.v; $$('#f-gender .chip', el).forEach(c => c.setAttribute('aria-pressed', c === b)); };
      o.prefs.seeking = o.prefs.seeking || [];
      chipToggle($('#f-seek', el), o.prefs.seeking, 2);
    },
    validate: o => !o.name || o.name.length < 2 ? 'Add your first name.' : !o.dob ? 'Add your date of birth.' : ageOf(o.dob) < (settings.minAge || 18) ? `You must be ${settings.minAge || 18}+.` : !o.gender ? 'Choose woman or man.' : !o.prefs.seeking.length ? 'Choose who you want to see.' : ''
  },
  roots: {
    render(el, o) {
      el.innerHTML = h`<h1>Your Salone roots 🇸🇱</h1><p class="sub">Matching people from the same home place is one of our strongest signals.</p>
        <label class="field"><span>Home district</span><select class="input" id="f-dist"><option value="">Choose…</option>${opts(DISTRICTS, o.homeDistrict)}</select></label>
        <div class="row"><label class="field"><span>Heritage</span><select class="input" id="f-her"><option value="">Choose…</option>${opts(HERITAGE, o.heritage)}</select></label>
        <label class="field"><span>Faith</span><select class="input" id="f-faith"><option value="">Choose…</option>${opts(FAITHS, o.faith)}</select></label></div>
        <div class="field"><span>Languages you speak</span><div class="chips" id="f-lang">${chips(LANGUAGES, o.languages)}</div></div>`;
      $('#f-dist', el).onchange = e => o.homeDistrict = e.target.value;
      $('#f-her', el).onchange = e => o.heritage = e.target.value;
      $('#f-faith', el).onchange = e => o.faith = e.target.value;
      chipToggle($('#f-lang', el), o.languages, 8);
    },
    validate: o => !o.homeDistrict ? 'Choose your home district.' : !o.languages.length ? 'Pick at least one language.' : ''
  },
  location: {
    render(el, o) {
      el.innerHTML = h`<h1>Where do you live now?</h1><p class="sub">Only your city is shown — never your exact location.</p>
        <button type="button" class="btn btn-ghost btn-block" id="f-geo" style="margin-bottom:14px">${raw(I.pin)} Use my current location</button>
        <label class="field"><span>Search city</span><input class="input" id="f-cq" placeholder="Freetown, London, Silver Spring…"></label>
        <div class="city-list" id="f-cities"></div>
        <details style="margin-top:14px"><summary class="link" style="cursor:pointer">My city isn't listed</summary>
          <div class="row" style="margin-top:10px"><input class="input" id="f-oc" placeholder="City" maxlength="40"><input class="input" id="f-oco" placeholder="Country" maxlength="60" value="${o.country || ''}"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="f-ocb" style="margin-top:8px">Use this city</button></details>
        <p class="tip" id="f-cur">${o.city ? h`Selected: ${flagOf(o.country)} ${o.city}, ${o.country}` : ''}</p>`;
      const list = $('#f-cities', el), cur = $('#f-cur', el);
      const pick = c => { Object.assign(o, { city: c.city, country: c.country, lat: c.lat ?? o.lat ?? null, lng: c.lng ?? o.lng ?? null }); cur.textContent = `Selected: ${flagOf(c.country)} ${c.city}, ${c.country}`; draw($('#f-cq', el).value); };
      const draw = q => { q = q.toLowerCase(); list.innerHTML = CITIES.filter(c => !q || (c.city + ' ' + c.country).toLowerCase().includes(q)).map(c => h`<button type="button" class="${o.city === c.city ? 'on' : ''}" data-c="${c.city}"><span>${flagOf(c.country)} ${c.city}</span><small style="color:var(--muted)">${c.country}</small></button>`).join(''); };
      draw(o.city ? '' : (o.country || ''));
      if (!o.city && o.country) $('#f-cq', el).value = o.country;
      $('#f-cq', el).oninput = e => draw(e.target.value);
      list.onclick = e => { const b = e.target.closest('button'); if (b) pick(CITIES.find(c => c.city === b.dataset.c)); };
      $('#f-ocb', el).onclick = () => { const c = $('#f-oc', el).value.trim(), co = $('#f-oco', el).value.trim(); if (c && co) pick({ city: c, country: co, lat: null, lng: null }); };
      $('#f-geo', el).onclick = () => {
        if (!navigator.geolocation) return toast('Location is not available on this device.');
        navigator.geolocation.getCurrentPosition(pos => {
          const lat = +pos.coords.latitude.toFixed(2), lng = +pos.coords.longitude.toFixed(2); // ~1 km precision only
          const near = CITIES.map(c => ({ c, d: Math.hypot(c.lat - lat, c.lng - lng) })).sort((a, b) => a.d - b.d)[0];
          pick({ ...(near.d < 1.2 ? near.c : { city: o.city || 'My area', country: o.country || '' }), lat, lng });
          toast('Location set ✓');
        }, () => toast('Location permission was denied. Pick your city instead.'), { timeout: 10000, maximumAge: 6e5 });
      };
    },
    validate: o => !o.city || !o.country ? 'Choose your city.' : ''
  },
  intent: {
    render(el, o) {
      el.innerHTML = h`<h1>What are you looking for?</h1><p class="sub">We'll put people who want the same thing first.</p>
        <div id="f-int" style="display:grid;gap:10px">${INTENTS.map(t => h`<button type="button" class="chip" style="text-align:left;padding:16px;border-radius:16px;font-size:16px" data-v="${t.id}" aria-pressed="${o.intent === t.id}">${t.icon} ${t.label}</button>`)}</div>`;
      $('#f-int', el).onclick = e => { const b = e.target.closest('.chip'); if (!b) return; o.intent = b.dataset.v; $$('#f-int .chip', el).forEach(c => c.setAttribute('aria-pressed', c === b)); };
    },
    validate: o => !o.intent ? 'Choose what you are looking for.' : ''
  },
  interests: {
    render(el, o) {
      el.innerHTML = h`<h1>What do you love?</h1><p class="sub">Pick 3–10. Shared interests power your first conversations.</p><div class="chips" id="f-ints">${chips(INTERESTS, o.interests)}</div><p class="tip" id="f-ic"></p>`;
      const c = () => $('#f-ic', el).textContent = `${o.interests.length} selected`;
      chipToggle($('#f-ints', el), o.interests, 10, c); c();
    },
    validate: o => o.interests.length < 3 ? 'Pick at least 3 interests.' : ''
  },
  questions: {
    render(el, o) {
      const core = QUESTIONS.filter(q => q.core);
      o._answers = o._answers || { ...(me.answers || {}) };
      const draw = () => {
        const done = core.filter(q => o._answers[q.id]).length;
        const next = core.find(q => !o._answers[q.id] && !(o._skipped || []).includes(q.id));
        el.innerHTML = h`<h1>Quick compatibility check</h1><p class="sub">Answer at least 5. We use these to find people who share your values — and hide dealbreakers.</p>
          <div class="progress"><i style="width:${done / core.length * 100}%"></i></div><p class="tip" style="margin:-4px 0 12px">${done} of ${core.length} answered</p><div id="qbox"></div>`;
        if (!next) { $('#qbox', el).innerHTML = h`<div class="empty" style="padding:20px"><div class="big">🎯</div><h3>Nice!</h3><p>You can answer ${QUESTIONS.length - core.length}+ more anytime from your profile.</p></div>`; return; }
        questionEditor($('#qbox', el), next, o._answers[next.id], async ans => {
          await api.saveAnswer(next.id, ans); o._answers[next.id] = ans; draw();
        }, () => { (o._skipped ||= []).push(next.id); draw(); });
      };
      draw();
    },
    validate: o => Object.keys(o._answers || {}).length < 5 ? 'Answer at least 5 questions — it makes your matches much better.' : ''
  },
  prompts: {
    render(el, o) {
      el.innerHTML = h`<h1>Show your personality</h1><p class="sub">Answer at least 2. Good answers get 3× more messages.</p>
        ${o.prompts.map((p, k) => h`<div class="prompt-card"><select class="input" data-k="${k}">${opts(PROMPTS, p.q)}</select><textarea class="input" data-k="${k}" maxlength="160" placeholder="Your answer…">${p.a}</textarea></div>`)}`;
      $$('select', el).forEach(s => s.onchange = () => o.prompts[s.dataset.k].q = s.value);
      $$('textarea', el).forEach(t => t.oninput = () => o.prompts[t.dataset.k].a = t.value.trim());
    },
    validate: o => o.prompts.filter(p => p.a && p.a.length >= 3).length < 2 ? 'Answer at least 2 prompts.' : new Set(o.prompts.filter(p => p.a).map(p => p.q)).size < o.prompts.filter(p => p.a).length ? 'Choose different prompts for each answer.' : ''
  },
  photos: {
    render(el, o) {
      const draw = () => {
        el.innerHTML = h`<h1>Add your photos</h1><p class="sub">Clear, recent photos of you. Your first photo is your main one.</p>
          <div class="photos-grid">${[0, 1, 2, 3, 4, 5].map(k => o.photos[k]
            ? h`<div class="ph-slot has" style="${bg(o.photos[k])}">${k === 0 ? h`<span class="main">Main</span>` : ''}<button type="button" class="x" data-del="${k}" aria-label="Remove photo">✕</button></div>`
            : h`<label class="ph-slot">+<input type="file" accept="image/*" data-add="${k}" aria-label="Add photo"></label>`)}</div>
          <label class="field" style="margin-top:18px"><span>About you</span><textarea class="input" id="f-bio" maxlength="400" placeholder="A few lines about who you are and what you're looking for…">${o.bio || ''}</textarea></label>
          <p class="tip">🛡️ Never share your address, bank details or phone number in your bio.</p>`;
        $$('[data-del]', el).forEach(b => b.onclick = () => { o.photos.splice(+b.dataset.del, 1); draw(); });
        $$('[data-add]', el).forEach(inp => inp.onchange = async () => {
          const f = inp.files[0]; if (!f) return;
          try { toast('Uploading…'); const d = await resizeImage(f); o.photos.push(await api.uploadPhoto(d)); draw(); } catch (e) { toast(e.message, 'error'); }
        });
        $('#f-bio', el).oninput = e => o.bio = e.target.value;
      };
      draw();
    },
    validate: o => !o.photos.length ? 'Add at least one photo.' : (o.bio || '').trim().length < 10 ? 'Write a short bio (10+ characters).' : (() => { const hits = scamCheck(o.bio); return hits.includes('phone number') || hits.includes('external link') || hits.includes('off-platform contact') ? 'Please keep phone numbers, links and other apps out of your bio.' : ''; })()
  }
};

// ───────────────────────── Shell & router ─────────────────────────
function shell() {
  document.body.classList.add('in-app');
  $('#root').innerHTML = `<div class="app"><main class="view" id="view"></main>
    <nav class="nav" aria-label="Main">
      <a href="#/discover" data-r="discover">${I.compass}<span>Discover</span></a>
      <a href="#/likes" data-r="likes">${I.heartO}<span>Likes</span><span class="badge hidden" id="b-likes"></span></a>
      <a href="#/chats" data-r="chats">${I.chat}<span>Chats</span><span class="badge hidden" id="b-chats"></span></a>
      <a href="#/me" data-r="me">${I.user}<span>Profile</span></a>
    </nav></div>`;
  window.onhashchange = route;
  if (!location.hash.startsWith('#/')) location.hash = '#/discover'; else route();
  api.touchStreak().then(n => { me.streak = n; $('#streak') && ($('#streak').innerHTML = `${I.flame} ${n}`); }).catch(() => {});
  refreshBadges();
  clearInterval(S.badgeTimer); S.badgeTimer = setInterval(refreshBadges, 30000);
  S.unsubAll?.(); S.unsubAll = api.subscribe('*', () => { refreshBadges(); if (location.hash === '#/chats') renderChats(); });
}

function route() {
  S.chatUnsub?.(); S.chatUnsub = null;
  closeSheet();
  const [, r = 'discover', arg] = location.hash.match(/^#\/([a-z]+)\/?(.*)$/) || [];
  $$('.nav a').forEach(a => a.setAttribute('aria-current', a.dataset.r === r || (r === 'chat' && a.dataset.r === 'chats') ? 'page' : 'false'));
  $('.nav').classList.toggle('hidden', r === 'chat');
  const v = $('#view'); v.scrollTop = 0;
  ({ discover: renderDiscover, likes: renderLikes, chats: renderChats, chat: () => renderChat(decodeURIComponent(arg)), me: renderMe }[r] || renderDiscover)();
}

async function refreshBadges() {
  try {
    const [likes, matches] = await Promise.all([api.likesYou(), api.matches()]);
    S.likes = likes; S.matches = matches;
    S.likeCount = likes.length; S.unread = matches.reduce((n, m) => n + (m.unread ? 1 : 0), 0) + matches.filter(m => !m.last).length;
    const set = (id, n) => { const b = $(id); if (!b) return; b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', !n); };
    set('#b-likes', S.likeCount); set('#b-chats', S.unread);
    document.title = (S.unread ? `(${S.unread}) ` : '') + 'Sierra Leone Connect';
  } catch (e) { if (/log in|banned|suspended/i.test(e.message)) logout(e.message); }
}

const banners = () => [
  settings.announcement ? h`<div class="banner">📣 ${settings.announcement}</div>` : '',
  api.mode === 'demo' ? h`<div class="banner demo">Demo mode · sample members are illustrations and may "like" you back.</div>` : ''
];

// ───────────────────────── Discover ─────────────────────────
async function renderDiscover() {
  const v = $('#view');
  v.innerHTML = h`<header class="topbar"><h2>Discover</h2><div class="row" style="flex:0;gap:8px"><span class="streak" id="streak" title="Daily streak">${raw(I.flame)} ${me.streak || 1}</span><button class="iconbtn" id="prefs-btn" aria-label="Discovery filters">${raw(I.sliders)}</button></div></header>
    <div style="position:absolute;inset:62px 0 0;display:flex;flex-direction:column">
      ${banners()}
      <div id="dq"></div>
      <div class="modes" role="tablist">${DECK_MODES.map(m => h`<button class="chip" role="tab" data-mode="${m.id}" aria-pressed="${S.mode === m.id}">${m.icon} ${m.label}</button>`)}</div>
      <div class="deck" id="deck"><div class="spinner"></div></div>
      <div class="actions" id="acts">
        <button class="act sm undo" data-a="undo" aria-label="Undo">${raw(I.undo)}</button>
        <button class="act lg pass" data-a="pass" aria-label="Pass">${raw(I.x)}</button>
        <button class="act sm super" data-a="super" aria-label="Oya! super like">${raw(I.star)}</button>
        <button class="act lg like" data-a="like" aria-label="Like">${raw(I.heart)}</button>
      </div>
      <div class="quota" id="quota"></div>
    </div>`;
  $('#prefs-btn').onclick = prefsSheet;
  $('.modes').onclick = e => { const b = e.target.closest('[data-mode]'); if (!b) return; S.mode = b.dataset.mode; localStorage.setItem('slc_mode', S.mode); $$('.modes .chip').forEach(c => c.setAttribute('aria-pressed', c === b)); loadDeck(); };
  $('#acts').onclick = e => { const b = e.target.closest('[data-a]'); if (!b) return; b.dataset.a === 'undo' ? undo() : swipeTop(b.dataset.a); };
  document.onkeydown = e => { if (!location.hash.startsWith('#/discover') || $('.sheet.show') || /input|textarea|select/i.test(document.activeElement.tagName)) return; if (e.key === 'ArrowLeft') swipeTop('pass'); if (e.key === 'ArrowRight') swipeTop('like'); if (e.key === 'ArrowUp') swipeTop('super'); };
  await loadDeck();
  drawDailyQuestion();
}

async function loadDeck() {
  const deck = $('#deck'); if (!deck) return;
  deck.innerHTML = '<div class="spinner"></div>';
  try {
    const { candidates, likedMe } = await api.deck(S.mode);
    const seed = Number(todayKey().replace(/-/g, '')) + (me.id || '').length;
    S.deck = rankDeck(me, candidates, new Set(likedMe), seed);
    S.likedMe = new Set(likedMe);
    drawDeck(); updateQuota();
  } catch (e) { deck.innerHTML = h`<div class="empty"><p>${e.message}</p></div>`; }
}

async function updateQuota() {
  try { const q = await api.quota(); S.quota = q; $('#quota') && ($('#quota').textContent = `${q.likesLeft} likes · ${q.supersLeft} Oya! left today`); return q; } catch {}
}

function cardHTML(p, top) {
  const ph = p.photos?.length ? p.photos : [''];
  const r = (p._reasons || []).slice(0, 3);
  return h`<article class="card" data-id="${p.id}" style="z-index:${top ? 3 : 1};${top ? '' : 'transform:scale(.95) translateY(14px);opacity:.7'}" ${top ? raw('tabindex="0"') : ''} aria-label="${p.name}">
    <div class="ph" style="${bg(ph[0])}" data-i="0"></div>
    ${ph.length > 1 ? h`<div class="ph-bars">${ph.map((_, k) => h`<i class="${k === 0 ? 'on' : ''}"></i>`)}</div>` : ''}
    <div class="shade"></div>
    <div class="score" style="--p:${p._score}" title="Connect Score"><div><b>${p._score}%</b><small>match</small></div></div>
    ${S.likedMe?.has(p.id) && completeness(me) >= 60 ? h`<span class="tag gold liked-you">${raw(I.heart.replace('<svg', '<svg width="12" height="12"'))} Likes you</span>` : ''}
    <span class="stamp like">LIKE</span><span class="stamp nope">NOPE</span><span class="stamp oya">OYA!</span>
    <div class="info">
      <h3>${nameAge(p)} ${vbadge(p)} ${isOnline(p.lastActive) ? h`<span class="tag green" style="font-size:11px">● Online</span>` : ''}${p._new ? h`<span class="tag blue" style="font-size:11px">New here 👋</span>` : ''}</h3>
      ${p.voice ? h`<button class="voice-chip" data-voice="${p.voice}" aria-label="Play voice intro">${raw(I.play)} Voice intro</button>` : ''}
      <div class="meta"><span>${place(p)}${p._km != null ? ` · ${fmtKm(p._km)}` : ''}</span><span>${intentById(p.intent).icon} ${intentById(p.intent).short}</span></div>
      <div class="reasons">${r.map(x => h`<span class="tag ${x.k === 'roots' ? 'green' : x.k === 'intent' ? 'gold' : 'blue'}">${x.t}</span>`)}</div>
    </div>
    <button class="more" data-more aria-label="See full profile">i</button>
  </article>`;
}

function drawDeck() {
  const deck = $('#deck'); if (!deck) return;
  if (!S.deck.length) {
    deck.innerHTML = h`<div class="empty"><div class="pulse"><span style="font-size:40px">🇸🇱</span></div><h3>You've seen everyone for now</h3><p>New people join every day. Try another mode or widen your filters.</p>
      <div class="row" style="max-width:320px;margin:16px auto 0"><button class="btn btn-ghost btn-sm" id="e-world">🌍 Go worldwide</button><button class="btn btn-ghost btn-sm" id="e-prefs">Adjust filters</button></div></div>`;
    $('#e-world').onclick = () => { S.mode = 'worldwide'; localStorage.setItem('slc_mode', S.mode); renderDiscover(); };
    $('#e-prefs').onclick = prefsSheet;
    return;
  }
  deck.innerHTML = [S.deck[1] && cardHTML(S.deck[1], false), cardHTML(S.deck[0], true)].filter(Boolean).join('');
  bindCard(deck.querySelector('.card[tabindex]'), S.deck[0]);
}

function bindCard(card, p) {
  if (!card) return;
  let sx = 0, sy = 0, dx = 0, dy = 0, down = false, moved = false, pi = 0;
  const ph = p.photos || [];
  const stamps = { like: $('.stamp.like', card), nope: $('.stamp.nope', card), oya: $('.stamp.oya', card) };
  const vc = $('[data-voice]', card); if (vc) vc.onclick = e => { e.stopPropagation(); playVoice(vc.dataset.voice, vc); };
  card.addEventListener('pointerdown', e => { if (e.target.closest('[data-more],[data-voice]')) return; down = true; moved = false; sx = e.clientX; sy = e.clientY; dx = dy = 0; card.setPointerCapture(e.pointerId); card.classList.add('dragging'); });
  card.addEventListener('pointermove', e => {
    if (!down) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 8) moved = true;
    card.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 18}deg)`;
    stamps.like.style.opacity = Math.max(0, Math.min(1, dx / 100));
    stamps.nope.style.opacity = Math.max(0, Math.min(1, -dx / 100));
    stamps.oya.style.opacity = Math.max(0, Math.min(1, -dy / 120 - Math.abs(dx) / 200));
  });
  const end = e => {
    if (!down) return; down = false; card.classList.remove('dragging');
    if (!moved) {
      const x = (e.clientX - card.getBoundingClientRect().left) / card.offsetWidth;
      if (ph.length > 1 && (x < .33 || x > .67)) {
        pi = Math.max(0, Math.min(ph.length - 1, pi + (x > .67 ? 1 : -1)));
        $('.ph', card).style.cssText = bg(ph[pi]);
        $$('.ph-bars i', card).forEach((b, k) => b.classList.toggle('on', k === pi));
      } else openProfile(p, { actions: true });
      card.style.transform = ''; return;
    }
    if (dx > 110) return swipeTop('like');
    if (dx < -110) return swipeTop('pass');
    if (dy < -130) return swipeTop('super');
    card.style.transform = ''; Object.values(stamps).forEach(s => s.style.opacity = 0);
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  $('[data-more]', card).onclick = () => openProfile(p, { actions: true });
}

let swiping = false;
async function swipeTop(kind, target, opts = {}) {
  if (swiping) return;
  const p = target || S.deck[0]; if (!p) return;
  swiping = true;
  const card = $(`.card[data-id="${CSS.escape(p.id)}"]`);
  const fly = { like: 'translate(150%, -10%) rotate(24deg)', pass: 'translate(-150%, -10%) rotate(-24deg)', super: 'translate(0, -150%) rotate(-4deg)' }[kind];
  if (card) { card.classList.remove('dragging'); const st = $(`.stamp.${kind === 'like' ? 'like' : kind === 'pass' ? 'nope' : 'oya'}`, card); if (st) st.style.opacity = 1; card.style.transform = fly; card.style.opacity = 0; }
  navigator.vibrate?.(kind === 'pass' ? 8 : 18);
  try {
    const res = await api.swipe(p.id, kind, opts);
    S.deck = S.deck.filter(x => x.id !== p.id);
    S.lastSwiped = p;
    setTimeout(() => { drawDeck(); swiping = false; }, card ? 260 : 0);
    if (res.match) { setTimeout(() => showMatch(res.match), 350); refreshBadges(); }
    else if (opts.comment || opts.ref) toast(kind === 'super' ? 'Oya! sent ⭐' : 'Like sent 💚');
    updateQuota();
  } catch (e) {
    swiping = false;
    if (card) { card.style.transform = ''; card.style.opacity = 1; $$('.stamp', card).forEach(s => s.style.opacity = 0); }
    toast(e.message, 'error');
  }
}

async function undo() {
  try {
    const p = await api.undo();
    const full = rankDeck(me, [p], S.likedMe || new Set())[0];
    S.deck.unshift(full); drawDeck(); updateQuota(); toast('Brought back ↩');
  } catch (e) { toast(e.message); }
}

// ───────────────────────── Profile sheet ─────────────────────────
let sheetEls = null;
function openSheet(html, onClose) {
  closeSheet();
  const bgEl = document.createElement('div'); bgEl.className = 'sheet-bg';
  const sh = document.createElement('div'); sh.className = 'sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
  sh.innerHTML = '<div class="grab"></div>' + html;
  document.body.append(bgEl, sh);
  requestAnimationFrame(() => { bgEl.classList.add('show'); sh.classList.add('show'); });
  bgEl.onclick = closeSheet;
  sheetEls = { bgEl, sh, onClose };
  const esc_ = e => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', esc_); sheetEls.esc = esc_;
  return sh;
}
function closeSheet() {
  if (!sheetEls) return;
  const { bgEl, sh, onClose, esc: e } = sheetEls; sheetEls = null;
  document.removeEventListener('keydown', e);
  bgEl.classList.remove('show'); sh.classList.remove('show');
  setTimeout(() => { bgEl.remove(); sh.remove(); }, 320);
  onClose?.();
}

function profileBody(p, { mine = false, likeable = false } = {}) {
  const sc = mine ? null : score(me, p);
  const ph = p.photos || [];
  const prompts = (p.prompts || []).filter(x => x.a);
  const blocks = [];
  const likeBtn = ref => likeable ? h`<button class="likeit" data-like="${ref}" aria-label="Like this">${raw(I.heart)}</button>` : '';
  const photoB = (u, k) => h`<div class="pv-photo" style="${bg(u)}">${likeBtn('photo:' + k)}</div>`;
  const promptB = (pr, k) => h`<div class="pv-sec pv-prompt"><h4>${pr.q}</h4><q>${pr.a}</q>${likeBtn('prompt:' + k)}</div>`;
  blocks.push(ph[0] ? photoB(ph[0], 0) : '');
  blocks.push(h`<div class="pv-head"><h2>${p.name}, ${ageOf(p.dob) ?? ''} ${vbadge(p)}</h2><div style="color:var(--muted)">${place(p)}${sc?.km != null ? ` · ${fmtKm(sc.km)} away` : ''} ${isOnline(p.lastActive) ? '· Online now' : p.lastActive ? `· Active ${timeAgo(p.lastActive)} ago` : ''}</div></div>`);
  if (p.voice) blocks.push(h`<div class="pv-sec"><button class="btn btn-ghost btn-block" data-voice="${p.voice}">${raw(I.play)} Hear ${mine ? 'my' : p.name + "'s"} voice intro</button></div>`);
  if (sc) blocks.push(h`<div class="pv-sec"><h4>WHY YOU MATCH · ${sc.score}%</h4><div class="chips">${sc.reasons.length ? sc.reasons.map(r => h`<span class="tag ${r.k === 'roots' ? 'green' : r.k === 'intent' ? 'gold' : 'blue'}">${r.t}</span>`) : h`<span class="tag">New connection — say hi!</span>`}</div></div>`);
  if (p.bio) blocks.push(h`<div class="pv-sec"><h4>ABOUT</h4><div>${p.bio}</div></div>`);
  if (prompts[0]) blocks.push(promptB(prompts[0], 0));
  if (!mine) blocks.push(compatBlock(sc?.q));
  blocks.push(h`<div class="pv-sec"><h4>THE BASICS</h4><dl class="kv">
    <dt>Looking for</dt><dd>${intentById(p.intent).icon} ${intentById(p.intent).label}</dd>
    ${p.homeDistrict ? h`<dt>Home</dt><dd>🇸🇱 ${p.homeDistrict}</dd>` : ''}
    ${p.heritage ? h`<dt>Heritage</dt><dd>${p.heritage}</dd>` : ''}
    ${p.faith ? h`<dt>Faith</dt><dd>${p.faith}</dd>` : ''}
    ${p.languages?.length ? h`<dt>Speaks</dt><dd>${p.languages.join(', ')}</dd>` : ''}
    ${p.job ? h`<dt>Work</dt><dd>${p.job}</dd>` : ''}${p.education ? h`<dt>Education</dt><dd>${p.education}</dd>` : ''}
    ${p.heightCm ? h`<dt>Height</dt><dd>${p.heightCm} cm (${Math.floor(p.heightCm / 30.48)}'${Math.round(p.heightCm / 2.54 % 12)}")</dd>` : ''}</dl></div>`);
  if (ph[1]) blocks.push(photoB(ph[1], 1));
  if (prompts[1]) blocks.push(promptB(prompts[1], 1));
  if (p.interests?.length) blocks.push(h`<div class="pv-sec"><h4>INTERESTS</h4><div class="chips">${p.interests.map(x => h`<span class="tag ${me.interests?.includes(x) && !mine ? 'green' : ''}">${x}</span>`)}</div></div>`);
  ph.slice(2).forEach((u, k) => { blocks.push(photoB(u, k + 2)); if (prompts[k + 2]) blocks.push(promptB(prompts[k + 2], k + 2)); });
  prompts.slice(Math.max(2, ph.length)).forEach((pr, k) => blocks.push(promptB(pr, Math.max(2, ph.length) + k)));
  return blocks.join('');
}

function openProfile(p, { actions = false, fromLikes = false } = {}) {
  const sh = openSheet(profileBody(p, { likeable: actions }) + h`
    <div style="text-align:center;padding:6px 0 10px"><button class="link" id="pv-report" style="color:var(--dim)">Report or block ${p.name}</button></div>
    ${actions ? h`<div class="sheet-actions"><button class="act lg pass" data-a="pass" aria-label="Pass">${raw(I.x)}</button><button class="act sm super" data-a="super" aria-label="Oya!">${raw(I.star)}</button><button class="act lg like" data-a="like" aria-label="Like">${raw(I.heart)}</button></div>` : ''}`);
  $('#pv-report', sh).onclick = () => reportSheet(p);
  bindVoice(sh);
  $('[data-q-open]', sh)?.addEventListener('click', () => questionsSheet());
  $$('[data-like]', sh).forEach(b => b.onclick = () => likeComment(p, b.dataset.like, fromLikes));
  $$('[data-a]', sh).forEach(b => b.onclick = async () => {
    closeSheet();
    if (fromLikes) {
      try { const r = await api.swipe(p.id, b.dataset.a); S.likes = S.likes.filter(x => x.id !== p.id); renderLikes(); refreshBadges(); if (r.match) showMatch(r.match); } catch (e) { toast(e.message, 'error'); }
    } else swipeTop(b.dataset.a, p);
  });
}

function likeComment(p, ref, fromLikes) {
  const [type, k] = ref.split(':');
  const pr = type === 'prompt' ? (p.prompts || []).filter(x => x.a)[+k] : null;
  const label = pr ? `your answer to "${pr.q}"` : 'your photo';
  const sh = openSheet(h`<div class="pad">
    ${pr ? h`<div class="pv-sec pv-prompt" style="margin:0 0 12px"><h4>${pr.q}</h4><q>${pr.a}</q></div>` : h`<div class="pv-photo" style="${bg((p.photos || [])[+k])};margin:0 0 12px;max-height:46vh"></div>`}
    <label class="field"><span>Add a comment — stand out from a plain like</span><textarea class="input" id="lc" maxlength="200" placeholder="${pr ? 'Say something about their answer…' : 'Say something about this photo…'}"></textarea></label>
    <div class="row"><button class="btn btn-ghost" id="lc-super">${raw(I.star)} Send Oya!</button><button class="btn btn-primary" id="lc-like">${raw(I.heart)} Send like</button></div></div>`);
  setTimeout(() => $('#lc', sh)?.focus(), 350);
  const go = async kind => {
    const comment = $('#lc', sh).value.trim();
    closeSheet();
    if (fromLikes) {
      try { const r = await api.swipe(p.id, kind, { comment, ref: label }); S.likes = S.likes.filter(x => x.id !== p.id); renderLikes(); refreshBadges(); if (r.match) showMatch(r.match); else toast('Like sent 💚'); } catch (e) { toast(e.message, 'error'); }
    } else swipeTop(kind, p, { comment, ref: label });
  };
  $('#lc-like', sh).onclick = () => go('like');
  $('#lc-super', sh).onclick = () => go('super');
}

function compatBlock(q) {
  const n = me.answersCount ?? Object.keys(me.answers || {}).length;
  if (!q || q.pct == null) return h`<div class="pv-sec"><h4>COMPATIBILITY QUESTIONS</h4><p style="margin:0 0 10px;color:var(--muted)">${n < 5 ? 'Answer a few questions to see how compatible you are.' : 'Not enough shared answers yet — answer more to compare.'}</p><button class="btn btn-ghost btn-sm" data-q-open>Answer questions</button></div>`;
  return h`<div class="pv-sec"><h4>COMPATIBILITY QUESTIONS</h4>
    <div class="qmeter"><b>${q.pct}%</b><span>compatible on ${q.n} shared answers</span></div>
    ${q.agree.slice(0, 4).map(a => { const qq = qById(a.id); return h`<div class="qagree"><span>${qq.text}</span><b>✓ You both: ${qq.opts[a.ans]}</b></div>`; })}
    ${q.n - q.agree.length > 0 ? h`<p class="tip">${q.n - q.agree.length} answers differ — great things to talk about.</p>` : ''}</div>`;
}

function reportSheet(p, messageId = null) {
  const sh = openSheet(h`<div class="pad"><h2 style="font-family:var(--display);margin:4px 0 6px">Report ${p.name}</h2><p style="color:var(--muted);margin:0 0 14px">Reports are confidential. Our moderators review every one.</p>
    <div class="chips" id="rr">${REPORT_REASONS.map(r => h`<button class="chip" data-v="${r}" aria-pressed="false">${r}</button>`)}</div>
    <label class="field" style="margin-top:14px"><span>Details (optional)</span><textarea class="input" id="rd" maxlength="1000"></textarea></label>
    <label class="switch-row"><span>Also block ${p.name}<small>They won't see you or message you again.</small></span><span class="toggle"><input type="checkbox" id="rb" checked><span></span></span></label>
    <button class="btn btn-danger btn-block" id="rs" style="margin-top:12px">Send report</button>
    <button class="btn btn-ghost btn-block" id="ro" style="margin-top:10px">Just block</button></div>`);
  let reason = '';
  $('#rr', sh).onclick = e => { const b = e.target.closest('.chip'); if (!b) return; reason = b.dataset.v; $$('#rr .chip', sh).forEach(c => c.setAttribute('aria-pressed', c === b)); };
  $('#rs', sh).onclick = async () => {
    if (!reason) return toast('Choose a reason.');
    try { await api.report(p.id, reason, $('#rd', sh).value, messageId); if ($('#rb', sh).checked) await blockDone(p); closeSheet(); toast('Thank you — our team will review this.'); } catch (e) { toast(e.message, 'error'); }
  };
  $('#ro', sh).onclick = async () => { try { await blockDone(p); closeSheet(); toast(`${p.name} has been blocked.`); } catch (e) { toast(e.message, 'error'); } };
}
async function blockDone(p) {
  await api.block(p.id);
  S.deck = S.deck.filter(x => x.id !== p.id);
  if (location.hash.startsWith('#/chat/')) location.hash = '#/chats'; else if (location.hash.startsWith('#/discover')) drawDeck();
  refreshBadges();
}

// ───────────────────────── Match celebration ─────────────────────────
function showMatch(m) {
  const o = m.other;
  const wrap = document.createElement('div');
  wrap.className = 'match-modal'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-label', "It's a match");
  wrap.innerHTML = h`<div style="max-width:380px;width:100%">
    <div style="font-weight:800;letter-spacing:.2em;font-size:12px;opacity:.85">🇸🇱 IT'S A</div>
    <h2>Connection!</h2><p style="margin:6px 0 0;opacity:.9">You and ${o.name} like each other.</p>
    <div class="match-pics"><div style="${bg(photo(me))}"></div><div style="${bg(photo(o))}"></div></div>
    <div id="mo">${openers(me, o).map(t => h`<button class="opener" data-t="${t}">💬 ${t}</button>`)}</div>
    <button class="btn btn-primary btn-block" id="m-chat" style="margin-top:8px">Send a message</button>
    <button class="btn btn-ghost btn-block" id="m-keep" style="margin-top:10px">Keep swiping</button></div>`;
  document.body.append(wrap); confetti(); navigator.vibrate?.([30, 40, 60]);
  const close = () => wrap.remove();
  $('#m-keep', wrap).onclick = close;
  $('#m-chat', wrap).onclick = () => { close(); location.hash = '#/chat/' + encodeURIComponent(m.id); };
  $('#mo', wrap).onclick = async e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    try { await api.send(m.id, b.dataset.t); close(); location.hash = '#/chat/' + encodeURIComponent(m.id); } catch (x) { toast(x.message, 'error'); }
  };
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas'); c.className = 'confetti'; document.body.append(c);
  const ctx = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const cols = ['#1EB53A', '#ffffff', '#0072C6', '#F5B82E', '#FF5A6E'];
  const ps = [...Array(140)].map(() => ({ x: c.width / 2, y: c.height * .4, vx: (Math.random() - .5) * 14, vy: Math.random() * -14 - 4, s: 4 + Math.random() * 6, c: cols[Math.random() * 5 | 0], r: Math.random() * 6 }));
  let t = 0;
  (function f() {
    ctx.clearRect(0, 0, c.width, c.height);
    ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .35; p.r += .1; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
    if (++t < 120) requestAnimationFrame(f); else c.remove();
  })();
}

// ───────────────────────── Likes & Top picks ─────────────────────────
async function renderLikes(tab = S.likesTab || 'liked') {
  S.likesTab = tab;
  const v = $('#view');
  v.innerHTML = h`<header class="topbar"><h2>Likes</h2></header>
    <div class="seg" role="tablist"><button role="tab" data-t="liked" aria-selected="${tab === 'liked'}">Liked you</button><button role="tab" data-t="picks" aria-selected="${tab === 'picks'}">Top picks today</button></div>
    <div class="pad" id="lk"><div class="spinner"></div></div>`;
  $('.seg', v).onclick = e => { const b = e.target.closest('[data-t]'); if (b) renderLikes(b.dataset.t); };
  const el = $('#lk');
  try {
    if (tab === 'liked') {
      const likes = S.likes = await api.likesYou();
      const comp = completeness(me), locked = comp < 60;
      if (!likes.length) { el.innerHTML = h`<div class="empty"><div class="big">💚</div><h3>No new likes yet</h3><p>Complete your profile and add more photos — complete profiles get up to 4× more likes.</p></div>`; return; }
      el.innerHTML = h`${locked ? h`<div class="lock"><div style="font-size:32px">🔒</div><h3>${likes.length} ${likes.length === 1 ? 'person likes' : 'people like'} you!</h3><p style="color:var(--muted);margin:0">Reach 60% profile strength to see who. You're at ${comp}%.</p><div class="progress"><i style="width:${comp}%"></i></div><a class="btn btn-primary btn-sm" href="#/me">Complete my profile</a></div>` : h`<p style="color:var(--muted);margin:0 0 12px">Like them back for an instant match ✨</p>`}
        <div class="grid2">${rankDeck(me, likes, new Set()).map(p => h`<button class="tile ${locked ? 'blur' : ''}" data-id="${p.id}" style="${bg(photo(p))}" ${locked ? raw('disabled aria-hidden="true"') : ''}>
          ${p.superLiked ? h`<span class="tag gold sc">⭐ Oya!</span>` : h`<span class="tag green sc">${p._score}%</span>`}
          <div class="t">${p.comment && !locked ? h`<div class="cmt">💬 ${p.comment}</div>` : ''}<b>${p.name}, ${ageOf(p.dob)} ${vbadge(p)}</b><span>${place(p)}</span></div></button>`)}</div>`;
      if (!locked) $$('.tile', el).forEach(t => t.onclick = () => openProfile(likes.find(x => x.id === t.dataset.id), { actions: true, fromLikes: true }));
    } else {
      const { candidates, likedMe } = await api.deck('worldwide');
      const picks = rankDeck(me, candidates, new Set(), Number(todayKey().replace(/-/g, ''))).sort((a, b) => b._score - a._score).slice(0, 6);
      if (!picks.length) { el.innerHTML = h`<div class="empty"><div class="big">⭐</div><h3>No picks right now</h3><p>Check back tomorrow for fresh top picks.</p></div>`; return; }
      el.innerHTML = h`<p style="color:var(--muted);margin:0 0 12px">Your highest Connect Scores today, refreshed every morning.</p>
        <div class="grid2">${picks.map(p => h`<button class="tile" data-id="${p.id}" style="${bg(photo(p))}"><span class="tag green sc">${p._score}%</span><div class="t"><b>${p.name}, ${ageOf(p.dob)} ${vbadge(p)}</b><span>${p._reasons[0]?.t || place(p)}</span></div></button>`)}</div>`;
      $$('.tile', el).forEach(t => t.onclick = () => openProfile(picks.find(x => x.id === t.dataset.id), { actions: true, fromLikes: true }));
    }
  } catch (e) { el.innerHTML = h`<div class="empty"><p>${e.message}</p></div>`; }
}

// ───────────────────────── Chats ─────────────────────────
async function renderChats() {
  const v = $('#view');
  if (!$('#chats-root')) v.innerHTML = h`<header class="topbar"><h2>Chats</h2></header><div id="chats-root"><div class="spinner"></div></div>`;
  const el = $('#chats-root');
  try {
    const ms = S.matches = await api.matches();
    const fresh = ms.filter(m => !m.last), convs = ms.filter(m => m.last);
    if (!ms.length) { el.innerHTML = h`<div class="empty"><div class="big">💬</div><h3>No matches yet</h3><p>When you and someone like each other, you can chat here.</p><a class="btn btn-primary btn-sm" href="#/discover" style="margin-top:10px">Start discovering</a></div>`; return; }
    el.innerHTML = h`${fresh.length ? h`<div class="section-t">New connections <span style="text-transform:none;font-weight:600;color:var(--dim)">· say hi before they expire</span></div><div class="new-matches">${fresh.map(m => { const left = expiryLeft(m.expiresAt); return h`<a class="nm" href="#/chat/${encodeURIComponent(m.id)}" style="color:inherit;text-decoration:none"><div class="av ${left && left.urgent ? 'urgent' : ''}" style="${bg(photo(m.other))}"></div>${m.other.name}${left ? h`<span class="exp ${left.urgent ? 'urgent' : ''}">⏳ ${left.t}</span>` : ''}</a>`; })}</div>` : ''}
      ${convs.length ? h`<div class="section-t">Messages</div>${convs.map(m => {
        const mine = m.last.from === me.id;
        return h`<a class="conv" href="#/chat/${encodeURIComponent(m.id)}" style="color:inherit;text-decoration:none"><div class="av ${isOnline(m.other.lastActive) ? 'online' : ''}" style="${bg(photo(m.other))}"></div>
          <div class="body"><div class="nm2">${m.other.name} ${vbadge(m.other)}</div><div class="pv ${m.unread ? 'unread' : ''}">${mine ? 'You: ' : ''}${m.last.body}</div></div>
          <div class="when">${timeAgo(m.last.at)}${m.unread ? h`<span class="badge">${m.unread}</span>` : !mine ? h`<span class="yourturn">Your turn</span>` : ''}</div></a>`;
      })}` : ''}`;
  } catch (e) { el.innerHTML = h`<div class="empty"><p>${e.message}</p></div>`; }
}

async function renderChat(id) {
  const v = $('#view');
  v.innerHTML = '<div class="spinner"></div>';
  let m = S.matches.find(x => x.id === id);
  if (!m) { S.matches = await api.matches().catch(() => []); m = S.matches.find(x => x.id === id); }
  if (!m) { location.hash = '#/chats'; return toast('Conversation not found.'); }
  const o = m.other;
  v.innerHTML = h`<div class="chat">
    <div class="chat-head"><a class="iconbtn" href="#/chats" aria-label="Back">${raw(I.back)}</a>
      <button class="who row" id="c-who" style="align-items:center;gap:10px"><div class="av-sm ${isOnline(o.lastActive) ? 'online' : ''}" style="${bg(photo(o))};flex:0 0 42px"></div><div style="min-width:0"><b>${o.name} ${vbadge(o)}</b><span id="c-status">${isOnline(o.lastActive) ? 'Online now' : 'Active ' + timeAgo(o.lastActive) + ' ago'} · ${place(o)}</span></div></button>
      <button class="iconbtn" id="c-menu" aria-label="More options">${raw(I.dots)}</button></div>
    <div class="msgs" id="msgs" aria-live="polite"></div>
    <div class="suggest" id="sugg"></div>
    <form class="composer" id="comp">
      <button type="button" class="cbtn" id="c-game" aria-label="Play This or That">${raw(I.dice)}</button>
      <textarea id="ct" rows="1" maxlength="1000" placeholder="Message ${o.name}…" aria-label="Message"></textarea>
      <button type="button" class="cbtn" id="c-mic" aria-label="Record voice note">${raw(I.mic)}</button>
      <button class="send" aria-label="Send">${raw(I.send)}</button></form></div>`;
  $('#c-who').onclick = () => openProfile(o);
  $('#c-menu').onclick = e => {
    e.stopPropagation();
    const old = $('.menu'); if (old) return old.remove();
    const mm = document.createElement('div'); mm.className = 'menu';
    mm.innerHTML = h`<button data-x="view">View profile</button><button data-x="safety">Safety tips</button><button data-x="unmatch">Unmatch</button><button data-x="report" class="red">Report / block</button>`;
    $('.chat').append(mm);
    mm.onclick = async ev => {
      const x = ev.target.dataset.x; mm.remove();
      if (x === 'view') openProfile(o);
      if (x === 'safety') infoSheet('safety');
      if (x === 'report') reportSheet(o);
      if (x === 'unmatch' && confirm(`Unmatch ${o.name}? This removes the conversation for both of you.`)) { await api.unmatch(id); toast('Unmatched'); location.hash = '#/chats'; }
    };
    setTimeout(() => document.addEventListener('click', () => mm.remove(), { once: true }), 0);
  };

  const box = $('#msgs');
  let msgs = [], otherReadAt = null, typingUntil = 0, typingTimer;
  const load = async () => { try { const r = await api.messages(id); msgs = r.items; otherReadAt = r.otherReadAt; } catch (e) { toast(e.message, 'error'); } };
  await load();

  const gameCard = g => {
    const ans = msgs.filter(x => x.kind === 'game_ans' && x.meta?.ref === g.id);
    const mine = ans.find(x => x.from === me.id), theirs = ans.find(x => x.from !== me.id);
    const opt = k => h`<button class="tot-opt ${mine?.meta.pick === k ? 'on' : ''} ${theirs && mine && theirs.meta.pick === k ? 'them' : ''}" data-ref="${g.id}" data-pick="${k}" ${mine ? raw('disabled') : ''}>${g.meta[k ? 'b' : 'a']}</button>`;
    const result = mine && theirs ? (mine.meta.pick === theirs.meta.pick ? `Same pick! 🎉 You both chose ${g.meta[mine.meta.pick ? 'b' : 'a']}` : `Opposites attract 😄 ${o.name} picked ${g.meta[theirs.meta.pick ? 'b' : 'a']}`) : mine ? `Waiting for ${g.from === me.id ? o.name : o.name}…` : theirs ? `${o.name} already picked — your turn!` : 'Tap your pick';
    return h`<div class="tot ${g.from === me.id ? 'me' : 'them'}"><div class="tot-h">🎲 Salone This or That</div><div class="tot-row">${opt(0)}<span>or</span>${opt(1)}</div><div class="tot-r">${result}</div></div>`;
  };
  const draw = () => {
    if (!box.isConnected) return clearTimeout(typingTimer);
    const out = [];
    if (!msgs.length) {
      const left = expiryLeft(m.expiresAt);
      out.push(h`<div class="chat-hello"><div class="av-sm" style="${bg(photo(o))}"></div><b>You matched with ${o.name}</b><p style="margin:4px 0 0;font-size:14px">${score(me, o).reasons.slice(0, 2).map(r => r.t).join(' · ') || 'Say kushɛ 👋'}</p>
        ${left ? h`<div class="exp-box ${left.urgent ? 'urgent' : ''}">⏳ This match expires in <b>${left.t}</b> unless someone says hi.${m.extended ? '' : h` <button class="link" id="c-extend">Extend 3 days</button>`}</div>` : ''}</div>`);
    }
    const lastMine = [...msgs].reverse().find(x => x.from === me.id && x.kind !== 'game_ans');
    msgs.forEach(x => {
      if (x.kind === 'game_ans') return;
      const mine = x.from === me.id;
      if (x.ctx) out.push(h`<div class="ctx ${mine ? 'me' : 'them'}">${mine ? 'You' : o.name} · ${x.ctx}</div>`);
      if (x.kind === 'game') out.push(gameCard(x));
      else if (x.kind === 'voice') out.push(h`<div class="bubble ${mine ? 'me' : 'them'} vbubble"><button class="vplay" data-media="${x.media}" aria-label="Play voice note">${raw(I.play)}</button><span class="wave" aria-hidden="true">${[...Array(18)].map((_, k) => raw(`<i style="height:${6 + (k * 37 % 14)}px"></i>`))}</span><time>${timeAgo(x.at)}</time></div>`);
      else out.push(h`<div class="bubble ${mine ? 'me' : 'them'}">${x.body}<time>${timeAgo(x.at)}</time></div>`);
      if (x === lastMine && otherReadAt && otherReadAt >= x.at) out.push(h`<div class="seen">Seen</div>`);
      if (x.flagged?.length) out.push(mine
        ? h`<div class="shield mine">🛡️ Heads up: messages about ${x.flagged.join(', ')} are reviewed by Scam Shield to keep everyone safe.</div>`
        : h`<div class="shield">⚠️ <b>Scam Shield:</b> this message mentions ${x.flagged.join(', ')}. Never send money, gift cards or crypto to someone you haven't met. <button class="link" data-rep="${x.id}">Report</button></div>`);
    });
    if (typingUntil > Date.now()) out.push(h`<div class="bubble them typing" aria-label="${o.name} is typing"><i></i><i></i><i></i></div>`);
    box.innerHTML = out.join('');
    $$('[data-rep]', box).forEach(b => b.onclick = () => reportSheet(o, b.dataset.rep));
    $$('.vplay', box).forEach(b => b.onclick = () => playVoice(b.dataset.media, b));
    $$('.tot-opt:not([disabled])', box).forEach(b => b.onclick = async () => {
      try { const msg = await api.send(id, '', { kind: 'game_ans', meta: { ref: b.dataset.ref, pick: +b.dataset.pick } }); msgs.push(msg); draw(); } catch (e) { toast(e.message, 'error'); }
    });
    if ($('#c-extend')) $('#c-extend').onclick = async () => { try { const r = await api.extendMatch(id); m.expiresAt = r.expiresAt; m.extended = true; toast('Extended by 3 days ⏳'); draw(); } catch (e) { toast(e.message, 'error'); } };
    box.scrollTop = box.scrollHeight;
    const iSent = msgs.some(x => x.from === me.id);
    $('#sugg').innerHTML = iSent ? '' : [...openers(me, o), ...ICEBREAKERS.slice(0, 2)].slice(0, 4).map(t => h`<button type="button" data-t="${t}">${t}</button>`).join('');
  };
  draw();
  $('#sugg').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { $('#ct').value = b.dataset.t; $('#ct').focus(); } };
  const ta = $('#ct');
  let lastTyping = 0;
  ta.oninput = () => {
    ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
    if (Date.now() - lastTyping > 2500) { lastTyping = Date.now(); api.typing?.(id); }
  };
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer:fine)').matches) { e.preventDefault(); $('#comp').requestSubmit(); } };
  const push = msg => { if (!msgs.some(x => x.id === msg.id)) msgs.push(msg); m.expiresAt = null; draw(); };
  $('#comp').onsubmit = async e => {
    e.preventDefault();
    const body = ta.value.trim(); if (!body) return;
    ta.value = ''; ta.style.height = '';
    try { push(await api.send(id, body)); } catch (x) { ta.value = body; toast(x.message, 'error'); }
  };
  $('#c-mic').onclick = () => recordSheet({ title: `Voice note for ${o.name}`, max: 60, cta: 'Send voice note', onDone: async dataUrl => {
    const media = await api.uploadVoice(dataUrl, id);
    push(await api.send(id, '', { kind: 'voice', media }));
  } });
  $('#c-game').onclick = () => {
    const used = new Set(msgs.filter(x => x.kind === 'game').map(x => x.meta.a));
    const pool = THIS_OR_THAT.filter(p => !used.has(p[0])).sort(() => Math.random() - .5).slice(0, 4);
    if (!pool.length) return toast('You\'ve played every pair — just talk now 😄');
    const sh = openSheet(h`<div class="pad"><h2 style="font-family:var(--display);margin:4px 0 6px">🎲 Salone This or That</h2><p style="color:var(--muted);margin:0 0 14px">Send one — you both pick, then see if you match.</p>
      ${pool.map(p => h`<button class="opener" style="background:var(--card);border-color:var(--line)" data-a="${p[0]}" data-b="${p[1]}">${p[0]} <span style="color:var(--muted)">or</span> ${p[1]}?</button>`)}</div>`);
    $$('[data-a]', sh).forEach(b => b.onclick = async () => { closeSheet(); try { push(await api.send(id, '', { kind: 'game', meta: { a: b.dataset.a, b: b.dataset.b } })); } catch (x) { toast(x.message, 'error'); } });
  };
  S.chatUnsub = api.subscribe(id, async ev => {
    if (ev.type === 'typing') { if (ev.from === me.id) return; typingUntil = Date.now() + 3500; draw(); clearTimeout(typingTimer); typingTimer = setTimeout(draw, 3600); return; }
    if (ev.type === 'read') { otherReadAt = ev.at; draw(); return; }
    if (ev.type === 'message' && ev.msg) { if (ev.msg.from !== me.id) typingUntil = 0; push(ev.msg); api.messages(id).catch(() => {}); }
    else { await load(); draw(); }
  });
  refreshBadges();
}

// ───────────────────────── Me / settings ─────────────────────────
function tipsFor(p) {
  const t = [];
  if ((p.photos || []).length < 3) t.push(['photos', 'Add at least 3 photos']);
  if (!p.bio || p.bio.length < 30) t.push(['photos', 'Write a bio of 30+ characters']);
  if ((p.prompts || []).filter(x => x.a).length < 3) t.push(['prompts', 'Answer all 3 prompts']);
  if (!p.heritage || !p.faith) t.push(['roots', 'Add your heritage and faith']);
  if (!p.job || !p.education) t.push(['basics', 'Add your job and education']);
  if ((p.interests || []).length < 5) t.push(['interests', 'Pick 5+ interests']);
  if ((p.answersCount || 0) < 10) t.unshift(['questions', `Answer ${10 - (p.answersCount || 0)} more compatibility questions`]);
  if (!p.voice) t.push(['voice', 'Record a 30-second voice intro']);
  return t;
}

async function renderMe() {
  me = await api.me();
  const comp = completeness(me), tips = tipsFor(me);
  const vs = me.verified ? 'approved' : me.verificationStatus;
  const v = $('#view');
  v.innerHTML = h`<header class="topbar"><h2>Profile</h2>${['admin', 'superadmin'].includes(session.role) ? h`<a class="btn btn-ghost btn-sm" href="${session.role === 'superadmin' ? 'superadmin.html' : 'admin.html'}">🛡️ Console</a>` : ''}</header>
    <div class="me-head"><div class="me-av" style="${bg(photo(me))}"><div class="ring" style="--p:${comp}"></div><span class="ring-lbl">${comp}%</span></div>
      <div><h2 style="margin:0;font-family:var(--display)">${me.username || me.name}, ${ageOf(me.dob)} ${vbadge(me)}</h2>${me.name ? h`<div style="color:var(--muted);font-size:13.5px">🔒 ${me.name}${me.lastName ? ' ' + me.lastName : ''} · only you can see your name</div>` : ''}<div style="color:var(--muted)">${place(me)}</div>
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn btn-ghost btn-sm" id="me-prev">Preview</button><span class="streak">${raw(I.flame)} ${me.streak || 1} day streak</span></div></div></div>
    ${tips.length ? h`<section class="card-sec"><h3>Profile strength <span class="tag green">${comp}%</span></h3><div class="progress"><i style="width:${comp}%"></i></div>${tips.slice(0, 3).map(([s, t]) => h`<button class="list-btn" data-edit="${s}">${t}<span>›</span></button>`)}</section>` : ''}
    <section class="card-sec"><h3>Stand out</h3>
      <button class="list-btn" data-edit="questions"><span>🎯 Compatibility questions<br><small>${me.answersCount || 0} of ${QUESTIONS.length} answered — more answers, better matches</small></span><span>›</span></button>
      <button class="list-btn" data-edit="voice"><span>🎤 Voice intro<br><small>${me.voice ? 'Recorded ✓ — tap to re-record or remove' : 'Let matches hear your voice (30s)'}</small></span><span>›</span></button></section>
    <section class="card-sec"><h3>Edit profile</h3>
      ${[['photos', 'Photos & bio', `${(me.photos || []).length}/6 photos`], ['prompts', 'Prompts', `${(me.prompts || []).filter(x => x.a).length} answered`], ['basics', 'Name, work & education', me.job || ''], ['roots', 'Salone roots & languages', me.homeDistrict || ''], ['location', 'Where I live', me.city || ''], ['intent', 'Looking for', intentById(me.intent).label], ['interests', 'Interests', `${(me.interests || []).length} selected`]]
        .map(([k, t, s]) => h`<button class="list-btn" data-edit="${k}"><span>${t}<br><small>${s}</small></span><span>›</span></button>`)}</section>
    <section class="card-sec"><h3>Trust & safety</h3>
      <button class="list-btn" id="me-verify"><span>${raw(I.shield.replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px"'))} Photo verification<br><small>${vs === 'approved' ? '✓ You are verified' : vs === 'pending' ? 'In review — usually within 24h' : vs === 'rejected' ? 'Not approved — try again with a clear selfie' : 'Get the blue check and 2× more matches'}</small></span><span>›</span></button>
      <button class="list-btn" id="me-safety"><span>Safety centre<br><small>Dating safely, spotting scams</small></span><span>›</span></button></section>
    <section class="card-sec"><h3>Settings</h3>
      <button class="list-btn" id="me-prefs"><span>Discovery filters<br><small>Ages ${fullPrefs(me).ageMin}–${fullPrefs(me).ageMax} · ${(fullPrefs(me).seeking || []).map(x => x === 'woman' ? 'Women' : 'Men').join(' & ') || 'Everyone'}</small></span><span>›</span></button>
      <label class="switch-row"><span>Pause my profile<small>Hide from Discover. Your matches stay.</small></span><span class="toggle"><input type="checkbox" id="me-pause" ${me.paused ? 'checked' : ''}><span></span></span></label>
      <button class="list-btn" id="me-out">Log out</button>
      <button class="list-btn" id="me-del" style="color:#FF8A8A">Delete account</button></section>
    <p class="fine" style="padding-bottom:20px"><a href="terms.html">Terms</a> · <a href="privacy.html">Privacy</a> · <a href="child-safety.html">Child safety</a> · Sierra Leone Connect v1.3</p>`;
  $('#me-prev').onclick = () => bindVoice(openSheet(profileBody({ ...me, name: me.username || me.name }, { mine: true })));
  $$('[data-edit]', v).forEach(b => b.onclick = () => b.dataset.edit === 'questions' ? questionsSheet() : b.dataset.edit === 'voice' ? voiceIntroSheet() : editSheet(b.dataset.edit));
  $('#me-prefs').onclick = prefsSheet;
  $('#me-safety').onclick = () => infoSheet('safety');
  $$('.js-i', v).forEach(a => a.onclick = e => { e.preventDefault(); infoSheet(a.dataset.i); });
  $('#me-pause').onchange = async e => { me = await api.saveProfile({ paused: e.target.checked }); toast(e.target.checked ? 'Profile paused — you are hidden from Discover.' : 'Welcome back! You are visible again.'); };
  $('#me-out').onclick = () => logout();
  $('#me-del').onclick = async () => {
    if (!confirm('Delete your account permanently? Your profile, matches and messages will be erased.')) return;
    if (prompt('Type DELETE to confirm') !== 'DELETE') return;
    try { await api.deleteAccount(); toast('Your account has been deleted.'); logout(); } catch (e) { toast(e.message, 'error'); }
  };
  $('#me-verify').onclick = () => {
    if (vs === 'approved' || vs === 'pending') return toast(vs === 'approved' ? 'You are already verified ✓' : 'Your selfie is being reviewed.');
    const sh = openSheet(h`<div class="pad" style="text-align:center"><div style="font-size:54px">🤳</div><h2 style="font-family:var(--display);margin:6px 0">Verify it's really you</h2><p style="color:var(--muted)">Take a selfie copying this pose: <b>thumbs up next to your face 👍</b>. A moderator compares it to your photos. The selfie is never shown on your profile.</p>
      <label class="btn btn-primary btn-block" style="position:relative">${raw(I.camera)} Take selfie<input type="file" accept="image/*" capture="user" id="sf" style="position:absolute;inset:0;opacity:0"></label></div>`);
    $('#sf', sh).onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const d = await resizeImage(f, 700); await api.requestVerification(d); closeSheet(); toast('Selfie sent for review ✓'); renderMe(); } catch (x) { toast(x.message, 'error'); }
    };
  };
}

function editSheet(step) {
  const o = JSON.parse(JSON.stringify(me));
  o.prompts = o.prompts?.length ? o.prompts : [{ q: PROMPTS[0], a: '' }, { q: PROMPTS[1], a: '' }, { q: PROMPTS[3], a: '' }];
  while (o.prompts.length < 3) o.prompts.push({ q: PROMPTS.find(q => !o.prompts.some(p => p.q === q)), a: '' });
  o.languages ||= []; o.interests ||= []; o.photos ||= []; o.prefs = fullPrefs(o);
  const sh = openSheet(`<div class="onb-body" id="ed"></div><div class="onb-foot"><button class="btn btn-ghost" id="ed-c">Cancel</button><button class="btn btn-primary" style="flex:1" id="ed-s">Save</button></div>`);
  STEP[step].render($('#ed', sh), o);
  $('#ed-c', sh).onclick = closeSheet;
  $('#ed-s', sh).onclick = async () => {
    const msg = STEP[step].validate(o); if (msg) return toast(msg, 'error');
    try { me = await api.saveProfile(clean(o)); closeSheet(); toast('Saved ✓'); renderMe(); S.deck = []; } catch (e) { toast(e.message, 'error'); }
  };
}

function prefsSheet() {
  const p = fullPrefs(me);
  p.seeking = [...(p.seeking || [])];
  const sh = openSheet(h`<div class="pad"><h2 style="font-family:var(--display);margin:4px 0 14px">Discovery filters</h2>
    <div class="field"><span>Show me</span><div class="chips" id="pf-s">${['woman', 'man'].map(g => h`<button type="button" class="chip" data-v="${g}" aria-pressed="${p.seeking.includes(g)}">${g === 'woman' ? 'Women' : 'Men'}</button>`)}</div></div>
    <div class="field"><span>Age range: <b id="pf-al">${p.ageMin}–${p.ageMax}</b></span><div class="range-row"><input type="range" min="18" max="70" value="${p.ageMin}" id="pf-a1" aria-label="Minimum age"><input type="range" min="18" max="80" value="${p.ageMax}" id="pf-a2" aria-label="Maximum age"></div></div>
    <div class="field"><span>"Near me" distance: <b id="pf-dl">${p.maxKm} km</b></span><input type="range" min="5" max="500" step="5" value="${p.maxKm}" id="pf-d"></div>
    <label class="switch-row"><span>Same faith only<small>Only show people who share your faith</small></span><span class="toggle"><input type="checkbox" id="pf-f" ${p.faithMatters ? 'checked' : ''}><span></span></span></label>
    <label class="switch-row"><span>Same goals only<small>Only show people looking for the same thing</small></span><span class="toggle"><input type="checkbox" id="pf-i" ${p.sameIntentOnly ? 'checked' : ''}><span></span></span></label>
    <button class="btn btn-primary btn-block" id="pf-save" style="margin-top:16px">Apply</button></div>`);
  chipToggle($('#pf-s', sh), p.seeking, 2);
  const a1 = $('#pf-a1', sh), a2 = $('#pf-a2', sh);
  const ar = () => { if (+a1.value > +a2.value) [a1.value, a2.value] = [a2.value, a1.value]; p.ageMin = +a1.value; p.ageMax = +a2.value; $('#pf-al', sh).textContent = `${p.ageMin}–${p.ageMax}`; };
  a1.oninput = a2.oninput = ar;
  $('#pf-d', sh).oninput = e => { p.maxKm = +e.target.value; $('#pf-dl', sh).textContent = p.maxKm + ' km'; };
  $('#pf-f', sh).onchange = e => p.faithMatters = e.target.checked;
  $('#pf-i', sh).onchange = e => p.sameIntentOnly = e.target.checked;
  $('#pf-save', sh).onclick = async () => {
    if (!p.seeking.length) return toast('Choose who you want to see.');
    try { me = await api.saveProfile({ prefs: p }); closeSheet(); toast('Filters updated'); if (location.hash.startsWith('#/discover')) loadDeck(); else if (location.hash.startsWith('#/me')) renderMe(); } catch (e) { toast(e.message, 'error'); }
  };
}

const INFO = {
  safety: ['Safety centre 🛡️', `<p><b>Never send money.</b> Not for transport, visas, school fees, hospital bills or "investments" — no matter how real the story sounds. Scam Shield flags these messages automatically.</p>
    <p><b>Stay in the app</b> until you've video-called and feel sure. Scammers rush to move you to WhatsApp or Telegram.</p>
    <p><b>Meet in public</b> the first few times, tell a friend or family member where you're going, and arrange your own transport.</p>
    <p><b>Look for the blue ✓.</b> Verified members have matched a live selfie to their photos.</p>
    <p><b>Report anything off.</b> Reports are confidential and reviewed by real moderators. Block removes someone instantly.</p>
    <p>In danger? Call local emergency services first (Sierra Leone: 999 / 019, US: 911, UK: 999).</p>`],
  terms: ['Terms of use', `<p>You must be 18 or older. One account per person, using your real name and photos.</p><p>Be respectful. Harassment, hate speech, nudity, solicitation, commercial promotion and requests for money are not allowed and lead to suspension or a ban.</p><p>We may remove content or accounts that break these rules. You can delete your account at any time from Profile → Delete account.</p>`],
  privacy: ['Privacy policy', `<p>We collect what you add to your profile, your messages, and basic usage data to run the service and keep it safe.</p><p>Only your city is shown — never your exact location. Verification selfies are visible only to moderators and are never shown on your profile.</p><p>We never sell your data. Deleting your account erases your profile, matches and messages.</p><p>Questions: contact support through the app.</p>`]
};
function infoSheet(k) { const [t, body] = INFO[k] || INFO.safety; openSheet(`<div class="pad"><h2 style="font-family:var(--display);margin:4px 0 12px">${t}</h2><div style="color:var(--muted)">${body}</div></div>`); }

async function logout(msg) {
  clearInterval(S.badgeTimer); S.unsubAll?.(); S.chatUnsub?.();
  await api.signOut(); session = null; me = null; S.deck = [];
  history.replaceState(null, '', location.pathname);
  showLanding();
  if (msg) $('#login-err').textContent = msg;
}

// ───────────────────────── Compatibility questions UI ─────────────────────────
function questionEditor(el, q, existing, onSave, onSkip) {
  const st = existing ? { m: existing.m, a: [...existing.a], i: existing.i } : { m: null, a: [], i: 2 };
  const draw = () => {
    el.innerHTML = h`<div class="qcard"><div class="qcat">${Q_CATS[q.cat]}</div><h3>${q.text}</h3>
      <div class="qsec">Your answer</div>
      <div class="qopts">${q.opts.map((o, k) => h`<button type="button" class="qopt" data-m="${k}" aria-pressed="${st.m === k}">${o}</button>`)}</div>
      ${st.m == null ? '' : h`<div class="qsec">Answers you'd accept from a match</div>
      <div class="chips" id="qa">${q.opts.map((o, k) => h`<button type="button" class="chip" data-a="${k}" aria-pressed="${st.a.includes(k)}">${o}</button>`)}</div>
      <div class="qsec">How much does it matter?</div>
      <div class="imp">${IMPORTANCE.map((x, k) => h`<button type="button" data-i="${k}" aria-pressed="${st.i === k}" class="${k === 4 ? 'deal' : ''}">${x.label}</button>`)}</div>
      ${st.i === 4 ? h`<p class="tip">🚫 People whose answer you don't accept won't be shown to you.</p>` : ''}`}
      <div class="row" style="margin-top:14px">${onSkip ? h`<button type="button" class="btn btn-ghost" data-skip>Skip</button>` : ''}<button type="button" class="btn btn-primary" data-save ${st.m == null ? raw('disabled') : ''}>Save</button></div></div>`;
    $$('[data-m]', el).forEach(b => b.onclick = () => { const k = +b.dataset.m; if (st.m !== k) { st.m = k; if (!existing) st.a = [k]; else if (!st.a.includes(k)) st.a.push(k); } draw(); });
    $$('[data-a]', el).forEach(b => b.onclick = () => { const k = +b.dataset.a; st.a = st.a.includes(k) ? st.a.filter(x => x !== k) : [...st.a, k]; draw(); });
    $$('[data-i]', el).forEach(b => b.onclick = () => { st.i = +b.dataset.i; draw(); });
    if ($('[data-skip]', el)) $('[data-skip]', el).onclick = onSkip;
    $('[data-save]', el).onclick = async e => {
      if (!st.a.length) return toast('Pick at least one answer you\'d accept.');
      e.target.disabled = true;
      try { await onSave({ m: st.m, a: [...st.a].sort(), i: st.i }); } catch (x) { toast(x.message, 'error'); e.target.disabled = false; }
    };
  };
  draw();
}

async function afterAnswer(qid, ans) {
  me.answers = { ...(me.answers || {}), [qid]: ans };
  me.answersCount = Object.keys(me.answers).length;
  if (location.hash.startsWith('#/discover')) loadDeck(); // scores changed — re-rank in place
}

function questionsSheet(cat = null) {
  const answers = me.answers || {};
  const count = Object.keys(answers).length;
  if (cat == null) {
    const sh = openSheet(h`<div class="pad"><h2 style="font-family:var(--display);margin:4px 0 6px">Compatibility questions</h2>
      <p style="color:var(--muted);margin:0 0 10px">Answer honestly. Choose what you'd accept from a match and how much it matters — we compare answers both ways.</p>
      <div class="progress"><i style="width:${count / QUESTIONS.length * 100}%"></i></div><p class="tip" style="margin:-4px 0 14px">${count} of ${QUESTIONS.length} answered</p>
      <button class="btn btn-primary btn-block" id="qs-next" ${count === QUESTIONS.length ? raw('disabled') : ''}>${count === QUESTIONS.length ? 'All answered 🎉' : 'Answer next question'}</button>
      <div class="card-sec" style="margin:16px 0 0">${Q_CATS.map((c, k) => { const qs = QUESTIONS.filter(q => q.cat === k); const d = qs.filter(q => answers[q.id]).length; return h`<button class="list-btn" data-cat="${k}"><span>${c}<br><small>${d}/${qs.length} answered</small></span><span>›</span></button>`; })}</div></div>`);
    $('#qs-next', sh).onclick = () => answerFlow();
    $$('[data-cat]', sh).forEach(b => b.onclick = () => questionsSheet(+b.dataset.cat));
    return;
  }
  const qs = QUESTIONS.filter(q => q.cat === cat);
  const sh = openSheet(h`<div class="pad"><button class="link" id="qs-back">‹ All categories</button><h2 style="font-family:var(--display);margin:8px 0 12px">${Q_CATS[cat]}</h2>
    ${qs.map(q => h`<button class="list-btn" data-q="${q.id}"><span>${q.text}<br><small>${answers[q.id] ? `You: ${q.opts[answers[q.id].m]} · ${IMPORTANCE[answers[q.id].i].label}` : 'Not answered'}</small></span><span>${answers[q.id] ? '✎' : '+'}</span></button>`)}</div>`);
  $('#qs-back', sh).onclick = () => questionsSheet();
  $$('[data-q]', sh).forEach(b => b.onclick = () => answerFlow(b.dataset.q, cat));
}

function answerFlow(qid = null, backCat = null, qotd = false) {
  const q = qid ? qById(qid) : QUESTIONS.find(x => !(me.answers || {})[x.id]);
  if (!q) { toast('All questions answered 🎉'); return questionsSheet(); }
  const sh = openSheet(`<div class="pad">${qotd ? '<div class="qotd-h">🎁 Question of the day · answer for +1 Oya!</div>' : ''}<div id="qe"></div></div>`);
  questionEditor($('#qe', sh), q, (me.answers || {})[q.id], async ans => {
    await api.saveAnswer(q.id, ans, qotd);
    await afterAnswer(q.id, ans);
    if (qotd) { closeSheet(); toast('+1 Oya! unlocked for today ⭐'); updateQuota(); $('#dq') && ($('#dq').innerHTML = ''); return; }
    toast('Saved ✓');
    if (backCat != null) questionsSheet(backCat); else answerFlow();
  }, qid || qotd ? null : () => { closeSheet(); });
  if (location.hash.startsWith('#/me')) sheetEls.onClose = () => renderMe();
}

async function drawDailyQuestion() {
  const el = $('#dq'); if (!el) return;
  const n = me.answersCount ?? Object.keys(me.answers || {}).length;
  if (n < 5) {
    el.innerHTML = h`<button class="qnudge" id="dq-b">🎯 <span><b>Unlock real compatibility</b><br>Answer ${5 - n} more question${5 - n === 1 ? '' : 's'} to compare values with matches</span>›</button>`;
    $('#dq-b').onclick = () => answerFlow();
    return;
  }
  const q = S.quota || await updateQuota();
  const left = QUESTIONS.filter(x => !(me.answers || {})[x.id]);
  if (!q || q.qotdDone || !left.length) { el.innerHTML = ''; return; }
  const today = left[Number(todayKey().replace(/-/g, '')) % left.length];
  if (!el.isConnected) return;
  el.innerHTML = h`<button class="qnudge gold" id="dq-b">🎁 <span><b>Question of the day</b><br>${today.text}</span>›</button>`;
  $('#dq-b').onclick = () => answerFlow(today.id, null, true);
}

// ───────────────────────── Voice ─────────────────────────
let curAudio = null, curBtn = null;
async function playVoice(src, btn) {
  try {
    if (curAudio && curBtn === btn && !curAudio.paused) { curAudio.pause(); btn?.classList.remove('playing'); return; }
    curAudio?.pause(); curBtn?.classList.remove('playing');
    const url = api.mediaUrl ? await api.mediaUrl(src) : src;
    if (!/^(data:audio\/|https:\/\/|blob:)/.test(url || '')) throw new Error('bad media');
    curAudio = new Audio(url); curBtn = btn;
    btn?.classList.add('playing');
    curAudio.onended = () => btn?.classList.remove('playing');
    await curAudio.play();
  } catch (e) { btn?.classList.remove('playing'); toast('Could not play this recording.', 'error'); }
}
function bindVoice(root) { $$('[data-voice]', root).forEach(b => b.onclick = e => { e.stopPropagation(); playVoice(b.dataset.voice, b); }); return root; }

function recordSheet({ title, max = 30, cta = 'Use this', onDone }) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Voice recording is not supported on this browser.', 'error');
  const sh = openSheet(h`<div class="pad" style="text-align:center"><h2 style="font-family:var(--display);margin:4px 0 6px">${title}</h2>
    <p style="color:var(--muted);margin:0 0 18px" id="rs-hint">Tap the mic to start. Up to ${max} seconds.</p>
    <button class="rec-btn" id="rs-rec" aria-label="Start recording">${raw(I.mic)}</button>
    <div class="rec-time" id="rs-t">0:00</div>
    <div class="row hidden" id="rs-done" style="margin-top:16px"><button class="btn btn-ghost" id="rs-play">${raw(I.play)} Play</button><button class="btn btn-ghost" id="rs-redo">Redo</button></div>
    <button class="btn btn-primary btn-block hidden" id="rs-use" style="margin-top:12px">${cta}</button></div>`);
  let rec, stream, chunks = [], t0, timer, dataUrl = null;
  const stopAll = () => { clearInterval(timer); stream?.getTracks().forEach(t => t.stop()); };
  const prevClose = sheetEls.onClose; sheetEls.onClose = () => { try { rec?.state === 'recording' && rec.stop(); } catch {} stopAll(); prevClose?.(); };
  const btn = $('#rs-rec', sh), tEl = $('#rs-t', sh);
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  btn.onclick = async () => {
    if (rec?.state === 'recording') return rec.stop();
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { return toast('Microphone permission was denied.', 'error'); }
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(m => MediaRecorder.isTypeSupported?.(m)) || '';
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    chunks = []; dataUrl = null;
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stopAll(); btn.classList.remove('on');
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      if ((Date.now() - t0) < 1000 || !blob.size) { $('#rs-hint', sh).textContent = 'Too short — try again.'; return; }
      dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      $('#rs-hint', sh).textContent = 'Listen back, then save.';
      $('#rs-done', sh).classList.remove('hidden'); $('#rs-use', sh).classList.remove('hidden');
    };
    rec.start(250); t0 = Date.now(); btn.classList.add('on');
    $('#rs-hint', sh).textContent = 'Recording… tap to stop.';
    $('#rs-done', sh).classList.add('hidden'); $('#rs-use', sh).classList.add('hidden');
    timer = setInterval(() => { const s = (Date.now() - t0) / 1000; tEl.textContent = fmt(s); if (s >= max) rec.stop(); }, 200);
  };
  $('#rs-play', sh).onclick = e => dataUrl && playVoice(dataUrl, e.currentTarget);
  $('#rs-redo', sh).onclick = () => btn.click();
  $('#rs-use', sh).onclick = async e => {
    if (!dataUrl) return;
    e.target.disabled = true;
    try { await onDone(dataUrl); closeSheet(); } catch (x) { toast(x.message, 'error'); e.target.disabled = false; }
  };
}

function voiceIntroSheet() {
  if (me.voice) {
    const sh = openSheet(h`<div class="pad"><h2 style="font-family:var(--display);margin:4px 0 14px">Your voice intro</h2>
      <button class="btn btn-ghost btn-block" data-voice="${me.voice}">${raw(I.play)} Play</button>
      <button class="btn btn-primary btn-block" id="vi-new" style="margin-top:10px">Record a new one</button>
      <button class="btn btn-danger btn-block" id="vi-del" style="margin-top:10px">Remove</button></div>`);
    bindVoice(sh);
    $('#vi-new', sh).onclick = () => { closeSheet(); setTimeout(recordIntro, 340); };
    $('#vi-del', sh).onclick = async () => { me = await api.saveProfile({ voice: null }); closeSheet(); toast('Voice intro removed'); renderMe(); };
    return;
  }
  recordIntro();
}
function recordIntro() {
  recordSheet({ title: 'Record your voice intro', max: 30, cta: 'Save voice intro', onDone: async dataUrl => {
    const url = await api.uploadVoice(dataUrl, null);
    me = await api.saveProfile({ voice: url }); toast('Voice intro saved 🎤'); renderMe();
  } });
  const hint = $('#rs-hint'); if (hint) hint.textContent = 'Say kushɛ, where you\'re from and what you\'re looking for. Up to 30 seconds.';
}

function expiryLeft(at) {
  if (!at) return null;
  const ms = new Date(at) - Date.now();
  if (ms <= 0) return null;
  const hrs = ms / 36e5;
  return { t: hrs >= 24 ? Math.floor(hrs / 24) + 'd' : Math.max(1, Math.floor(hrs)) + 'h', urgent: hrs < 24 };
}

// ───────────────────────── Android (Capacitor) integration ─────────────────────────
function setupNative() {
  const P = window.Capacitor?.Plugins || {};
  document.documentElement.classList.add('native');
  try { P.StatusBar?.setBackgroundColor?.({ color: '#07110D' }); P.StatusBar?.setStyle?.({ style: 'DARK' }); } catch {}
  setTimeout(() => { try { P.SplashScreen?.hide?.(); } catch {} }, 300);
  // Hardware back: close overlays first, then go back a screen, then leave the app from Discover/landing.
  P.App?.addListener?.('backButton', () => {
    const modal = document.querySelector('.match-modal');
    if (modal) return modal.remove();
    if (document.querySelector('.menu')) return document.querySelector('.menu').remove();
    if (sheetEls) return closeSheet();
    const h = location.hash;
    if (h.startsWith('#/chat/')) { location.hash = '#/chats'; return; }
    if (h && !h.startsWith('#/discover') && document.querySelector('.nav')) { location.hash = '#/discover'; return; }
    P.App.minimizeApp ? P.App.minimizeApp() : P.App.exitApp?.();
  });
  // Refresh badges when the app returns to the foreground.
  P.App?.addListener?.('resume', () => { try { if (me) refreshBadges(); } catch {} });
}
