// Demo backend: runs fully in the browser (localStorage) so the app works with zero setup.
// Same interface as supabase.js — flip config.js to go live.
import { seedProfiles, avatarSVG } from './seed.js';
import { DEFAULT_SETTINGS, BOT_REPLIES, REPORT_REASONS, qById, THIS_OR_THAT, PROMPTS } from '../constants.js';
import { uid, sha256, todayKey, scamCheck, ageOf } from '../util.js';
import { completeness, eligible, qMatch } from '../match.js';

const KEY = 'slc_db_v2', SESS = 'slc_session_v1';
const DEMO_STAFF = [
  { email: 'admin@slconnect.demo', password: 'Admin#2026', role: 'admin', name: 'Demo Admin' },
  { email: 'super@slconnect.demo', password: 'Super#2026', role: 'superadmin', name: 'Demo SuperAdmin' }
];

let db;
const listeners = new Map(); // matchId -> Set(cb)

function fresh() {
  const profiles = {}, users = {};
  for (const p of seedProfiles()) { profiles[p.id] = p; users[p.id] = { id: p.id, email: p.name.toLowerCase() + '.' + p.id + '@sample.slc', role: 'user', status: 'active', createdAt: p.createdAt }; }
  const d = { v: 2, users, profiles, swipes: [], matches: [], messages: [], reports: [], blocks: [], audit: [], settings: { ...DEFAULT_SETTINGS }, staffSeeded: false };
  // A few realistic items so the moderation consoles are not empty in demo
  const ids = Object.keys(profiles);
  d.reports.push(
    { id: uid(), by: ids[3], target: ids[8], reason: REPORT_REASONS[0], details: 'Asked me to send transport money on the second day.', status: 'open', at: new Date(Date.now() - 36e5).toISOString() },
    { id: uid(), by: ids[11], target: ids[20], reason: REPORT_REASONS[1], details: 'Photos look like a celebrity.', status: 'open', at: new Date(Date.now() - 9e6).toISOString() },
    { id: uid(), by: ids[6], target: ids[15], reason: REPORT_REASONS[2], details: 'Rude messages after I said no.', status: 'open', at: new Date(Date.now() - 2e7).toISOString() }
  );
  const fm = { id: uid(), matchId: 'seed-match', from: ids[8], body: 'Please send me $200 via Western Union for my visa fee', at: new Date(Date.now() - 5e6).toISOString(), flagged: ['money request', 'payment service', 'fee request'] };
  d.messages.push(fm);
  profiles[ids[5]].verificationStatus = 'pending'; profiles[ids[5]].verified = false; profiles[ids[5]].verificationSelfie = profiles[ids[5]].photos[0];
  profiles[ids[9]].verificationStatus = 'pending'; profiles[ids[9]].verified = false; profiles[ids[9]].verificationSelfie = profiles[ids[9]].photos[0];
  // Activity history for analytics
  for (let i = 0; i < 140; i++) {
    const a = ids[i % ids.length], b = ids[(i * 7 + 3) % ids.length];
    if (a !== b) d.matches.push({ id: uid(), a, b, at: new Date(Date.now() - Math.random() * 14 * 864e5).toISOString(), seed: true });
  }
  return d;
}

function load() {
  if (db) return db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || null; } catch { db = null; }
  if (!db || db.v !== 2) { db = fresh(); save(); }
  return db;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { throw new Error('Storage is full on this device. Remove some photos and try again.'); }
}
window.addEventListener('storage', e => { if (e.key === KEY) { db = null; load(); for (const set of listeners.values()) set.forEach(cb => cb({ type: 'sync' })); } });

async function seedStaff() {
  load();
  if (db.staffSeeded) return;
  for (const s of DEMO_STAFF) {
    const id = uid(), salt = uid();
    db.users[id] = { id, email: s.email, salt, pw: await sha256(salt + s.password), role: s.role, status: 'active', createdAt: new Date().toISOString() };
    db.profiles[id] = { id, name: s.name, staff: true, photos: [], createdAt: new Date().toISOString() };
  }
  db.staffSeeded = true; save();
}

