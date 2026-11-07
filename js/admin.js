// Admin + SuperAdmin consoles. Every action is also enforced server-side (RPC role checks / RLS);
// the UI only hides what a role can't do.
import { getApi } from './data/index.js';
import { $, $$, h, safeImg, ageOf, timeAgo, toast, debounce } from './util.js';
import { flagOf, intentById, DEFAULT_SETTINGS } from './constants.js';

const CONSOLE = document.body.dataset.console; // 'admin' | 'superadmin'
const bg = u => `background-image:url("${safeImg(u).replace(/["'()\\\s]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))}")`;
let api, session, tab;
const memState = { q: '', filter: 'all' };

const TABS = [
  { id: 'overview', label: 'Overview', grp: 'Moderation' },
  { id: 'reports', label: 'Reports', grp: 'Moderation', count: 'openReports' },
  { id: 'verify', label: 'Verification', grp: 'Moderation', count: 'pendingVerifications' },
  { id: 'shield', label: 'Scam Shield', grp: 'Moderation', count: 'flagged' },
  { id: 'members', label: 'Members', grp: 'Moderation' },
  { id: 'analytics', label: 'Analytics', grp: 'Platform', super: true },
  { id: 'staff', label: 'Staff & roles', grp: 'Platform', super: true },
  { id: 'settings', label: 'App settings', grp: 'Platform', super: true },
  { id: 'audit', label: 'Audit log', grp: 'Platform', super: true }
];
const SUSPEND_OPTS = [[1, '24 hours'], [3, '3 days'], [7, '7 days'], [14, '14 days'], [30, '30 days'], ['', 'Until reinstated']];
const ACTION_LABEL = {
  signup: 'Signed up', account_deleted: 'Deleted own account', set_status: 'Status change', suspend: 'Suspended', ban: 'Banned', reinstate: 'Reinstated',
  warn: 'Warning sent', resolve_report: 'Report handled', verify_approve: 'Verification approved', verify_reject: 'Verification rejected',
  clear_flag: 'Flag cleared', set_role: 'Role change', save_settings: 'Settings saved', edit_member: 'Profile content removed', delete_user: 'Account deleted'
};
const EDIT_LABEL = { remove_photo: 'photo removed', clear_bio: 'bio cleared', clear_prompts: 'prompts cleared', clear_voice: 'voice intro removed', revoke_verification: 'verification revoked' };

boot().catch(e => { $('#root').innerHTML = h`<p style="padding:24px">Console failed to load: ${e.message}</p>`; });

async function boot() {
  api = await getApi();
  session = await api.session();
  if (!session) return loginView();
  if (!allowed()) return deniedView();
  if (api.mfa && (await api.settings()).requireAdminMfa) {
    const st = await api.mfa.status();
    if (st.aal !== 'aal2') return mfaView(st);
  }
  shell();
}

const allowed = () => session.status === 'active' && (CONSOLE === 'superadmin' ? session.role === 'superadmin' : ['admin', 'superadmin'].includes(session.role));
const isSuper = () => session.role === 'superadmin';
const superHere = () => isSuper() && CONSOLE === 'superadmin';
const fmtDate = d => d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

function loginView(err = '') {
  $('#root').innerHTML = h`<div class="login-wrap"><form class="auth-card" id="lf" novalidate>
    <span class="logo" style="margin-bottom:14px"><span class="logo-mark"></span>${CONSOLE === 'superadmin' ? 'SuperAdmin' : 'Admin'} Console</span>
    <p style="color:var(--muted);margin:6px 0 18px">Staff only. All actions are logged.</p>
    <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="username" required></label>
    <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
    <div class="err" role="alert">${err}</div>
    <button class="btn btn-primary btn-block">Sign in</button>
    ${api.mode === 'demo' ? h`<div class="demo-note">Demo staff accounts (this device only):<br><span class="mono">${api.demoStaff.map(s => `${s.role}: ${s.email} / ${s.password}`).join('\n')}</span></div>` : ''}
    <p class="fine"><a href="index.html" class="link">← Back to the app</a></p></form></div>`;
  $('.demo-note .mono') && ($('.demo-note .mono').style.whiteSpace = 'pre-line');
  $('#lf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try { await api.signIn({ email: f.get('email'), password: f.get('password') }); session = await api.session(); if (!allowed()) { await api.signOut(); session = null; return loginView('This account does not have access to this console.'); } boot(); }
    catch (x) { loginView(x.message); }
  };
}

function deniedView() {
  $('#root').innerHTML = h`<div class="login-wrap"><div class="auth-card" style="text-align:center"><div style="font-size:44px">🔒</div><h2 style="font-family:var(--display)">No access</h2>
    <p style="color:var(--muted)">You're signed in as ${session.email}, which isn't ${CONSOLE === 'superadmin' ? 'an active SuperAdmin' : 'active staff'}.</p>
    <div class="row"><a class="btn btn-ghost" href="index.html">Back to app</a><button class="btn btn-primary" id="so">Switch account</button></div></div></div>`;
  $('#so').onclick = async () => { await api.signOut(); session = null; loginView(); };
}

async function mfaView(st) {
  const enroll = !st.factors?.length;
  let factorId = st.factors?.[0]?.id, qr = '', secret = '';
  if (enroll) { const r = await api.mfa.enroll(); factorId = r.factorId; qr = r.qr; secret = r.secret; }
  $('#root').innerHTML = h`<div class="login-wrap"><form class="auth-card" id="mf" novalidate>
    <h2 style="font-family:var(--display);margin:0 0 6px">Two-factor authentication</h2>
    <p style="color:var(--muted)">${enroll ? 'Staff accounts require an authenticator app. Scan this code with Google Authenticator, Authy or 1Password.' : 'Enter the 6-digit code from your authenticator app.'}</p>
    ${enroll ? h`<img class="qr" src="${safeImg(qr)}" alt="Authenticator QR code"><p class="fine">Or enter key: <span class="mono">${secret}</span></p>` : ''}
    <label class="field"><span>6-digit code</span><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></label>
    <div class="err" id="mfe"></div><button class="btn btn-primary btn-block">Verify</button>
    <p class="fine"><button type="button" class="link" id="mfo">Sign out</button></p></form></div>`;
  $('#mfo').onclick = async () => { await api.signOut(); location.reload(); };
  $('#mf').onsubmit = async e => {
    e.preventDefault();
    try { await api.mfa.verify(factorId, new FormData(e.target).get('code').trim()); session = await api.session(); shell(); }
    catch (x) { $('#mfe').textContent = x.message; }
  };
}

