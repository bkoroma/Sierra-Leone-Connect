// Live backend: Supabase Auth + Postgres RPCs (see supabase/schema.sql) + Storage + Realtime.
// Same interface as demo.js.
import { uid } from '../util.js';

const SDK = '../vendor/supabase-2.49.4.js'; // supabase-js 2.49.4, bundled locally (works offline-first and inside the Android app)

// Inside the Android app the page origin is https://localhost, which email links can't open —
// send confirmation/reset links to the public website instead.
const isNative = () => !!window.Capacitor?.isNativePlatform?.();
const webHome = () => isNative() ? (CONFIG_REF.APP_URL || '').replace(/\/?$/, '/') : location.origin + location.pathname;
let CONFIG_REF = {};

export async function createSupabaseApi(cfg) {
  CONFIG_REF = cfg;
  const { createClient } = await import(SDK);
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  const rpc = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message?.replace(/^.*?ERROR:\s*/, '') || 'Request failed');
    return data;
  };
  const authErr = e => { if (e) throw new Error(e.message); };
  const userId = async () => (await sb.auth.getUser()).data.user?.id;
  const mapMsg = r => ({ id: r.id, matchId: r.match_id, from: r.sender, body: r.body, kind: r.kind || 'text', media: r.media, meta: r.meta, ctx: r.ctx, at: r.created_at, flagged: r.flagged || [] });
  const chans = new Map(); const signed = new Map();
  const extOf = type => /mp4|m4a|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
  const toBlob = async dataUrl => (await fetch(dataUrl)).blob();

  async function upload(bucket, dataUrl) {
    const id = await userId(); if (!id) throw new Error('Please log in again.');
    const path = `${id}/${uid()}.jpg`;
    const { error } = await sb.storage.from(bucket).upload(path, await toBlob(dataUrl), { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(error.message);
    return path;
  }

  sb.auth.onAuthStateChange(async ev => {
    if (ev === 'PASSWORD_RECOVERY') {
      const pw = prompt('Choose a new password (8+ characters):');
      if (pw && pw.length >= 8) { const { error } = await sb.auth.updateUser({ password: pw }); alert(error ? error.message : 'Password updated ✓'); }
    }
  });

  const api = {
    mode: 'live',
    async init() {},

    // Auth
    async signUp({ email, password }) {
      const { data, error } = await sb.auth.signUp({ email: String(email).trim(), password, options: { emailRedirectTo: webHome() } });
      authErr(error);
      return data.user;
    },
    async signIn({ email, password }) { const { data, error } = await sb.auth.signInWithPassword({ email: String(email).trim(), password }); authErr(error); return data.user; },
    async signOut() { await sb.auth.signOut(); },
    async resetPassword(email) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: webHome() }); authErr(error); return { ok: true, note: 'Check your email for a reset link.' }; },
    async session() {
      const { data } = await sb.auth.getSession();
      if (!data.session) return null;
      const s = await rpc('my_session');
      if (!s) return null;
      const aal = (await sb.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel || 'aal1';
      return { ...s, aal };
    },

    // Profile
    me: () => rpc('get_me'),
    saveProfile: p => rpc('save_profile', { p }),
    async uploadPhoto(dataUrl) {
      if (/^https:\/\//.test(dataUrl)) return dataUrl;
      const path = await upload('photos', dataUrl);
      return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
    },
    async uploadVoice(dataUrl, matchId) {
      const id = await userId(); if (!id) throw new Error('Please log in again.');
      const blob = await toBlob(dataUrl); const type = (blob.type || 'audio/webm').split(';')[0];
      if (blob.size > 2 * 1024 * 1024) throw new Error('Recording is too long.');
      const bucket = matchId ? 'voice' : 'photos', path = `${matchId || id}/${uid()}.${extOf(type)}`;
      const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: type, upsert: false });
      if (error) throw new Error(error.message);
      return matchId ? path : sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
    },
    async mediaUrl(src) {
      if (/^(https:|data:|blob:)/.test(src)) return src;
      const hit = signed.get(src); if (hit && hit.exp > Date.now()) return hit.url;
      const { data, error } = await sb.storage.from('voice').createSignedUrl(src, 3600);
      if (error) throw new Error(error.message);
      signed.set(src, { url: data.signedUrl, exp: Date.now() + 3500e3 }); return data.signedUrl;
    },
    saveAnswer: (qid, ans, qotd = false) => rpc('save_answer', { p_qid: qid, p_m: ans.m, p_a: ans.a, p_i: ans.i, p_qotd: qotd }),
    removeAnswer: qid => rpc('remove_answer', { p_qid: qid }),
    async requestVerification(dataUrl) { const path = await upload('verifications', dataUrl); return rpc('request_verification', { p_selfie: 'verifications/' + path }); },
    async deleteAccount() {
      // Erase uploaded photos, voice notes and selfies first (Storage API), then the account itself.
      const files = await rpc('my_media').catch(() => []);
      const byBucket = {};
      for (const f of files || []) (byBucket[f.bucket] ||= []).push(f.path);
      for (const [bucket, paths] of Object.entries(byBucket)) {
        for (let i = 0; i < paths.length; i += 100) await sb.storage.from(bucket).remove(paths.slice(i, i + 100));
      }
      await rpc('delete_account'); await sb.auth.signOut();
    },

    // Discovery
    settings: () => rpc('get_settings'),
    quota: () => rpc('quota'),
    deck: mode => rpc('get_deck', { p_mode: mode }),
    swipe: (id, kind, o = {}) => rpc('swipe', { p_target: id, p_kind: kind, p_comment: o.comment || '', p_ref: o.ref || '' }),
    undo: () => rpc('undo_swipe'),
    likesYou: () => rpc('likes_you'),
    touchStreak: () => rpc('touch_streak'),

    // Matches & chat
    matches: () => rpc('my_matches'),
    messages: id => rpc('get_messages', { p_match: id }),
    send: (id, body, o = {}) => rpc('send_message', { p_match: id, p_body: body || '', p_kind: o.kind || 'text', p_media: o.media || null, p_meta: o.meta || null }),
    extendMatch: id => rpc('extend_match', { p_match: id }),
    async typing(matchId) { const me = await userId(); chans.get(matchId)?.send({ type: 'broadcast', event: 'typing', payload: { from: me } }); },
    unmatch: id => rpc('unmatch', { p_match: id }),
    report: (target, reason, details = '', messageId = null) => rpc('report_user', { p_target: target, p_reason: reason, p_details: details, p_message: messageId }),
    block: target => rpc('block_user', { p_target: target }),
    subscribe(matchId, cb) {
      const all = matchId === '*';
      const ch = sb.channel(all ? 'inbox-' + uid().slice(0, 8) : 'match-' + matchId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', ...(all ? {} : { filter: `match_id=eq.${matchId}` }) }, payload => cb({ type: 'message', msg: mapMsg(payload.new) }));
      if (!all) { ch.on('broadcast', { event: 'typing' }, ({ payload }) => cb({ type: 'typing', from: payload?.from })); chans.set(matchId, ch); }
      ch.subscribe();
      return () => { if (!all) chans.delete(matchId); sb.removeChannel(ch); };
    },

    // Staff MFA (TOTP)
    mfa: {
      async status() {
        const [{ data: a }, { data: f }] = await Promise.all([sb.auth.mfa.getAuthenticatorAssuranceLevel(), sb.auth.mfa.listFactors()]);
        return { aal: a?.currentLevel, factors: (f?.totp || []).filter(x => x.status === 'verified') };
      },
      async enroll() {
        const { data: f } = await sb.auth.mfa.listFactors();
        for (const x of (f?.all || []).filter(x => x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: x.id });
        const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'SL Connect staff' });
        authErr(error);
        return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
      },
      async verify(factorId, code) { const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code }); authErr(error); }
    },

    admin: {
      stats: () => rpc('admin_stats'),
      users: (q = '') => rpc('admin_users', { p_q: q }),
      setStatus: (id, status, reason = '') => rpc('admin_set_status', { p_id: id, p_status: status, p_reason: reason }),
      reports: (status = 'open') => rpc('admin_reports', { p_status: status }),
      resolveReport: (id, action, note = '') => rpc('admin_resolve_report', { p_id: id, p_action: action, p_note: note }),
      async verifications() {
        const rows = await rpc('admin_verifications');
        return Promise.all(rows.map(async r => {
          const path = (r.verificationSelfie || '').replace(/^verifications\//, '');
          const { data } = path ? await sb.storage.from('verifications').createSignedUrl(path, 600) : { data: null };
          return { ...r, verificationSelfie: data?.signedUrl || '' };
        }));
      },
      decideVerification: (id, ok) => rpc('admin_decide_verification', { p_id: id, p_approve: ok }),
      flagged: () => rpc('admin_flagged'),
      clearFlag: id => rpc('admin_clear_flag', { p_id: id }),
      setRole: (id, role) => rpc('super_set_role', { p_id: id, p_role: role }),
      saveSettings: s => rpc('super_save_settings', { p: s }),
      audit: () => rpc('super_audit'),
      analytics: () => rpc('super_analytics')
    }
  };
  return api;
}