function session() { try { return JSON.parse(localStorage.getItem(SESS)); } catch { return null; } }
function requireUser() {
  load();
  const s = session();
  const u = s && db.users[s.uid];
  if (!u) throw new Error('Please log in again.');
  if (u.status === 'banned') throw new Error('This account has been banned.');
  if (u.status === 'suspended') throw new Error('This account is suspended. ' + (u.statusReason || ''));
  return u;
}
function requireStaff(level = 'admin') {
  const u = requireUser();
  const ok = level === 'superadmin' ? u.role === 'superadmin' : ['admin', 'superadmin'].includes(u.role);
  if (!ok) throw new Error('Not authorized.');
  return u;
}
const audit = (actor, action, target, meta = {}) => { db.audit.unshift({ id: uid(), at: new Date().toISOString(), actor, action, target, meta }); db.audit = db.audit.slice(0, 2000); };
const emailOf = id => db.users[id]?.email || id;
const blockedBetween = (a, b) => db.blocks.some(x => (x.by === a && x.target === b) || (x.by === b && x.target === a));
const active = id => db.users[id]?.status === 'active';
const publicProfile = (p, meId = session()?.uid) => {
  if (!p) return p;
  const { verificationSelfie, likesNewUsers, bot, staff, answers, qotdDay, lastName, ...rest } = p;
  const me = meId && db.profiles[meId];
  return { ...rest, q: me?.answers && answers ? qMatch(me.answers, answers) : null };
};
const DAY = 864e5, EXPIRY = 7 * DAY;
const supersAllowed = p => db.settings.dailySuperLikes + (p?.qotdDay === todayKey() ? 1 : 0);
const msgText = m => m.kind === 'voice' ? '🎤 Voice note' : m.kind === 'game' ? `🎲 This or That: ${m.meta.a} or ${m.meta.b}?` : m.kind === 'game_ans' ? '🎲 Picked an answer' : m.body;
const BOT_COMMENTS = ['Your answer made me laugh 😂 we need to talk', 'Okay this is a green flag 🙌', 'Cassava leaf is the correct answer, no debate 😄', 'You seem genuinely kind — kushɛ!'];
function emit(matchId, ev) { listeners.get(matchId)?.forEach(cb => cb(ev)); listeners.get('*')?.forEach(cb => cb(ev)); }
const todays = (uid_, kind) => db.swipes.filter(s => s.from === uid_ && s.at.startsWith(todayKey()) && (!kind || s.kind === kind)).length;
const likesMe = (meId, p) => p.bot ? p.likesNewUsers : db.swipes.some(s => s.from === p.id && s.to === meId && s.kind !== 'pass');

function maybeBotMatchReply(matchId, botId, first = false, game = null) {
  const delay = first ? 2500 : 1600 + Math.random() * 2000;
  setTimeout(() => { load(); const m = db.matches.find(x => x.id === matchId); if (m && !m.unmatched) { m['read_' + botId] = new Date().toISOString(); save(); emit(matchId, { type: 'read', at: m['read_' + botId] }); } }, 700);
  setTimeout(() => emit(matchId, { type: 'typing', from: botId }), Math.max(800, delay - 1400));
  setTimeout(() => {
    load();
    const m = db.matches.find(x => x.id === matchId);
    if (!m || m.unmatched || !session()?.uid) return;
    let msg;
    if (game) {
      msg = { id: uid(), matchId, from: botId, kind: 'game_ans', meta: { ref: game.id, pick: Math.random() < .5 ? 0 : 1 }, at: new Date().toISOString(), flagged: [] };
      msg.body = msgText(msg);
    } else {
      const body = first ? `Kushɛ! Nice to match with you 😊` : BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)];
      msg = { id: uid(), matchId, from: botId, kind: 'text', body, at: new Date().toISOString(), flagged: [] };
    }
    db.messages.push(msg); db.profiles[botId].lastActive = msg.at; m['read_' + botId] = msg.at; save();
    emit(matchId, { type: 'message', msg });
  }, delay);
}