// ───────────── Dialogs (replace browser confirm/prompt) ─────────────
function modal(html, { wide = false, onClose } = {}) {
  const back = document.createElement('div'); back.className = 'mdl-bg';
  const box = document.createElement('div'); box.className = 'mdl' + (wide ? ' wide' : ''); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  box.innerHTML = h`<button class="mdl-x" aria-label="Close">✕</button><div class="mdl-body"></div>`;
  const body = $('.mdl-body', box); body.innerHTML = html;
  document.body.append(back, box); document.body.classList.add('mdl-open');
  const key = e => { if (e.key === 'Escape') close(); };
  const close = (silent = false) => { back.remove(); box.remove(); document.removeEventListener('keydown', key); if (!$('.mdl')) document.body.classList.remove('mdl-open'); if (!silent) onClose?.(); };
  back.onclick = () => close(); $('.mdl-x', box).onclick = () => close();
  document.addEventListener('keydown', key);
  return { el: box, body, close };
}

function ask({ title, text = '', fields = [], ok = 'Confirm', danger = false, confirmWord = '' }) {
  return new Promise(res => {
    const field = f => f.type === 'select'
      ? h`<label class="field"><span>${f.label}</span><select class="input" name="${f.name}">${f.options.map(([v, l]) => h`<option value="${v}" ${String(v) === String(f.value ?? '') ? 'selected' : ''}>${l}</option>`)}</select></label>`
      : f.type === 'textarea'
        ? h`<label class="field"><span>${f.label}</span><textarea class="input" name="${f.name}" rows="4" maxlength="${f.max || 500}">${f.value || ''}</textarea></label>`
        : h`<label class="field"><span>${f.label}</span><input class="input" name="${f.name}" value="${f.value || ''}" maxlength="${f.max || 200}" placeholder="${f.placeholder || ''}" autocomplete="off"></label>`;
    const m = modal(h`<form class="ask" novalidate><h2>${title}</h2>${text ? h`<p class="sub">${text}</p>` : ''}
      ${fields.map(field)}
      ${confirmWord ? field({ name: '_confirm', label: `Type ${confirmWord} to confirm`, placeholder: confirmWord }) : ''}
      <div class="err" role="alert"></div>
      <div class="ask-acts"><button type="button" class="btn btn-ghost" data-x>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${ok}</button></div></form>`, { onClose: () => res(null) });
    const f = $('form', m.el);
    setTimeout(() => (f.querySelector('input, textarea, select') || f.querySelector('[data-ok]'))?.focus(), 30);
    f.onsubmit = e => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      for (const x of fields) if (x.required && !String(v[x.name] || '').trim()) { $('.err', f).textContent = `${x.label} is required.`; return; }
      if (confirmWord && String(v._confirm || '').trim().toLowerCase() !== confirmWord.toLowerCase()) { $('.err', f).textContent = `Type ${confirmWord} exactly to confirm.`; return; }
      delete v._confirm; m.close(true); res(v);
    };
    $('[data-x]', f).onclick = () => m.close();
  });
}

function downloadCsv(name, rows) {
  // Cells starting with = + - @ are prefixed so spreadsheets don't run them as formulas.
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ───────────── Moderation actions shared by every view ─────────────
const MOD = {
  async warn(id, who) {
    const v = await ask({ title: `Warn ${who}`, text: 'The member sees this message the next time they open the app and must tap "I understand".', ok: 'Send warning',
      fields: [{ name: 'msg', label: 'Message to the member', type: 'textarea', required: true, value: 'Please follow our community guidelines — be respectful, keep conversations on Sierra Leone Connect and never ask for money. Further reports can lead to suspension.' }] });
    if (!v) return false;
    await api.admin.warn(id, v.msg); toast('Warning sent'); return true;
  },
  async suspend(id, who) {
    const v = await ask({ title: `Suspend ${who}`, text: 'They can\'t use the app until the suspension ends and are hidden from everyone\'s deck.', ok: 'Suspend', danger: true,
      fields: [{ name: 'days', label: 'Length', type: 'select', options: SUSPEND_OPTS, value: 7 }, { name: 'reason', label: 'Reason (shown to the member)', value: 'Violation of community guidelines', required: true }] });
    if (!v) return false;
    await api.admin.setStatus(id, 'suspended', v.reason, v.days ? Number(v.days) : null); toast('Member suspended'); return true;
  },
  async ban(id, who) {
    const v = await ask({ title: `Ban ${who}`, text: 'A ban is permanent until a moderator reinstates the account. Their matches disappear for everyone.', ok: 'Ban member', danger: true,
      fields: [{ name: 'reason', label: 'Reason (shown to the member)', value: 'Serious violation of community guidelines', required: true }] });
    if (!v) return false;
    await api.admin.setStatus(id, 'banned', v.reason); toast('Member banned'); return true;
  },
  async reinstate(id, who) {
    const v = await ask({ title: `Reinstate ${who}?`, text: 'The account becomes active again straight away.', ok: 'Reinstate' });
    if (!v) return false;
    await api.admin.setStatus(id, 'active', ''); toast('Member reinstated'); return true;
  }
};
const run = async (fn, after) => { try { if (await fn() !== false) await after?.(); } catch (e) { toast(e.message, 'error'); } };

let stats = {};
async function shell() {
  const tabs = TABS.filter(t => !t.super || superHere());
  $('#root').innerHTML = h`<div class="cons"><aside class="side" aria-label="Console navigation">
      <span class="logo"><span class="logo-mark"></span>${CONSOLE === 'superadmin' ? 'SuperAdmin' : 'Admin'}</span>
      ${tabs.map((t, i) => h`${t.grp !== tabs[i - 1]?.grp ? h`<div class="grp">${t.grp.toUpperCase()}</div>` : ''}<button class="nv" data-tab="${t.id}">${t.label}${t.count ? h`<span class="badge hidden" data-count="${t.count}"></span>` : ''}</button>`)}
      <div class="who-box"><b>${session.email}</b><br><span class="status ${session.role}">${session.role}</span>
        <div style="display:grid;gap:6px;margin-top:10px">${isSuper() && CONSOLE === 'admin' ? h`<a class="btn btn-ghost btn-sm" href="superadmin.html">SuperAdmin console</a>` : ''}${isSuper() && CONSOLE === 'superadmin' ? h`<a class="btn btn-ghost btn-sm" href="admin.html">Moderator console</a>` : ''}<a class="btn btn-ghost btn-sm" href="index.html">Open app</a><button class="btn btn-ghost btn-sm" id="out">Sign out</button></div></div>
    </aside><main class="main" id="main"></main></div>`;
  $('.side').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); };
  $('#out').onclick = async () => { await api.signOut(); location.reload(); };
  $('#main').addEventListener('click', e => { const b = e.target.closest('[data-member]'); if (b && b.dataset.member) openMember(b.dataset.member); });
  window.onhashchange = () => go(location.hash.slice(1) || 'overview', false);
  go(location.hash.slice(1) || 'overview', false);
}

