// Connect Score — a transparent hybrid compatibility engine.
// Hard filters (mutual eligibility) + weighted soft signals, with human-readable reasons
// so people can see *why* someone was suggested (drives trust and easy first messages).
import { ageOf, haversineKm } from './util.js';
import { REGIONS, IMPORTANCE, qById } from './constants.js';

const INTENT_COMPAT = {
  marriage: { marriage: 1, serious: 0.75, open: 0.25, friends: 0 },
  serious: { marriage: 0.75, serious: 1, open: 0.5, friends: 0.1 },
  open: { marriage: 0.25, serious: 0.5, open: 1, friends: 0.4 },
  friends: { marriage: 0, serious: 0.1, open: 0.4, friends: 1 }
};

export const defaultPrefs = () => ({ ageMin: 21, ageMax: 45, seeking: [], mode: 'worldwide', maxKm: 100, faithMatters: false, sameIntentOnly: false });

const seeks = (a, b) => !a.prefs?.seeking?.length || a.prefs.seeking.includes(b.gender);
const inAge = (a, b) => { const x = ageOf(b.dob); const p = a.prefs || {}; return x != null && x >= (p.ageMin ?? 18) && x <= (p.ageMax ?? 99); };

export function eligible(me, them, mode = me.prefs?.mode || 'worldwide') {
  if (!them || them.id === me.id) return false;
  if (ageOf(them.dob) < 18) return false;
  if (!seeks(me, them) || !seeks(them, me)) return false;
  if (!inAge(me, them) || !inAge(them, me)) return false;
  if (me.prefs?.faithMatters && me.faith && them.faith && me.faith !== them.faith && them.faith !== 'Prefer not to say') return false;
  if (me.prefs?.sameIntentOnly && me.intent !== them.intent) return false;
  if (pairQ(me, them)?.deal) return false;
  if (mode === 'salone' && them.country !== 'Sierra Leone') return false;
  if (mode === 'diaspora' && them.country === 'Sierra Leone') return false;
  if (mode === 'near') {
    const km = haversineKm(me, them);
    if (km == null ? them.country !== me.country : km > (me.prefs?.maxKm || 100)) return false;
  }
  return true;
}

const jaccard = (a = [], b = []) => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter(x => B.has(x));
  const uni = new Set([...A, ...B]).size || 1;
  return { j: inter.length / uni, shared: inter };
};


// OkCupid-style question match. answers: { [qid]: { m: myAnswerIdx, a: [acceptableIdx], i: importance 0..4 } }
// Each side's satisfaction = importance-weighted share of their wishes the other meets; match = geometric mean,
// minus a 1/n margin of error so 3 lucky answers can't show 99%.
export function qMatch(A = {}, B = {}) {
  let pa = 0, ea = 0, pb = 0, eb = 0, n = 0, deal = false;
  const agree = [];
  for (const id of Object.keys(A)) {
    const x = A[id], y = B[id];
    if (!x || !y || x.m == null || y.m == null || !qById(id)) continue;
    n++;
    const wa = IMPORTANCE[x.i ?? 2].w, wb = IMPORTANCE[y.i ?? 2].w;
    const aOk = (x.a || []).includes(y.m), bOk = (y.a || []).includes(x.m);
    pa += wa; pb += wb; if (aOk) ea += wa; if (bOk) eb += wb;
    if ((x.i === 4 && !aOk) || (y.i === 4 && !bOk)) deal = true;
    if (x.m === y.m) agree.push({ id, ans: x.m, w: wa + wb });
  }
  agree.sort((p, q) => q.w - p.w || (p.id < q.id ? -1 : 1));
  if (n < 3) return { pct: null, n, agree: agree.map(({ id, ans }) => ({ id, ans })), deal };
  const sa = pa ? ea / pa : 1, sb = pb ? eb / pb : 1;
  const pct = Math.round(100 * Math.max(0, Math.sqrt(sa * sb) - 1 / n));
  return { pct, n, agree: agree.map(({ id, ans }) => ({ id, ans })), deal };
}
const pairQ = (me, them) => them.q || (me.answers && them.answers ? qMatch(me.answers, them.answers) : null);

