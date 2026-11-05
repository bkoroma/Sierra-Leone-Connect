// Admin + SuperAdmin consoles. Every action is also enforced server-side (RPC role checks / RLS);
// the UI only hides what a role can't do.
import { getApi } from './data/index.js';
import { $, $$, h, raw, esc, safeImg, ageOf, timeAgo, toast, debounce } from './util.js';
import { flagOf, intentById, DEFAULT_SETTINGS, INTENTS } from './constants.js';

const CONSOLE = document.body.dataset.console; // 'admin' | 'superadmin'
const bg = u => `background-image:url("${safeImg(u).replace(/["'()\\\s]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))}")`;
let api, session, tab;

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

const allowed = () => CONSOLE === 'superadmin' ? session.role === 'superadmin' : ['admin', 'superadmin'].includes(session.role);
const isSuper = () => session.role === 'superadmin';

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
    <p style="color:var(--muted)">You're signed in as ${session.email}, which isn't ${CONSOLE === 'superadmin' ? 'a SuperAdmin' : 'staff'}.</p>
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
    <div class="err" id="mfe"></div><button class="btn btn-primary btn-block">Verify</button></form></div>`;
  $('#mf').onsubmit = async e => {
    e.preventDefault();
    try { await api.mfa.verify(factorId, new FormData(e.target).get('code').trim()); session = await api.session(); shell(); }
    catch (x) { $('#mfe').textContent = x.message; }
  };
}

let stats = {};
async function shell() {
  const tabs = TABS.filter(t => !t.super || (isSuper() && CONSOLE === 'superadmin'));
  $('#root').innerHTML = h`<div class="cons"><aside class="side" aria-label="Console navigation">
      <span class="logo"><span class="logo-mark"></span>${CONSOLE === 'superadmin' ? 'SuperAdmin' : 'Admin'}</span>
      ${tabs.map((t, i) => h`${t.grp !== tabs[i - 1]?.grp ? h`<div class="grp">${t.grp.toUpperCase()}</div>` : ''}<button class="nv" data-tab="${t.id}">${t.label}${t.count ? h`<span class="badge hidden" data-count="${t.count}"></span>` : ''}</button>`)}
      <div class="who-box"><b>${session.email}</b><br><span class="status ${session.role}">${session.role}</span>
        <div style="display:grid;gap:6px;margin-top:10px">${isSuper() && CONSOLE === 'admin' ? h`<a class="btn btn-ghost btn-sm" href="superadmin.html">SuperAdmin console</a>` : ''}<a class="btn btn-ghost btn-sm" href="index.html">Open app</a><button class="btn btn-ghost btn-sm" id="out">Sign out</button></div></div>
    </aside><main class="main" id="main"></main></div>`;
  $('.side').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); };
  $('#out').onclick = async () => { await api.signOut(); location.reload(); };
  window.onhashchange = () => go(location.hash.slice(1) || 'overview', false);
  go(location.hash.slice(1) || 'overview', false);
}

async function refreshCounts() {
  try { stats = await api.admin.stats(); $$('[data-count]').forEach(b => { const n = stats[b.dataset.count] || 0; b.textContent = n; b.classList.toggle('hidden', !n); }); } catch (e) { if (/authori|log in|aal2|mfa/i.test(e.message)) location.reload(); }
}

async function go(t, push = true) {
  const def = TABS.find(x => x.id === t);
  if (!def || (def.super && !(isSuper() && CONSOLE === 'superadmin'))) t = 'overview';
  tab = t;
  if (push) history.replaceState(null, '', '#' + t);
  $$('.side [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false'));
  const m = $('#main'); m.innerHTML = '<div class="spinner"></div>';
  await refreshCounts();
  try { await VIEWS[t](m); } catch (e) { m.innerHTML = h`<div class="panel"><b>Error:</b> ${e.message}</div>`; }
}

const userCell = (p, email) => h`<div class="ucell"><div class="av-xs" style="${bg((p?.photos || [])[0])}"></div><div><b>${p?.name || '—'}${p?.verified ? ' ✓' : ''}</b><small>${email || ''}</small></div></div>`;
const act = async (fn, okMsg) => { try { await fn(); toast(okMsg); go(tab, false); } catch (e) { toast(e.message, 'error'); } };

function lineChart(days, series) {
  const W = 640, H = 190, P = 26, max = Math.max(1, ...series.flatMap(s => s.data));
  const x = i => P + i * (W - P * 2) / (days.length - 1), y = v => H - P - v / max * (H - P * 2);
  return h`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="14-day trend">
    ${[0, .5, 1].map(f => h`<line x1="${P}" x2="${W - P}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="rgba(255,255,255,.08)"/><text x="2" y="${y(max * f) + 3}">${Math.round(max * f)}</text>`)}
    ${series.map(s => h`<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" points="${s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`)}
    ${days.map((d, i) => i % 3 === 0 ? h`<text x="${x(i) - 12}" y="${H - 6}">${d.slice(5)}</text>` : '')}
  </svg><div class="row" style="flex:0;gap:14px;font-size:13px">${series.map(s => h`<span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${s.color}"></i> ${s.name}</span>`)}</div>`;
}
const bars = obj => { const e = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 10), m = Math.max(1, ...e.map(x => x[1])); return h`<div class="bars">${e.map(([k, v]) => h`<div><span>${k}</span><i style="width:${v / m * 100}%"></i><b>${v}</b></div>`)}</div>`; };

const VIEWS = {
  async overview(m) {
    const s = stats;
    m.innerHTML = h`<h1>Overview</h1><p class="sub">Community health at a glance.</p>
      <div class="kpis">
        <div class="kpi"><span>Members</span><b>${s.users}</b></div><div class="kpi"><span>Active 24h</span><b>${s.active24h}</b></div>
        <div class="kpi"><span>New today</span><b>${s.newToday}</b></div><div class="kpi"><span>Active matches</span><b>${s.matches}</b></div>
        <div class="kpi"><span>Messages</span><b>${s.messages}</b></div>
        <div class="kpi ${s.openReports ? 'alert' : ''}"><span>Open reports</span><b>${s.openReports}</b></div>
        <div class="kpi ${s.pendingVerifications ? 'alert' : ''}"><span>Pending verifications</span><b>${s.pendingVerifications}</b></div>
        <div class="kpi ${s.flagged ? 'alert' : ''}"><span>Scam Shield flags</span><b>${s.flagged}</b></div>
        <div class="kpi"><span>Banned</span><b>${s.banned}</b></div></div>
      <div class="panel"><h2>Moderator checklist</h2>
        <button class="list-btn" data-g="reports">Review open reports <span class="tag gold">${s.openReports}</span></button>
        <button class="list-btn" data-g="verify">Approve selfie verifications <span class="tag blue">${s.pendingVerifications}</span></button>
        <button class="list-btn" data-g="shield">Check Scam Shield flags <span class="tag gold">${s.flagged}</span></button></div>`;
    $$('[data-g]', m).forEach(b => b.onclick = () => go(b.dataset.g));
  },

  async reports(m, status = 'open') {
    const rs = await api.admin.reports(status);
    m.innerHTML = h`<h1>Reports</h1><p class="sub">Confidential member reports. Resolve every report within 24 hours.</p>
      <div class="chips" style="margin-bottom:14px" id="rf">${['open', 'actioned', 'dismissed', 'all'].map(x => h`<button class="chip" data-s="${x}" aria-pressed="${x === status}">${x}</button>`)}</div>
      ${rs.length ? rs.map(r => h`<div class="item"><div class="top">${userCell(r.subject, r.subject?.email)}<span><span class="tag gold">${r.reason}</span> <span class="status ${r.subject?.status}">${r.subject?.status}</span></span></div>
        ${r.details ? h`<q>${r.details}</q>` : ''}
        <small style="color:var(--muted)">Reported by ${r.reporter?.name || r.reporter?.email} · ${timeAgo(r.at)} ago${r.resolution ? ` · ${r.resolution}` : ''}</small>
        ${r.status === 'open' ? h`<div class="acts"><button class="btn btn-ghost btn-sm" data-r="${r.id}" data-a="dismiss">Dismiss</button><button class="btn btn-ghost btn-sm" data-r="${r.id}" data-a="warn">Warn</button><button class="btn btn-danger btn-sm" data-r="${r.id}" data-a="suspend">Suspend</button><button class="btn btn-danger btn-sm" data-r="${r.id}" data-a="ban">Ban</button></div>` : ''}</div>`)
        : h`<div class="panel" style="text-align:center;color:var(--muted)">Nothing here 🎉</div>`}`;
    $('#rf').onclick = e => { const b = e.target.closest('[data-s]'); if (b) VIEWS.reports(m, b.dataset.s); };
    $$('[data-r]', m).forEach(b => b.onclick = () => { if (['ban', 'suspend'].includes(b.dataset.a) && !confirm(`${b.dataset.a} this member?`)) return; act(() => api.admin.resolveReport(b.dataset.r, b.dataset.a), 'Report resolved'); });
  },

  async verify(m) {
    const vs = await api.admin.verifications();
    m.innerHTML = h`<h1>Verification</h1><p class="sub">Approve only if the selfie clearly shows the same person doing a thumbs-up.</p>
      ${vs.length ? vs.map(p => h`<div class="item"><div class="top">${userCell(p, p.email)}<span style="color:var(--muted);font-size:13px">${ageOf(p.dob) || ''} · ${flagOf(p.country)} ${p.city || ''}</span></div>
        <div class="verify-pair"><div style="${bg(p.verificationSelfie)}"><span class="tag gold">Selfie</span></div><div style="${bg((p.photos || [])[0])}"><span class="tag">Profile</span></div></div>
        <div class="acts"><button class="btn btn-primary btn-sm" data-v="${p.id}" data-ok="1">Approve ✓</button><button class="btn btn-danger btn-sm" data-v="${p.id}" data-ok="">Reject</button></div></div>`)
        : h`<div class="panel" style="text-align:center;color:var(--muted)">No pending verifications.</div>`}`;
    $$('[data-v]', m).forEach(b => b.onclick = () => act(() => api.admin.decideVerification(b.dataset.v, !!b.dataset.ok), b.dataset.ok ? 'Verified ✓' : 'Rejected'));
  },

  async shield(m) {
    const fs = await api.admin.flagged();
    m.innerHTML = h`<h1>Scam Shield</h1><p class="sub">Messages automatically flagged for money requests, payment apps, crypto, gift cards or off-platform contact.</p>
      ${fs.length ? fs.map(x => h`<div class="item"><div class="top">${userCell(null, x.sender?.email)}<span>${x.flagged.map(f => h`<span class="tag gold" style="margin-left:4px">${f}</span>`)}</span></div>
        <q>${x.body}</q><small style="color:var(--muted)">From ${x.sender?.name || 'member'} · ${timeAgo(x.at)} ago · <span class="status ${x.sender?.status}">${x.sender?.status}</span></small>
        <div class="acts"><button class="btn btn-ghost btn-sm" data-c="${x.id}">Looks fine</button><button class="btn btn-danger btn-sm" data-s="${x.sender?.id}" data-c2="${x.id}" data-st="suspended">Suspend sender</button><button class="btn btn-danger btn-sm" data-s="${x.sender?.id}" data-c2="${x.id}" data-st="banned">Ban sender</button></div></div>`)
        : h`<div class="panel" style="text-align:center;color:var(--muted)">No flagged messages.</div>`}`;
    $$('[data-c]', m).forEach(b => b.onclick = () => act(() => api.admin.clearFlag(b.dataset.c), 'Cleared'));
    $$('[data-s]', m).forEach(b => b.onclick = () => { if (!confirm('Apply to this sender?')) return; act(async () => { await api.admin.setStatus(b.dataset.s, b.dataset.st, 'Scam Shield'); await api.admin.clearFlag(b.dataset.c2); }, 'Done'); });
  },

  async members(m, q = '') {
    m.innerHTML = h`<h1>Members</h1><p class="sub">Search by name, email or city.</p>
      <div class="search"><input class="input" id="q" placeholder="Search members…" value="${q}" aria-label="Search members"></div><div id="ul"><div class="spinner"></div></div>`;
    const draw = async q => {
      const us = await api.admin.users(q);
      $('#ul').innerHTML = h`<div class="panel tbl-wrap"><table class="tbl"><thead><tr><th>Member</th><th>Location</th><th>Joined</th><th>Status</th><th></th></tr></thead><tbody>
        ${us.map(u => h`<tr><td>${userCell(u.profile, u.email)}</td><td>${u.profile?.city ? h`${flagOf(u.profile.country)} ${u.profile.city}` : '—'}</td><td>${timeAgo(u.createdAt)}</td>
          <td><span class="status ${u.status}">${u.status}</span>${u.role !== 'user' ? h` <span class="status ${u.role}">${u.role}</span>` : ''}</td>
          <td style="white-space:nowrap">${u.id === session.id ? '' : u.status === 'active'
            ? h`<button class="btn btn-ghost btn-sm" data-u="${u.id}" data-st="suspended">Suspend</button> <button class="btn btn-danger btn-sm" data-u="${u.id}" data-st="banned">Ban</button>`
            : h`<button class="btn btn-ghost btn-sm" data-u="${u.id}" data-st="active">Reinstate</button>`}</td></tr>`)}</tbody></table></div>`;
      $$('[data-u]', $('#ul')).forEach(b => b.onclick = async () => {
        const reason = b.dataset.st === 'active' ? '' : prompt('Reason (shown to the member):', 'Violation of community guidelines');
        if (reason === null) return;
        try { await api.admin.setStatus(b.dataset.u, b.dataset.st, reason); toast('Updated'); draw($('#q').value); refreshCounts(); } catch (e) { toast(e.message, 'error'); }
      });
    };
    $('#q').oninput = debounce(e => draw(e.target.value), 300);
    draw(q);
  },

  async analytics(m) {
    const a = await api.admin.analytics();
    m.innerHTML = h`<h1>Analytics</h1><p class="sub">Last 14 days.</p>
      <div class="panel"><h2>Growth & engagement</h2>${lineChart(a.days, [{ name: 'Matches', data: a.matches, color: '#1EB53A' }, { name: 'Sign-ups', data: a.signups, color: '#3B9BEA' }, { name: 'Messages', data: a.messages, color: '#F5B82E' }])}</div>
      <div class="grid-2"><div class="panel"><h2>Where members live</h2>${bars(Object.fromEntries(Object.entries(a.byCountry).map(([k, v]) => [flagOf(k) + ' ' + k, v])))}</div>
      <div class="panel"><h2>Relationship goals</h2>${bars(Object.fromEntries(Object.entries(a.byIntent).map(([k, v]) => [intentById(k).label, v])))}</div></div>`;
  },

  async staff(m) {
    const us = (await api.admin.users('')).filter(u => u.role !== 'user');
    m.innerHTML = h`<h1>Staff & roles</h1><p class="sub">Admins moderate; SuperAdmins also manage staff, settings and see the audit log.</p>
      <div class="panel tbl-wrap"><table class="tbl"><thead><tr><th>Staff</th><th>Role</th><th></th></tr></thead><tbody>
        ${us.map(u => h`<tr><td>${userCell(u.profile, u.email)}</td><td><span class="status ${u.role}">${u.role}</span></td><td>${u.id === session.id ? h`<small style="color:var(--muted)">you</small>` : h`<button class="btn btn-ghost btn-sm" data-id="${u.id}" data-role="user">Remove staff</button> ${u.role === 'admin' ? h`<button class="btn btn-ghost btn-sm" data-id="${u.id}" data-role="superadmin">Make SuperAdmin</button>` : h`<button class="btn btn-ghost btn-sm" data-id="${u.id}" data-role="admin">Make Admin</button>`}`}</td></tr>`)}</tbody></table></div>
      <div class="panel"><h2>Promote a member</h2><div class="search"><input class="input" id="pq" placeholder="Search by email or name"></div><div id="pr"></div></div>`;
    const bind = root => $$('[data-role]', root).forEach(b => b.onclick = () => { if (!confirm(`Set role to ${b.dataset.role}?`)) return; act(() => api.admin.setRole(b.dataset.id, b.dataset.role), 'Role updated'); });
    bind(m);
    $('#pq').oninput = debounce(async e => {
      const q = e.target.value.trim(); if (q.length < 2) return $('#pr').innerHTML = '';
      const r = (await api.admin.users(q)).filter(u => u.role === 'user').slice(0, 8);
      $('#pr').innerHTML = h`${r.map(u => h`<div class="list-btn">${userCell(u.profile, u.email)}<button class="btn btn-ghost btn-sm" data-id="${u.id}" data-role="admin">Make Admin</button></div>`)}`;
      bind($('#pr'));
    }, 300);
  },

  async settings(m) {
    const s = { ...DEFAULT_SETTINGS, ...(await api.settings()) };
    const num = (k, label, hint) => h`<label class="field"><span>${label}</span><input class="input" type="number" min="0" max="1000" data-k="${k}" value="${s[k]}"><small style="color:var(--dim)">${hint}</small></label>`;
    const tog = (k, label, hint) => h`<label class="switch-row"><span>${label}<small>${hint}</small></span><span class="toggle"><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}><span></span></span></label>`;
    m.innerHTML = h`<h1>App settings</h1><p class="sub">Changes apply to everyone immediately.</p>
      <div class="panel"><h2>Discovery limits</h2><div class="set-grid">${num('dailyLikes', 'Daily likes per member', 'Keeps likes meaningful and reduces spam.')}${num('dailySuperLikes', 'Daily Oya! super likes', 'Super likes jump the queue.')}${num('minAge', 'Minimum age', 'Never below 18.')}</div></div>
      <div class="panel"><h2>Safety & features</h2>${tog('scamShield', 'Scam Shield', 'Flag money requests, payment apps and off-platform contact in chat.')}${tog('undoEnabled', 'Undo last swipe', 'Let members bring back their last swipe.')}${tog('requireAdminMfa', 'Require 2FA for staff', 'Authenticator app required for consoles (live mode).')}${tog('maintenance', 'Maintenance mode', 'Members see a "be right back" screen. Staff can still sign in.')}</div>
      <div class="panel"><h2>Announcement banner</h2><label class="field"><span>Shown at the top of Discover (leave empty to hide)</span><input class="input" data-k="announcement" maxlength="280" value="${s.announcement}"></label></div>
      <button class="btn btn-primary" id="save">Save settings</button>
      ${api.mode === 'demo' ? h`<button class="btn btn-danger" id="reset" style="margin-left:10px">Reset demo data</button>` : ''}`;
    $('#save').onclick = () => {
      const out = {};
      $$('[data-k]', m).forEach(i => out[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value);
      act(() => api.admin.saveSettings(out), 'Settings saved');
    };
    if ($('#reset')) $('#reset').onclick = async () => { if (confirm('Erase all demo data on this device?')) { await api.admin.resetDemo(); location.reload(); } };
  },

  async audit(m) {
    const rows = await api.admin.audit();
    m.innerHTML = h`<h1>Audit log</h1><p class="sub">Every staff action, newest first.</p>
      <div class="panel tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>
      ${rows.map(r => h`<tr><td style="white-space:nowrap">${new Date(r.at).toLocaleString()}</td><td>${r.actorEmail}</td><td><span class="tag">${r.action}</span></td><td class="mono">${r.targetEmail || ''}</td><td class="mono">${JSON.stringify(r.meta || {}).slice(0, 140)}</td></tr>`)}</tbody></table></div>`;
  }
};