async function refreshCounts() {
  try { stats = await api.admin.stats(); $$('[data-count]').forEach(b => { const n = stats[b.dataset.count] || 0; b.textContent = n; b.classList.toggle('hidden', !n); }); }
  catch (e) { if (/authori|log in|aal2|two-factor|banned|suspended/i.test(e.message)) location.reload(); }
}

async function go(t, push = true) {
  const def = TABS.find(x => x.id === t);
  if (!def || (def.super && !superHere())) t = 'overview';
  tab = t;
  if (push) history.replaceState(null, '', '#' + t);
  $$('.side [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false'));
  const m = $('#main'); m.innerHTML = '<div class="spinner"></div>';
  await refreshCounts();
  try { await VIEWS[t](m); } catch (e) { m.innerHTML = h`<div class="panel"><b>Error:</b> ${e.message}</div>`; }
}
const reload = () => go(tab, false);

const fullName = p => [p?.firstName ?? p?.name, p?.lastName].filter(Boolean).join(' ') || '—';
const userCell = (p, email, id = p?.id) => h`<button class="ucell" ${id ? h`data-member="${id}"` : ''} title="Open member"><span class="av-xs" style="${bg((p?.photos || [])[0])}"></span><span><b>${fullName(p)}${p?.verified ? ' ✓' : ''}</b><small>${p?.username ? '@' + p.username + ' · ' : ''}${email || ''}</small></span></button>`;
const statusPill = u => h`<span class="status ${u.status}">${u.status}</span>${u.status === 'suspended' && u.suspendedUntil ? h`<small class="until">until ${fmtDate(u.suspendedUntil)}</small>` : ''}`;