export const demo = {
  mode: 'demo',
  demoStaff: DEMO_STAFF,

  async init() { load(); await seedStaff(); },

  // ---------- Auth ----------
  async usernameAvailable(u) {
    load(); u = String(u || '').trim().toLowerCase();
    return !Object.values(db.profiles).some(p => (p.username || '').toLowerCase() === u);
  },
  async signUp({ email, password, dob, firstName, lastName, username, country, city, lat, lng }) {
    load();
    email = String(email).trim().toLowerCase();
    username = String(username || '').trim().toLowerCase();
    if (!/^(?![._])(?!.*[._]$)(?!.*[._]{2})[a-z0-9._]{3,20}$/.test(username)) throw new Error('Choose a valid username.');
    if (!(await demo.usernameAvailable(username))) throw new Error(`@${username} is taken — try another.`);
    if (!dob || ageOf(dob) < db.settings.minAge) throw new Error(`You must be ${db.settings.minAge}+ to use Sierra Leone Connect.`);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email.');
    if (String(password).length < 8) throw new Error('Password must be at least 8 characters.');
    if (Object.values(db.users).some(u => u.email === email)) throw new Error('An account with this email already exists.');
    const id = uid(), salt = uid();
    db.users[id] = { id, email, salt, pw: await sha256(salt + password), role: 'user', status: 'active', createdAt: new Date().toISOString() };
    db.profiles[id] = { id, name: String(firstName || '').trim().slice(0, 30), lastName: String(lastName || '').trim().slice(0, 40), username, dob,
      country: country || '', city: city || '', lat: lat ?? null, lng: lng ?? null,
      photos: [], interests: [], languages: [], prompts: [], createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), verificationStatus: 'none' };
    audit(id, 'signup', id); save();
    localStorage.setItem(SESS, JSON.stringify({ uid: id, at: Date.now() }));
    return { id, email, role: 'user' };
  },
  async signIn({ email, password }) {
    load(); await seedStaff();
    email = String(email).trim().toLowerCase();
    const u = Object.values(db.users).find(x => x.email === email && x.pw);
    if (!u || (await sha256(u.salt + password)) !== u.pw) throw new Error('Email or password is incorrect.');
    if (u.status === 'banned') throw new Error('This account has been banned.');
    localStorage.setItem(SESS, JSON.stringify({ uid: u.id, at: Date.now() }));
    return { id: u.id, email: u.email, role: u.role };
  },
  async signOut() { localStorage.removeItem(SESS); },
  async resetPassword(email) { return { ok: true, note: 'Demo mode: password reset emails are sent once Supabase is connected.' }; },
  async session() {
    load();
    const s = session(); const u = s && db.users[s.uid];
    if (!u) return null;
    return { id: u.id, email: u.email, role: u.role, status: u.status, statusReason: u.statusReason, aal: 'aal2' };
  },

  // ---------- Profile ----------
  async me() { const u = requireUser(); const p = db.profiles[u.id]; p.lastActive = new Date().toISOString(); save(); return { ...p, answers: { ...(p.answers || {}) }, answersCount: Object.keys(p.answers || {}).length }; },
  async saveProfile(patch) {
    const u = requireUser();
    const allowed = ['name', 'dob', 'gender', 'intent', 'city', 'country', 'lat', 'lng', 'homeDistrict', 'heritage', 'faith', 'languages', 'interests', 'prompts', 'photos', 'bio', 'job', 'education', 'heightCm', 'prefs', 'paused', 'onboarded', 'voice'];
    const p = db.profiles[u.id];
    for (const k of allowed) if (k in patch) p[k] = patch[k];
    if (p.dob && ageOf(p.dob) < db.settings.minAge) throw new Error(`You must be ${db.settings.minAge}+ to use Sierra Leone Connect.`);
    if (p.photos?.length > 6) p.photos = p.photos.slice(0, 6);
    if (p.voice && !/^(data:audio\/|https:\/\/)/.test(p.voice)) p.voice = null;
    p.completeness = completeness(p);
    save(); return demo.me();
  },
  async uploadPhoto(dataUrl) { return dataUrl; },
  async uploadVoice(dataUrl) { if (!/^data:audio\//.test(dataUrl)) throw new Error('Invalid recording.'); if (dataUrl.length > 900000) throw new Error('Recording is too long.'); return dataUrl; },
  async saveAnswer(qid, ans, qotd = false) {
    const u = requireUser(); const p = db.profiles[u.id]; const q = qById(qid);
    if (!q) throw new Error('Unknown question.');
    const m = Number(ans.m), i = Number(ans.i);
    if (!(m >= 0 && m < q.opts.length) || !(i >= 0 && i <= 4)) throw new Error('Invalid answer.');
    const a = [...new Set((ans.a || []).map(Number).filter(k => k >= 0 && k < q.opts.length))];
    if (!a.length) throw new Error('Pick at least one answer you would accept.');
    p.answers = { ...(p.answers || {}), [qid]: { m, a, i } };
    if (qotd) p.qotdDay = todayKey();
    p.completeness = completeness(p); save();
    return { answersCount: Object.keys(p.answers).length };
  },
  async removeAnswer(qid) { const u = requireUser(); const p = db.profiles[u.id]; if (p.answers) delete p.answers[qid]; p.completeness = completeness(p); save(); },
  async requestVerification(selfieDataUrl) {
    const u = requireUser(); const p = db.profiles[u.id];
    p.verificationSelfie = selfieDataUrl; p.verificationStatus = 'pending'; save();
    return { status: 'pending' };
  },
  async deleteAccount() {
    const u = requireUser();
    db.swipes = db.swipes.filter(s => s.from !== u.id && s.to !== u.id);
    const mids = new Set(db.matches.filter(m => m.a === u.id || m.b === u.id).map(m => m.id));
    db.matches = db.matches.filter(m => !mids.has(m.id));
    db.messages = db.messages.filter(m => !mids.has(m.matchId));
    delete db.profiles[u.id]; delete db.users[u.id];
    audit(u.id, 'account_deleted', u.id); save();
    localStorage.removeItem(SESS);
  },

  // ---------- Discovery ----------
  async settings() { load(); return { ...db.settings }; },
  async quota() {
    const u = requireUser();
    return { likesLeft: Math.max(0, db.settings.dailyLikes - todays(u.id, 'like')), supersLeft: Math.max(0, supersAllowed(db.profiles[u.id]) - todays(u.id, 'super')), qotdDone: db.profiles[u.id].qotdDay === todayKey() };
  },
  async deck(mode) {
    const u = requireUser(); const me = db.profiles[u.id];
    const swiped = new Set(db.swipes.filter(s => s.from === u.id).map(s => s.to));
    const out = [], likedMe = [];
    for (const p of Object.values(db.profiles)) {
      if (p.staff || p.paused || !p.onboarded && !p.bot) continue;
      if (swiped.has(p.id) || !active(p.id) || blockedBetween(u.id, p.id)) continue;
      if (!eligible(me, p, mode)) continue;
      out.push(publicProfile(p));
      if (likesMe(u.id, p)) likedMe.push(p.id);
    }
    return { candidates: out, likedMe };
  },
  async swipe(targetId, kind, opts = {}) {
    const u = requireUser();
    const comment = String(opts.comment || '').trim().slice(0, 200);
    if (comment && scamCheck(comment).some(x => ['phone number', 'external link', 'off-platform contact', 'payment service', 'money request'].includes(x))) throw new Error('Keep contact details and money talk out of likes — say something about their profile instead 😊');
    if (!['like', 'pass', 'super'].includes(kind)) throw new Error('Bad swipe.');
    const t = db.profiles[targetId];
    if (!t || !active(targetId)) throw new Error('This profile is no longer available.');
    if (kind === 'like' && todays(u.id, 'like') >= db.settings.dailyLikes) throw Object.assign(new Error('You\'ve used today\'s likes. They refresh at midnight ✨'), { code: 'quota' });
    if (kind === 'super' && todays(u.id, 'super') >= supersAllowed(db.profiles[u.id])) throw Object.assign(new Error('No Oya! likes left today.'), { code: 'quota' });
    db.swipes = db.swipes.filter(s => !(s.from === u.id && s.to === targetId));
    db.swipes.push({ from: u.id, to: targetId, kind, at: new Date().toISOString(), comment: kind === 'pass' ? '' : comment, ref: kind === 'pass' ? '' : String(opts.ref || '').slice(0, 160) });
    let match = null;
    if (kind !== 'pass' && likesMe(u.id, t) && !blockedBetween(u.id, targetId)) {
      match = db.matches.find(m => !m.unmatched && ((m.a === u.id && m.b === targetId) || (m.b === u.id && m.a === targetId)));
      if (!match) {
        match = { id: uid(), a: u.id, b: targetId, at: new Date().toISOString(), expiresAt: new Date(Date.now() + EXPIRY).toISOString() };
        db.matches.push(match);
        // Hinge-style: comments sent with likes open the conversation
        const theirs = db.swipes.find(s => s.from === targetId && s.to === u.id);
        const bc = t.bot && t.likesNewUsers && Number(t.id.split('-')[1]) % 3 === 0 ? BOT_COMMENTS[Number(t.id.split('-')[1]) % BOT_COMMENTS.length] : '';
        const firsts = [[targetId, theirs?.comment || bc, theirs?.ref || (bc ? 'your profile' : '')], [u.id, comment, opts.ref]].filter(x => x[1]);
        firsts.forEach(([from, body, ref], k) => db.messages.push({ id: uid(), matchId: match.id, from, kind: 'text', body, ctx: ref ? `Liked ${ref}` : '', at: new Date(Date.now() + k).toISOString(), flagged: db.settings.scamShield ? scamCheck(body) : [] }));
        if (firsts.length) match.expiresAt = null;
      }
      if (t.bot && Number(t.id.split('-')[1]) % 2 === 0 && !db.messages.some(x => x.matchId === match.id)) maybeBotMatchReply(match.id, targetId, true);
    }
    save();
    return { match: match ? { id: match.id, other: publicProfile(t) } : null };
  },
  async undo() {
    const u = requireUser();
    if (!db.settings.undoEnabled) throw new Error('Undo is turned off.');
    const mine = db.swipes.filter(s => s.from === u.id);
    const last = mine[mine.length - 1];
    if (!last) throw new Error('Nothing to undo.');
    if (db.matches.some(m => !m.unmatched && ((m.a === u.id && m.b === last.to) || (m.b === u.id && m.a === last.to)))) throw new Error('You already matched — say hi instead 😊');
    db.swipes = db.swipes.filter(s => s !== last); save();
    return publicProfile(db.profiles[last.to]);
  },
  async likesYou() {
    const u = requireUser(); const me = db.profiles[u.id];
    const swiped = new Set(db.swipes.filter(s => s.from === u.id).map(s => s.to));
    return Object.values(db.profiles)
      .filter(p => !p.staff && !swiped.has(p.id) && active(p.id) && !blockedBetween(u.id, p.id) && likesMe(u.id, p) && eligible(me, p, 'worldwide'))
      .map(p => {
        const sw = db.swipes.find(s => s.from === p.id && s.to === u.id);
        const n = p.bot ? Number(p.id.split('-')[1]) : -1;
        const comment = sw?.comment || (p.bot && n % 3 === 0 ? BOT_COMMENTS[n % BOT_COMMENTS.length] : '');
        return { ...publicProfile(p), superLiked: sw?.kind === 'super', comment, ref: sw?.ref || (comment && p.bot ? 'your profile' : '') };
      });
  },

  // ---------- Matches & chat ----------
  async matches() {
    const u = requireUser();
    return db.matches.filter(m => !m.unmatched && !m.seed && (m.a === u.id || m.b === u.id)).map(m => {
      const otherId = m.a === u.id ? m.b : m.a;
      const msgs = db.messages.filter(x => x.matchId === m.id);
      const last = msgs[msgs.length - 1];
      const readAt = m['read_' + u.id] || 0;
      const expiresAt = msgs.length ? null : (m.expiresAt || new Date(new Date(m.at).getTime() + EXPIRY).toISOString());
      return { id: m.id, at: m.at, other: publicProfile(db.profiles[otherId]), last: last && { ...last, body: msgText(last) }, unread: msgs.filter(x => x.from !== u.id && x.at > readAt).length, expiresAt, extended: !!m.extended };
    }).filter(m => m.other && !blockedBetween(u.id, m.other.id) && !(m.expiresAt && new Date(m.expiresAt) < Date.now())).sort((a, b) => (b.last?.at || b.at).localeCompare(a.last?.at || a.at));
  },
  async messages(matchId) {
    const u = requireUser();
    const m = db.matches.find(x => x.id === matchId && (x.a === u.id || x.b === u.id));
    if (!m) throw new Error('Conversation not found.');
    m['read_' + u.id] = new Date().toISOString(); save();
    const other = m.a === u.id ? m.b : m.a;
    return { items: db.messages.filter(x => x.matchId === matchId).map(x => ({ kind: 'text', ...x })), otherReadAt: m['read_' + other] || null };
  },
  async extendMatch(matchId) {
    const u = requireUser();
    const m = db.matches.find(x => x.id === matchId && !x.unmatched && (x.a === u.id || x.b === u.id));
    if (!m) throw new Error('Match not found.');
    if (m.extended) throw new Error('You can only extend a match once.');
    const cur = new Date(m.expiresAt || new Date(m.at).getTime() + EXPIRY).getTime();
    m.expiresAt = new Date(Math.max(cur, Date.now()) + 3 * DAY).toISOString(); m.extended = true; save();
    return { expiresAt: m.expiresAt };
  },
  async typing() {},
  async send(matchId, body, opts = {}) {
    const u = requireUser();
    const kind = opts.kind || 'text';
    if (!['text', 'voice', 'game', 'game_ans'].includes(kind)) throw new Error('Bad message type.');
    let meta = null, media = null;
    if (kind === 'voice') { media = opts.media; if (!/^data:audio\//.test(media || '')) throw new Error('Invalid voice note.'); }
    if (kind === 'game') { const pair = THIS_OR_THAT.find(p => p[0] === opts.meta?.a && p[1] === opts.meta?.b); if (!pair) throw new Error('Bad game.'); meta = { a: pair[0], b: pair[1] }; }
    if (kind === 'game_ans') {
      const g = db.messages.find(x => x.id === opts.meta?.ref && x.matchId === matchId && x.kind === 'game');
      if (!g || ![0, 1].includes(opts.meta?.pick)) throw new Error('Bad answer.');
      if (db.messages.some(x => x.kind === 'game_ans' && x.from === u.id && x.meta?.ref === g.id)) throw new Error('You already answered.');
      meta = { ref: g.id, pick: opts.meta.pick };
    }
    body = kind === 'text' ? String(body || '').trim().slice(0, 1000) : msgText({ kind, meta, body });
    if (!body) throw new Error('Message is empty.');
    const m = db.matches.find(x => x.id === matchId && !x.unmatched && (x.a === u.id || x.b === u.id));
    if (!m) throw new Error('You can only message your matches.');
    const other = m.a === u.id ? m.b : m.a;
    if (blockedBetween(u.id, other)) throw new Error('You can\'t message this person.');
    const flagged = db.settings.scamShield && kind === 'text' ? scamCheck(body) : [];
    const msg = { id: uid(), matchId, from: u.id, kind, body, media, meta, at: new Date().toISOString(), flagged };
    db.messages.push(msg); m.expiresAt = null; db.profiles[u.id].lastActive = msg.at; save();
    if (db.profiles[other]?.bot && kind !== 'game_ans') maybeBotMatchReply(matchId, other, false, kind === 'game' ? msg : null);
    return msg;
  },
  subscribe(matchId, cb) {
    if (!listeners.has(matchId)) listeners.set(matchId, new Set());
    listeners.get(matchId).add(cb);
    return () => listeners.get(matchId)?.delete(cb);
  },
  async unmatch(matchId) {
    const u = requireUser();
    const m = db.matches.find(x => x.id === matchId && (x.a === u.id || x.b === u.id));
    if (m) { m.unmatched = true; save(); }
  },
  async report(targetId, reason, details = '', messageId = null) {
    const u = requireUser();
    db.reports.unshift({ id: uid(), by: u.id, target: targetId, reason, details: String(details).slice(0, 1000), messageId, status: 'open', at: new Date().toISOString() });
    save();
  },
  async block(targetId) {
    const u = requireUser();
    if (!db.blocks.some(b => b.by === u.id && b.target === targetId)) db.blocks.push({ by: u.id, target: targetId, at: new Date().toISOString() });
    db.matches.filter(m => (m.a === u.id && m.b === targetId) || (m.b === u.id && m.a === targetId)).forEach(m => m.unmatched = true);
    save();
  },
  async touchStreak() {
    const u = requireUser(); const p = db.profiles[u.id];
    const t = todayKey(), y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    if (p.streakDay !== t) { p.streak = p.streakDay === y ? (p.streak || 0) + 1 : 1; p.streakDay = t; save(); }
    return p.streak;
  },

  // ---------- Admin ----------
  admin: {
    async stats() {
      requireStaff(); load();
      const users = Object.values(db.users).filter(u => u.role === 'user');
      const day = 864e5, now = Date.now();
      return {
        users: users.length,
        active24h: Object.values(db.profiles).filter(p => !p.staff && p.lastActive && now - new Date(p.lastActive) < day).length,
        newToday: users.filter(u => now - new Date(u.createdAt) < day).length,
        matches: db.matches.filter(m => !m.unmatched).length,
        messages: db.messages.length,
        openReports: db.reports.filter(r => r.status === 'open').length,
        pendingVerifications: Object.values(db.profiles).filter(p => p.verificationStatus === 'pending').length,
        flagged: db.messages.filter(m => m.flagged?.length && !m.cleared).length,
        banned: users.filter(u => u.status === 'banned').length
      };
    },
    async users(q = '') {
      requireStaff(); q = q.trim().toLowerCase();
      return Object.values(db.users).map(u => ({ ...u, pw: undefined, salt: undefined, profile: db.profiles[u.id] }))
        .filter(u => !q || u.email.includes(q) || [u.profile?.name, u.profile?.lastName, u.profile?.username, u.profile?.city].some(v => (v || '').toLowerCase().includes(q)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
    },
    async setStatus(id, status, reason = '') {
      const me = requireStaff();
      if (!['active', 'suspended', 'banned'].includes(status)) throw new Error('Bad status');
      const t = db.users[id]; if (!t) throw new Error('User not found');
      if (t.role !== 'user' && me.role !== 'superadmin') throw new Error('Only a SuperAdmin can act on staff accounts.');
      if (id === me.id) throw new Error('You cannot change your own status.');
      t.status = status; t.statusReason = reason; audit(me.id, 'set_status', id, { status, reason }); save();
    },
    async reports(status = 'open') {
      requireStaff();
      return db.reports.filter(r => status === 'all' || r.status === status).map(r => ({ ...r, reporter: { id: r.by, email: emailOf(r.by), name: db.profiles[r.by]?.name }, subject: { ...db.profiles[r.target], email: emailOf(r.target), status: db.users[r.target]?.status } }));
    },
    async resolveReport(id, action, note = '') {
      const me = requireStaff();
      const r = db.reports.find(x => x.id === id); if (!r) throw new Error('Report not found');
      if (action === 'suspend' || action === 'ban') await demo.admin.setStatus(r.target, action === 'ban' ? 'banned' : 'suspended', `Report: ${r.reason}`);
      r.status = action === 'dismiss' ? 'dismissed' : 'actioned'; r.resolution = action; r.note = note; r.handledBy = me.id; r.handledAt = new Date().toISOString();
      audit(me.id, 'resolve_report', r.target, { action, reportId: id }); save();
    },
    async verifications() {
      requireStaff();
      return Object.values(db.profiles).filter(p => p.verificationStatus === 'pending').map(p => ({ ...p, email: emailOf(p.id) }));
    },
    async decideVerification(id, approve) {
      const me = requireStaff(); const p = db.profiles[id]; if (!p) throw new Error('Not found');
      p.verificationStatus = approve ? 'approved' : 'rejected'; p.verified = !!approve;
      audit(me.id, approve ? 'verify_approve' : 'verify_reject', id); save();
    },
    async flagged() {
      requireStaff();
      return db.messages.filter(m => m.flagged?.length && !m.cleared).map(m => ({ ...m, sender: { id: m.from, name: db.profiles[m.from]?.name, email: emailOf(m.from), status: db.users[m.from]?.status } })).reverse();
    },
    async clearFlag(id) { const me = requireStaff(); const m = db.messages.find(x => x.id === id); if (m) { m.cleared = true; audit(me.id, 'clear_flag', m.from, { messageId: id }); save(); } },

    // SuperAdmin only
    async setRole(id, role) {
      const me = requireStaff('superadmin');
      if (!['user', 'admin', 'superadmin'].includes(role)) throw new Error('Bad role');
      if (id === me.id) throw new Error('You cannot change your own role.');
      const t = db.users[id]; if (!t) throw new Error('User not found');
      t.role = role; audit(me.id, 'set_role', id, { role }); save();
    },
    async saveSettings(s) {
      const me = requireStaff('superadmin');
      const clean = { ...db.settings };
      for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in s) clean[k] = typeof DEFAULT_SETTINGS[k] === 'number' ? Math.max(0, Math.min(1000, Number(s[k]) || 0)) : typeof DEFAULT_SETTINGS[k] === 'boolean' ? !!s[k] : String(s[k]).slice(0, 280);
      if (clean.minAge < 18) clean.minAge = 18;
      db.settings = clean; audit(me.id, 'save_settings', 'app', clean); save(); return clean;
    },
    async audit() { requireStaff('superadmin'); return db.audit.slice(0, 300).map(a => ({ ...a, actorEmail: emailOf(a.actor), targetEmail: db.users[a.target] ? emailOf(a.target) : a.target })); },
    async analytics() {
      requireStaff('superadmin');
      const days = [...Array(14)].map((_, i) => new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10));
      const count = (arr, f) => days.map(d => arr.filter(x => (f(x) || '').startsWith(d)).length);
      const byCountry = {};
      Object.values(db.profiles).filter(p => !p.staff && p.country).forEach(p => byCountry[p.country] = (byCountry[p.country] || 0) + 1);
      const byIntent = {};
      Object.values(db.profiles).filter(p => p.intent).forEach(p => byIntent[p.intent] = (byIntent[p.intent] || 0) + 1);
      return { days, signups: count(Object.values(db.users), u => u.createdAt), matches: count(db.matches, m => m.at), messages: count(db.messages, m => m.at), byCountry, byIntent };
    },
    async resetDemo() { const me = requireStaff('superadmin'); localStorage.removeItem(KEY); db = null; load(); await seedStaff(); localStorage.removeItem(SESS); }
  }
};

export { avatarSVG };