export function score(me, them) {
  const reasons = [];
  let s = 0;

  // 1. Relationship intent (25)
  const ic = INTENT_COMPAT[me.intent]?.[them.intent] ?? 0.4;
  s += 25 * ic;
  if (ic === 1) reasons.push({ k: 'intent', t: them.intent === 'marriage' ? 'Both marriage-minded' : them.intent === 'friends' ? 'Both here for friendship' : them.intent === 'serious' ? 'Both want something long-term' : 'Both open to see' });

  // 2. Shared interests (20) — Jaccard with a floor boost for any overlap
  const { j, shared } = jaccard(me.interests, them.interests);
  s += 20 * Math.min(1, j * 2.2);
  if (shared.length) reasons.push({ k: 'interests', t: shared.length === 1 ? `You both love ${shared[0]}` : `${shared.length} shared interests`, list: shared });

  // 3. Roots — home district / region / heritage (15)
  let roots = 0;
  if (me.homeDistrict && me.homeDistrict === them.homeDistrict) { roots += 10; reasons.push({ k: 'roots', t: `Both from ${them.homeDistrict.replace(' (Freetown)', '')}` }); }
  else if (me.homeDistrict && REGIONS[me.homeDistrict] && REGIONS[me.homeDistrict] === REGIONS[them.homeDistrict]) { roots += 6; reasons.push({ k: 'roots', t: `Both from the ${REGIONS[them.homeDistrict]} region` }); }
  if (me.heritage && me.heritage === them.heritage && me.heritage !== 'Other') roots += 5;
  s += Math.min(15, roots);

  // 4. Language (10)
  const langs = jaccard(me.languages, them.languages).shared.filter(l => l !== 'English');
  s += Math.min(10, langs.length * 4);
  if (langs.length) reasons.push({ k: 'lang', t: `You both speak ${langs.slice(0, 2).join(' & ')}` });

  // 5. Distance (15) — smooth decay; diaspora in same country still scores
  const km = haversineKm(me, them);
  let dist = 0;
  if (km != null) dist = 15 * Math.max(0, 1 - Math.log10(1 + km) / 4.2);
  else if (me.country && me.country === them.country) dist = 8;
  s += dist;
  if (km != null && km < 60) reasons.push({ k: 'near', t: km < 15 ? 'Lives very close to you' : 'Lives nearby' });
  else if (me.country && me.country === them.country && me.country !== 'Sierra Leone') reasons.push({ k: 'near', t: `Also in ${them.country}` });

  // 6. Faith (5)
  if (me.faith && me.faith === them.faith && me.faith !== 'Prefer not to say') { s += 5; reasons.push({ k: 'faith', t: `Shared faith` }); }

  // 7. Trust & activity (10)
  if (them.verified) { s += 4; }
  const days = them.lastActive ? (Date.now() - new Date(them.lastActive)) / 864e5 : 30;
  s += 4 * Math.max(0, 1 - days / 14);
  s += 2 * Math.min(1, (them.completeness || 0) / 100);

  // 8. Compatibility questions — blended in as confidence grows with shared answers
  const q = pairQ(me, them);
  if (q?.pct != null) {
    const wq = Math.min(0.6, 0.15 + q.n * 0.03);
    s = (1 - wq) * s + wq * q.pct;
    const tags = q.agree.slice(0, 2).map(a => qById(a.id).tag);
    if (tags.length) reasons.unshift({ k: 'q', t: `You agree on ${tags.join(' & ')}` });
    if (q.pct >= 80) reasons.unshift({ k: 'q', t: 'Highly compatible answers' });
  }
  return { score: Math.round(Math.max(1, Math.min(99, s))), reasons, km, q };
}

// Rank a deck: compatibility + boost for people who already liked you (fast matches),
// gentle freshness bias, and a little exploration so the deck never feels stale.
export function rankDeck(me, candidates, likedMeIds = new Set(), seed = Date.now()) {
  let r = seed % 2147483647 || 1;
  const rand = () => (r = r * 16807 % 2147483647) / 2147483647;
  return candidates
    .map(c => {
      const sc = score(me, c);
      const isNew = c.createdAt && Date.now() - new Date(c.createdAt) < 72 * 36e5;
      const boost = (likedMeIds.has(c.id) ? 18 : 0) + (isNew ? 6 : 0);
      return { ...c, _score: sc.score, _reasons: sc.reasons, _km: sc.km, _q: sc.q, _new: isNew, _rank: sc.score + boost + rand() * 8 };
    })
    .sort((a, b) => b._rank - a._rank);
}

export function completeness(p) {
  const checks = [
    p.name, p.dob, p.gender, p.intent, p.city, p.homeDistrict, p.heritage, p.faith, p.bio && p.bio.length >= 30,
    (p.photos || []).length >= 1, (p.photos || []).length >= 3, (p.interests || []).length >= 3,
    (p.languages || []).length >= 1, (p.prompts || []).filter(x => x.a).length >= 2, p.job, p.education,
    (p.answersCount ?? Object.keys(p.answers || {}).length) >= 10, p.voice
  ];
  return Math.round(checks.filter(Boolean).length / checks.length * 100);
}

// Suggested openers based on what two people actually share.
export function openers(me, them) {
  const { reasons, q } = score(me, them);
  const out = [];
  const r = k => reasons.find(x => x.k === k);
  const ag = q?.agree?.[0] && qById(q.agree[0].id);
  if (ag) out.push(`We both answered "${ag.opts[q.agree[0].ans]}" to "${ag.text}" 😄 What made you choose that?`);
  if (r('roots')) out.push(`Another ${them.homeDistrict?.replace(' (Freetown)', '')} person! Which part are you from? 😊`);
  if (r('interests')) out.push(`I see you love ${r('interests').list[0]} too — what got you into it?`);
  const p = (them.prompts || []).find(x => x.a);
  if (p) out.push(`Your answer to "${p.q.replace('…', '')}" made me smile — tell me more!`);
  if (r('lang')) out.push(`Kushɛ ${them.name}! We go talk Krio or ${r('lang').t.split('speak ')[1]?.split(' &')[0]}? 😄`);
  out.push(`Hi ${them.name}! Cassava leaf or potato leaf — choose wisely 😄`);
  return out.slice(0, 3);
}