function lineChart(days, series) {
  const W = 640, H = 190, P = 26, max = Math.max(1, ...series.flatMap(s => s.data));
  const x = i => P + i * (W - P * 2) / (days.length - 1), y = v => H - P - v / max * (H - P * 2);
  return h`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="14-day trend">
    ${[0, .5, 1].map(f => h`<line x1="${P}" x2="${W - P}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="rgba(255,255,255,.08)"/><text x="2" y="${y(max * f) + 3}">${Math.round(max * f)}</text>`)}
    ${series.map(s => h`<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" points="${s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`)}
    ${days.map((d, i) => i % 3 === 0 ? h`<text x="${x(i) - 12}" y="${H - 6}">${d.slice(5)}</text>` : '')}
  </svg><div class="row" style="flex:0;gap:14px;font-size:13px;flex-wrap:wrap">${series.map(s => h`<span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${s.color}"></i> ${s.name}</span>`)}</div>`;
}
const bars = obj => { const e = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 10), m = Math.max(1, ...e.map(x => x[1])); return e.length ? h`<div class="bars">${e.map(([k, v]) => h`<div><span>${k}</span><i style="width:${v / m * 100}%"></i><b>${v}</b></div>`)}</div>` : h`<p class="sub">No data yet.</p>`; };
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';

// ───────────── Member detail ─────────────
async function openMember(id) {
  const m = modal('<div class="spinner"></div>', { wide: true });
  const refresh = async () => { await draw(); reload(); };
  async function draw() {
    let p;
    try { p = await api.admin.member(id); } catch (e) { m.body.innerHTML = h`<div class="panel"><b>Error:</b> ${e.message}</div>`; return; }
    const self = p.id === session.id, staffTarget = p.role !== 'user';
    const canAct = !self && (!staffTarget || isSuper());
    const who = '@' + (p.username || p.firstName || 'member');
    const c = p.counts || {};
    m.body.innerHTML = h`<div class="mem">
      <div class="mem-head"><div class="av-lg" style="${bg((p.photos || [])[0])}"></div>
        <div><h2>${fullName(p)}${p.verified ? h` <span class="tag blue">✓ Verified</span>` : ''}</h2>
          <p class="sub" style="margin:2px 0 8px">${p.username ? '@' + p.username + ' · ' : ''}${p.email || ''}</p>
          ${statusPill(p)} ${staffTarget ? h`<span class="status ${p.role}">${p.role}</span>` : ''} ${p.paused ? h`<span class="tag">Paused</span>` : ''} ${!p.onboarded ? h`<span class="tag">Not onboarded</span>` : ''}</div></div>
      ${p.status !== 'active' && p.statusReason ? h`<div class="note-box">Reason: ${p.statusReason}</div>` : ''}
      ${p.notice ? h`<div class="note-box warn">Unread warning (sent ${timeAgo(p.noticeAt)} ago): ${p.notice}</div>` : ''}
      <div class="facts">
        <div><span>Age</span><b>${ageOf(p.dob) ?? '—'}</b></div><div><span>Gender</span><b>${p.gender || '—'}</b></div>
        <div><span>Location</span><b>${p.city || p.country ? h`${flagOf(p.country)} ${[p.city, p.country].filter(Boolean).join(', ')}` : '—'}</b></div>
        <div><span>Looking for</span><b>${p.intent ? intentById(p.intent).label : '—'}</b></div>
        <div><span>Joined</span><b>${fmtDate(p.createdAt)}</b></div><div><span>Last active</span><b>${p.lastActive ? timeAgo(p.lastActive) + ' ago' : '—'}</b></div>
        <div><span>Profile</span><b>${p.completeness ?? 0}% complete</b></div><div><span>Verification</span><b>${p.verified ? 'approved' : p.verificationStatus || 'none'}</b></div>
      </div>
      <div class="counts">
        <div><b>${c.matches ?? 0}</b><span>matches</span></div><div><b>${c.messages ?? 0}</b><span>messages</span></div>
        <div><b>${c.likesSent ?? 0}</b><span>likes sent</span></div><div><b>${c.likesReceived ?? 0}</b><span>likes received</span></div>
        <div class="${c.reportsAgainst ? 'hot' : ''}"><b>${c.reportsAgainst ?? 0}</b><span>reports against</span></div><div><b>${c.blockedBy ?? 0}</b><span>blocked by</span></div>
        <div class="${c.flagged ? 'hot' : ''}"><b>${c.flagged ?? 0}</b><span>flagged messages</span></div><div><b>${c.reportsMade ?? 0}</b><span>reports made</span></div>
      </div>
      ${canAct ? h`<div class="mem-acts">
        <button class="btn btn-ghost btn-sm" data-do="warn">⚠️ Warn</button>
        ${p.status === 'active' ? h`<button class="btn btn-ghost btn-sm" data-do="suspend">Suspend…</button><button class="btn btn-danger btn-sm" data-do="ban">Ban</button>` : h`<button class="btn btn-primary btn-sm" data-do="reinstate">Reinstate</button>${p.status === 'suspended' ? h`<button class="btn btn-danger btn-sm" data-do="ban">Ban</button>` : ''}`}
        ${p.verified ? h`<button class="btn btn-ghost btn-sm" data-do="revoke">Revoke verification</button>` : ''}
        ${superHere() && p.role !== 'superadmin' ? h`<button class="btn btn-danger btn-sm" data-do="delete">Delete account…</button>` : ''}
      </div>` : h`<p class="sub">${self ? 'This is your own account.' : 'Only a SuperAdmin can act on staff accounts.'}</p>`}
      <h3>Photos</h3>
      ${(p.photos || []).length ? h`<div class="ph-grid">${p.photos.map((u, i) => h`<div class="ph" style="${bg(u)}">${canAct ? h`<button class="ph-x" data-photo="${i}" aria-label="Remove photo ${i + 1}">Remove</button>` : ''}</div>`)}</div>` : h`<p class="sub">No photos.</p>`}
      <h3>Bio ${canAct && p.bio ? h`<button class="link sm" data-do="clear_bio">Clear</button>` : ''}</h3><p class="mem-text">${p.bio || '—'}</p>
      <h3>Prompts ${canAct && (p.prompts || []).length ? h`<button class="link sm" data-do="clear_prompts">Clear all</button>` : ''}</h3>
      ${(p.prompts || []).filter(x => x.a).map(x => h`<div class="mem-text"><small>${x.q}</small><br>${x.a}</div>`)}${!(p.prompts || []).some(x => x.a) ? h`<p class="mem-text">—</p>` : ''}
      ${p.voice ? h`<h3>Voice intro ${canAct ? h`<button class="link sm" data-do="clear_voice">Remove</button>` : ''}</h3><audio controls preload="none" src="${safeAudio(p.voice)}"></audio>` : ''}
      <h3>Reports against this member</h3>
      ${(p.reports || []).length ? (p.reports).map(r => h`<div class="mini"><span class="tag gold">${r.reason}</span> <span class="status ${r.status === 'open' ? 'suspended' : 'active'}">${r.status}${r.resolution ? ' · ' + r.resolution : ''}</span> <small>${timeAgo(r.at)} ago${r.reporter ? ' · by @' + r.reporter : ''}</small>${r.details ? h`<q>${r.details}</q>` : ''}</div>`) : h`<p class="sub">None.</p>`}
      <h3>Staff history</h3>
      ${(p.history || []).length ? h`<div class="hist">${p.history.map(x => h`<div><small>${fmtDate(x.at)}</small><b>${ACTION_LABEL[x.action] || x.action}${x.action === 'edit_member' ? ' · ' + (EDIT_LABEL[x.meta?.action] || x.meta?.action || '') : ''}</b><span>${x.actor}${x.meta?.reason ? ' — ' + x.meta.reason : ''}${x.meta?.days ? ` (${x.meta.days} days)` : ''}${x.meta?.message ? ' — “' + x.meta.message + '”' : ''}${x.meta?.role ? ' → ' + x.meta.role : ''}</span></div>`)}</div>` : h`<p class="sub">No staff actions yet.</p>`}
    </div>`;
    const edit = async (action, index, label) => {
      const v = await ask({ title: `Remove from ${who}'s profile?`, text: label, ok: 'Remove', danger: true });
      if (!v) return false;
      await api.admin.editMember(id, action, index); toast('Removed');
    };
    $$('[data-photo]', m.body).forEach(b => b.onclick = () => run(() => edit('remove_photo', Number(b.dataset.photo), `Photo ${Number(b.dataset.photo) + 1} is removed from the profile and deleted.`), refresh));
    $$('[data-do]', m.body).forEach(b => b.onclick = () => {
      const d = b.dataset.do;
      if (MOD[d]) return run(() => MOD[d](id, who), refresh);
      if (d === 'clear_bio') return run(() => edit('clear_bio', null, 'The bio is erased. The member can write a new one.'), refresh);
      if (d === 'clear_prompts') return run(() => edit('clear_prompts', null, 'All prompt answers are erased.'), refresh);
      if (d === 'clear_voice') return run(() => edit('clear_voice', null, 'The voice intro is removed and deleted.'), refresh);
      if (d === 'revoke') return run(async () => { if (!await ask({ title: 'Revoke verification?', text: 'The ✓ badge disappears. The member can submit a new selfie.', ok: 'Revoke', danger: true })) return false; await api.admin.editMember(id, 'revoke_verification'); toast('Verification revoked'); }, refresh);
      if (d === 'delete') return run(async () => {
        const word = p.username || 'DELETE';
        if (!await ask({ title: `Permanently delete ${who}?`, text: 'Deletes the account, profile, photos, matches and messages. This cannot be undone. Use this for deletion requests or illegal content.', ok: 'Delete forever', danger: true, confirmWord: word })) return false;
        await api.admin.deleteUser(id); toast('Account deleted'); m.close(true); reload(); return false;
      });
    });
  }
  await draw();
}
const safeAudio = u => /^https:\/\//i.test(u || '') || /^data:audio\//i.test(u || '') ? u : '';

const VIEWS = {
  async overview(m) {
    const s = stats;
    m.innerHTML = h`<h1>Overview</h1><p class="sub">Community health at a glance.</p>
      <div class="kpis">
        <div class="kpi"><span>Members</span><b>${s.users}</b></div><div class="kpi"><span>Active 24h</span><b>${s.active24h}</b></div>
        <div class="kpi"><span>New today</span><b>${s.newToday}</b></div><div class="kpi"><span>New this week</span><b>${s.new7d ?? '—'}</b></div>
        <div class="kpi"><span>Active matches</span><b>${s.matches}</b></div><div class="kpi"><span>Messages</span><b>${s.messages}</b></div>
        <div class="kpi ${s.openReports ? 'alert' : ''}"><span>Open reports</span><b>${s.openReports}</b></div>
        <div class="kpi ${s.pendingVerifications ? 'alert' : ''}"><span>Pending verifications</span><b>${s.pendingVerifications}</b></div>
        <div class="kpi ${s.flagged ? 'alert' : ''}"><span>Scam Shield flags</span><b>${s.flagged}</b></div>
        <div class="kpi"><span>Suspended</span><b>${s.suspended ?? 0}</b></div><div class="kpi"><span>Banned</span><b>${s.banned}</b></div></div>
      <div class="panel"><h2>Moderator checklist</h2>
        <button class="list-btn" data-g="reports">Review open reports <span class="tag gold">${s.openReports}</span></button>
        <button class="list-btn" data-g="verify">Approve selfie verifications <span class="tag blue">${s.pendingVerifications}</span></button>
        <button class="list-btn" data-g="shield">Check Scam Shield flags <span class="tag gold">${s.flagged}</span></button>
        <button class="list-btn" data-g="members">Find a member <span class="tag">${s.users}</span></button></div>`;
    $$('[data-g]', m).forEach(b => b.onclick = () => go(b.dataset.g));
  },

  async reports(m, status = 'open') {
    const rs = await api.admin.reports(status);
    m.innerHTML = h`<h1>Reports</h1><p class="sub">Confidential member reports. Resolve every report within 24 hours. Click a member to see their full history.</p>
      <div class="chips" style="margin-bottom:14px" id="rf">${['open', 'actioned', 'dismissed', 'all'].map(x => h`<button class="chip" data-s="${x}" aria-pressed="${x === status}">${x}</button>`)}</div>
      ${rs.length ? rs.map(r => h`<div class="item"><div class="top">${userCell(r.subject, r.subject?.email, r.subject?.id)}<span><span class="tag gold">${r.reason}</span> <span class="status ${r.subject?.status}">${r.subject?.status}</span></span></div>
        ${r.details ? h`<q>${r.details}</q>` : ''}
        ${r.message ? h`<div class="quoted"><small>Reported message</small><q>${r.message}</q></div>` : ''}
        <small style="color:var(--muted)">Reported by ${r.reporter?.name ? '@' + r.reporter.name : r.reporter?.email || 'a deleted member'} · ${timeAgo(r.at)} ago${r.resolution ? ` · handled: ${r.resolution}` : ''}</small>
        ${r.status === 'open' ? h`<div class="acts"><button class="btn btn-ghost btn-sm" data-r="${r.id}" data-a="dismiss">Dismiss</button><button class="btn btn-ghost btn-sm" data-r="${r.id}" data-a="warn">Warn</button><button class="btn btn-danger btn-sm" data-r="${r.id}" data-a="suspend">Suspend…</button><button class="btn btn-danger btn-sm" data-r="${r.id}" data-a="ban">Ban</button></div>` : ''}</div>`)
        : h`<div class="panel" style="text-align:center;color:var(--muted)">Nothing here 🎉</div>`}`;
    $('#rf').onclick = e => { const b = e.target.closest('[data-s]'); if (b) VIEWS.reports(m, b.dataset.s); };
    $$('[data-r]', m).forEach(b => b.onclick = () => run(async () => {
      const r = rs.find(x => x.id === b.dataset.r), who = '@' + (r.subject?.username || 'member'), a = b.dataset.a;
      if (a === 'dismiss') { await api.admin.resolveReport(r.id, 'dismiss'); toast('Report dismissed'); return; }
      if (a === 'warn') {
        const v = await ask({ title: `Warn ${who}`, text: 'Sent with the report. They see it next time they open the app.', ok: 'Send warning',
          fields: [{ name: 'msg', label: 'Message to the member', type: 'textarea', required: true, value: `We received a report about your activity (${r.reason}). Please follow our community guidelines — further reports can lead to suspension.` }] });
        if (!v) return false;
        await api.admin.resolveReport(r.id, 'warn', v.msg); toast('Warning sent · report closed'); return;
      }
      if (a === 'suspend') {
        const v = await ask({ title: `Suspend ${who}`, text: `Reason shown to the member: "Report: ${r.reason}".`, ok: 'Suspend', danger: true, fields: [{ name: 'days', label: 'Length', type: 'select', options: SUSPEND_OPTS.filter(x => x[0]), value: 7 }] });
        if (!v) return false;
        await api.admin.resolveReport(r.id, 'suspend', '', Number(v.days)); toast('Member suspended · report closed'); return;
      }
      if (!await ask({ title: `Ban ${who}?`, text: 'Bans the account and closes every other open report about this member.', ok: 'Ban member', danger: true })) return false;
      await api.admin.resolveReport(r.id, 'ban'); toast('Member banned · reports closed');
    }, () => VIEWS.reports(m, status).then(refreshCounts)));
  },

  async verify(m) {
    const vs = await api.admin.verifications();
    m.innerHTML = h`<h1>Verification</h1><p class="sub">Approve only if the selfie clearly shows the same person doing a thumbs-up.</p>
      ${vs.length ? vs.map(p => h`<div class="item"><div class="top">${userCell(p, p.email)}<span style="color:var(--muted);font-size:13px">${ageOf(p.dob) || ''} · ${flagOf(p.country)} ${p.city || ''}</span></div>
        <div class="verify-pair"><div style="${bg(p.verificationSelfie)}"><span class="tag gold">Selfie</span></div><div style="${bg((p.photos || [])[0])}"><span class="tag">Profile</span></div></div>
        <div class="acts"><button class="btn btn-primary btn-sm" data-v="${p.id}" data-ok="1">Approve ✓</button><button class="btn btn-danger btn-sm" data-v="${p.id}" data-ok="">Reject</button></div></div>`)
        : h`<div class="panel" style="text-align:center;color:var(--muted)">No pending verifications.</div>`}`;
    $$('[data-v]', m).forEach(b => b.onclick = () => run(async () => { await api.admin.decideVerification(b.dataset.v, !!b.dataset.ok); toast(b.dataset.ok ? 'Verified ✓' : 'Rejected'); }, reload));
  },

  async shield(m) {
    const fs = await api.admin.flagged();
    m.innerHTML = h`<h1>Scam Shield</h1><p class="sub">Messages automatically flagged for money requests, payment apps, crypto, gift cards or off-platform contact.</p>
      ${fs.length ? fs.map(x => h`<div class="item"><div class="top">${userCell({ firstName: x.sender?.name ? '@' + x.sender.name : 'Member', id: x.sender?.id }, x.sender?.email, x.sender?.id)}<span>${x.flagged.map(f => h`<span class="tag gold" style="margin-left:4px">${f}</span>`)}</span></div>
        <q>${x.body}</q><small style="color:var(--muted)">${timeAgo(x.at)} ago · sender is <span class="status ${x.sender?.status}">${x.sender?.status}</span></small>
        <div class="acts"><button class="btn btn-ghost btn-sm" data-c="${x.id}">Looks fine</button><button class="btn btn-ghost btn-sm" data-w="${x.sender?.id}" data-c2="${x.id}">Warn sender</button><button class="btn btn-danger btn-sm" data-s="${x.sender?.id}" data-c2="${x.id}" data-st="suspend">Suspend sender…</button><button class="btn btn-danger btn-sm" data-s="${x.sender?.id}" data-c2="${x.id}" data-st="ban">Ban sender</button></div></div>`)
        : h`<div class="panel" style="text-align:center;color:var(--muted)">No flagged messages.</div>`}`;
    $$('[data-c]', m).forEach(b => b.onclick = () => run(async () => { await api.admin.clearFlag(b.dataset.c); toast('Cleared'); }, reload));
    $$('[data-w]', m).forEach(b => b.onclick = () => run(async () => { if (!await MOD.warn(b.dataset.w, 'sender')) return false; await api.admin.clearFlag(b.dataset.c2); }, reload));
    $$('[data-s]', m).forEach(b => b.onclick = () => run(async () => { if (!await MOD[b.dataset.st](b.dataset.s, 'sender')) return false; await api.admin.clearFlag(b.dataset.c2); }, reload));
  },

  async members(m) {
    const FILTERS = [['all', 'All'], ['active', 'Active'], ['reported', 'Open reports'], ['suspended', 'Suspended'], ['banned', 'Banned'], ['pending', 'Awaiting verification'], ['verified', 'Verified'], ['unverified', 'Not verified'], ['staff', 'Staff']];
    m.innerHTML = h`<h1>Members</h1><p class="sub">Search by name, username, email, city or country. Click a member for their profile, history and moderation tools.</p>
      <div class="search"><input class="input" id="q" placeholder="Search members…" value="${memState.q}" aria-label="Search members">${superHere() ? h`<button class="btn btn-ghost" id="csv">Export CSV</button>` : ''}</div>
      <div class="chips" id="mf" style="margin-bottom:14px">${FILTERS.map(([k, l]) => h`<button class="chip" data-f="${k}" aria-pressed="${k === memState.filter}">${l}</button>`)}</div>
      <div id="ul"><div class="spinner"></div></div>`;
    let rows = [];
    const draw = async () => {
      rows = await api.admin.members(memState.q, memState.filter);
      $('#ul').innerHTML = rows.length ? h`<p class="sub" style="margin:0 0 8px">${rows.length}${rows.length >= 500 ? '+' : ''} member${rows.length === 1 ? '' : 's'}</p><div class="panel tbl-wrap"><table class="tbl"><thead><tr><th>Member</th><th>Location</th><th>Joined</th><th>Last active</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map(u => h`<tr><td>${userCell(u.profile, u.email, u.id)}</td><td>${u.profile?.city || u.profile?.country ? h`${flagOf(u.profile.country)} ${u.profile.city || u.profile.country}` : '—'}</td><td>${timeAgo(u.createdAt)} ago</td><td>${u.lastActive ? timeAgo(u.lastActive) + ' ago' : '—'}</td>
          <td>${statusPill(u)}${u.role !== 'user' ? h` <span class="status ${u.role}">${u.role}</span>` : ''}${u.openReports ? h` <span class="tag gold">${u.openReports} report${u.openReports > 1 ? 's' : ''}</span>` : ''}${u.profile?.verificationStatus === 'pending' ? h` <span class="tag blue">verify</span>` : ''}</td>
          <td><button class="btn btn-ghost btn-sm" data-member="${u.id}">Open</button></td></tr>`)}</tbody></table></div>`
        : h`<div class="panel" style="text-align:center;color:var(--muted)">No members match.</div>`;
    };
    $('#q').oninput = debounce(e => { memState.q = e.target.value; draw(); }, 300);
    $('#mf').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; memState.filter = b.dataset.f; $$('[data-f]', m).forEach(x => x.setAttribute('aria-pressed', x === b)); draw(); };
    if ($('#csv')) $('#csv').onclick = () => downloadCsv(`slc-members-${new Date().toISOString().slice(0, 10)}.csv`,
      [['Username', 'First name', 'Last name', 'Email', 'Gender', 'Age', 'City', 'Country', 'Status', 'Role', 'Verified', 'Open reports', 'Joined', 'Last active'],
        ...rows.map(u => [u.profile?.username, u.profile?.firstName, u.profile?.lastName, u.email, u.profile?.gender, ageOf(u.profile?.dob), u.profile?.city, u.profile?.country, u.status, u.role, u.profile?.verified ? 'yes' : 'no', u.openReports, u.createdAt, u.lastActive])]);
    await draw();
  },

  async analytics(m) {
    const a = await api.admin.analytics(), t = a.totals || {};
    m.innerHTML = h`<h1>Analytics</h1><p class="sub">Growth and engagement over the last 14 days.</p>
      <div class="kpis">
        <div class="kpi"><span>Members</span><b>${t.members ?? '—'}</b></div>
        <div class="kpi"><span>Finished onboarding</span><b>${pct(t.onboarded, t.members)}</b></div>
        <div class="kpi"><span>Verified</span><b>${pct(t.verified, t.members)}</b></div>
        <div class="kpi"><span>Likes sent</span><b>${t.likes ?? '—'}</b></div>
        <div class="kpi"><span>Matches</span><b>${t.matches ?? '—'}</b></div>
        <div class="kpi"><span>Matches that chatted</span><b>${pct(t.conversations, t.matches)}</b></div></div>
      <div class="panel"><h2>Growth & engagement</h2>${lineChart(a.days, [{ name: 'Likes', data: a.likes || a.days.map(() => 0), color: '#E04F8B' }, { name: 'Matches', data: a.matches, color: '#1EB53A' }, { name: 'Sign-ups', data: a.signups, color: '#3B9BEA' }, { name: 'Messages', data: a.messages, color: '#F5B82E' }])}</div>
      <div class="grid-2"><div class="panel"><h2>Where members live</h2>${bars(Object.fromEntries(Object.entries(a.byCountry).map(([k, v]) => [flagOf(k) + ' ' + k, v])))}</div>
      <div class="panel"><h2>Relationship goals</h2>${bars(Object.fromEntries(Object.entries(a.byIntent).map(([k, v]) => [intentById(k).label, v])))}</div>
      <div class="panel"><h2>Gender</h2>${bars(Object.fromEntries(Object.entries(a.byGender || {}).map(([k, v]) => [k === 'woman' ? 'Women' : k === 'man' ? 'Men' : k, v])))}</div></div>`;
  },

  async staff(m) {
    const us = await api.admin.members('', 'staff');
    m.innerHTML = h`<h1>Staff & roles</h1><p class="sub">Admins moderate members. SuperAdmins also manage staff, app settings, analytics, account deletion and the audit log.</p>
      <div class="panel tbl-wrap"><table class="tbl"><thead><tr><th>Staff</th><th>Role</th><th>Last active</th><th></th></tr></thead><tbody>
        ${us.map(u => h`<tr><td>${userCell(u.profile, u.email, u.id)}</td><td><span class="status ${u.role}">${u.role}</span>${u.status !== 'active' ? h` ${statusPill(u)}` : ''}</td><td>${u.lastActive ? timeAgo(u.lastActive) + ' ago' : '—'}</td><td style="white-space:nowrap">${u.id === session.id ? h`<small style="color:var(--muted)">you</small>` : h`<button class="btn btn-ghost btn-sm" data-id="${u.id}" data-role="user">Remove staff</button> ${u.role === 'admin' ? h`<button class="btn btn-ghost btn-sm" data-id="${u.id}" data-role="superadmin">Make SuperAdmin</button>` : h`<button class="btn btn-ghost btn-sm" data-id="${u.id}" data-role="admin">Make Admin</button>`}`}</td></tr>`)}</tbody></table></div>
      <div class="panel"><h2>Promote a member</h2><p class="sub">They'll need to set up an authenticator app the first time they open a console.</p><div class="search"><input class="input" id="pq" placeholder="Search by email, name or username"></div><div id="pr"></div></div>`;
    const ROLE_TXT = { user: 'remove their staff access', admin: 'make them an Admin (moderation)', superadmin: 'make them a SuperAdmin (full control)' };
    const bind = root => $$('[data-role]', root).forEach(b => b.onclick = () => run(async () => {
      if (!await ask({ title: 'Change role?', text: `This will ${ROLE_TXT[b.dataset.role]}.`, ok: 'Change role', danger: b.dataset.role !== 'admin' })) return false;
      await api.admin.setRole(b.dataset.id, b.dataset.role); toast('Role updated');
    }, reload));
    bind(m);
    $('#pq').oninput = debounce(async e => {
      const q = e.target.value.trim(); if (q.length < 2) return $('#pr').innerHTML = '';
      const r = (await api.admin.members(q, 'all')).filter(u => u.role === 'user' && u.status === 'active').slice(0, 8);
      $('#pr').innerHTML = r.length ? h`${r.map(u => h`<div class="list-btn">${userCell(u.profile, u.email, u.id)}<button class="btn btn-ghost btn-sm" data-id="${u.id}" data-role="admin">Make Admin</button></div>`)}` : h`<p class="sub">No active members match.</p>`;
      bind($('#pr'));
    }, 300);
  },

  async settings(m) {
    const s = { ...DEFAULT_SETTINGS, ...(await api.settings()) };
    const num = (k, label, hint, min = 0, max = 1000) => h`<label class="field"><span>${label}</span><input class="input" type="number" min="${min}" max="${max}" data-k="${k}" value="${s[k]}"><small style="color:var(--dim)">${hint}</small></label>`;
    const tog = (k, label, hint) => h`<label class="switch-row"><span>${label}<small>${hint}</small></span><span class="toggle"><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}><span></span></span></label>`;
    m.innerHTML = h`<h1>App settings</h1><p class="sub">Changes apply to everyone immediately and are recorded in the audit log.</p>
      <div class="panel"><h2>Discovery limits</h2><div class="set-grid">${num('dailyLikes', 'Daily likes per member', 'Keeps likes meaningful and reduces spam.')}${num('dailySuperLikes', 'Daily Oya! super likes', 'Super likes jump the queue.', 0, 100)}${num('minAge', 'Minimum age', 'Never below 18.', 18, 99)}</div></div>
      <div class="panel"><h2>Access</h2>${tog('signupsOpen', 'New sign-ups open', 'Turn off to pause new registrations (existing members can still log in).')}${tog('maintenance', 'Maintenance mode', 'Members see a "be right back" screen. Staff can still sign in.')}${tog('requireAdminMfa', 'Require 2FA for staff', 'Authenticator app required for consoles and staff data (live mode). Strongly recommended.')}</div>
      <div class="panel"><h2>Safety & features</h2>${tog('scamShield', 'Scam Shield', 'Flag money requests, payment apps and off-platform contact in chat.')}${tog('undoEnabled', 'Undo last swipe', 'Let members bring back their last swipe.')}</div>
      <div class="panel"><h2>Announcement banner</h2><label class="field"><span>Shown at the top of Discover (leave empty to hide)</span><input class="input" data-k="announcement" maxlength="280" value="${s.announcement}"></label></div>
      <button class="btn btn-primary" id="save">Save settings</button>
      ${api.mode === 'demo' ? h`<button class="btn btn-danger" id="reset" style="margin-left:10px">Reset demo data</button>` : ''}`;
    $('#save').onclick = () => run(async () => {
      const out = {};
      $$('[data-k]', m).forEach(i => out[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value);
      if (out.minAge < 18) return toast('Minimum age can\'t be below 18.', 'error'), false;
      if (!out.requireAdminMfa && s.requireAdminMfa && !await ask({ title: 'Turn off staff 2FA?', text: 'Anyone who gets a staff password could then read member data. Only do this temporarily.', ok: 'Turn off 2FA', danger: true })) return false;
      if (out.maintenance && !s.maintenance && !await ask({ title: 'Turn on maintenance mode?', text: 'Every member is locked out until you turn it off.', ok: 'Turn on', danger: true })) return false;
      await api.admin.saveSettings(out); toast('Settings saved');
    }, reload);
    if ($('#reset')) $('#reset').onclick = () => run(async () => { if (!await ask({ title: 'Reset demo data?', text: 'Erases all demo data on this device.', ok: 'Reset', danger: true })) return false; await api.admin.resetDemo(); location.reload(); });
  },

  async audit(m) {
    const all = await api.admin.audit();
    const actions = [...new Set(all.map(r => r.action))].sort();
    m.innerHTML = h`<h1>Audit log</h1><p class="sub">Every staff action, newest first (latest 300).</p>
      <div class="search"><select class="input" id="af" style="max-width:240px" aria-label="Filter by action"><option value="">All actions</option>${actions.map(a => h`<option value="${a}">${ACTION_LABEL[a] || a}</option>`)}</select>
        <input class="input" id="aq" placeholder="Search actor, member or details…" aria-label="Search the audit log"><button class="btn btn-ghost" id="acsv">Export CSV</button></div>
      <div id="al"></div>`;
    let rows = all;
    const draw = () => {
      const a = $('#af').value, q = $('#aq').value.trim().toLowerCase();
      rows = all.filter(r => (!a || r.action === a) && (!q || [r.actorEmail, r.targetEmail, JSON.stringify(r.meta || {})].some(v => String(v || '').toLowerCase().includes(q))));
      $('#al').innerHTML = rows.length ? h`<div class="panel tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Member / target</th><th>Details</th></tr></thead><tbody>
        ${rows.map(r => h`<tr><td style="white-space:nowrap">${fmtDate(r.at)}</td><td>${r.actorEmail}</td><td><span class="tag">${ACTION_LABEL[r.action] || r.action}</span></td><td class="mono">${r.targetEmail || ''}</td><td class="mono">${JSON.stringify(r.meta || {}).slice(0, 160)}</td></tr>`)}</tbody></table></div>`
        : h`<div class="panel" style="text-align:center;color:var(--muted)">No entries match.</div>`;
    };
    $('#af').onchange = draw; $('#aq').oninput = debounce(draw, 200);
    $('#acsv').onclick = () => downloadCsv(`slc-audit-${new Date().toISOString().slice(0, 10)}.csv`, [['When', 'Actor', 'Action', 'Target', 'Details'], ...rows.map(r => [r.at, r.actorEmail, r.action, r.targetEmail, JSON.stringify(r.meta || {})])]);
    draw();
  }
};

