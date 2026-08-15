/* ============================================================
   adminpage.js — the dedicated admin page.

   One card per client company, answering the questions staff actually
   ask: has this client been given access, have they USED it, which
   plans are theirs, and how do I fix their password — with a one-click
   jump into any of their floor plans. Sign-in activity comes from the
   admin-clients edge function (service role), because the client can't
   read auth data — and shouldn't.

   Like the in-studio panel, this page only hides what the database
   would refuse anyway; RLS and the edge function re-check everything.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const STAFF_ROLES = [
    ['crew', 'Crew'], ['sales', 'Sales'], ['planner', 'Planner'], ['admin', 'Admin'],
  ];

  let sb, clients = [], shows = [], clientUsers = [], staff = [], logins = {}, presence = [];

  const msg = (t, cls) => { const m = $('pageMsg'); m.textContent = t || ''; m.className = cls || ''; };

  /** "3 hours ago" — precise enough for "are they using it?". */
  function ago(iso) {
    if (!iso) return null;
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 90) return 'just now';
    if (s < 5400) return `${Math.round(s / 60)} min ago`;
    if (s < 129600) return `${Math.round(s / 3600)} hour${Math.round(s / 3600) === 1 ? '' : 's'} ago`;
    const d = Math.round(s / 86400);
    return d < 45 ? `${d} day${d === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString();
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    document.documentElement.dataset.theme = FP.prefs?.theme || 'light';
    await FP.auth.init();
    if (!FP.auth.signedIn()) return location.replace('login.html');
    if (!FP.auth.canEdit()) {
      $('content').innerHTML = `<div class="empty-note">Only Source One staff can open the
        admin page. You are signed in as <b>${esc(FP.auth.role() || 'client')}</b>.</div>`;
      return;
    }
    sb = FP.auth.client();
    $('who').textContent = FP.auth.profile()?.email || '';
    $('btnHome').onclick = () => (location.href = 'home.html');
    $('btnOut').onclick = async () => { await FP.auth.signOut(); location.replace('login.html'); };
    await load();
    render();

    /* the heartbeat board refreshes itself — presence only, so the rest
       of the page never repaints under the user's cursor */
    setInterval(async () => {
      const { data } = await sb.from('presence').select('*').order('last_seen', { ascending: false });
      presence = data || [];
      const live = $('liveNow');
      if (live) live.outerHTML = liveSection();
    }, 30_000);
  }

  async function load() {
    const [cl, sh, cu, st, lg, pr] = await Promise.all([
      sb.from('client').select('id, name, contact_name, contact_email, portal_token, active, created_at')
        .order('created_at'),
      sb.from('show').select('id, name, client_id, is_template, freeze_date').order('created_at', { ascending: false }),
      sb.from('profile').select('id, email, full_name, client_id, active').eq('role', 'client'),
      /* planners can't read other staff profiles (admin-only RLS) — the
         team table simply stays empty for them */
      sb.from('profile').select('id, email, full_name, role, active').neq('role', 'client').order('email'),
      FP.auth.callFn('admin-clients', { action: 'list-logins' }),
      sb.from('presence').select('*').order('last_seen', { ascending: false }),
    ]);
    presence = pr.data || [];
    clients = cl.data || [];
    shows = (sh.data || []).filter((s) => !s.is_template);
    clientUsers = cu.data || [];
    staff = st.data || [];
    logins = {};
    (lg.users || []).forEach((u) => (logins[u.id] = u));
  }

  /* The heartbeat board: who's in the app right now, and what they're
     doing. "Online" is a heartbeat in the last 3 minutes; recent
     activity stays listed for an hour so a just-left session is still
     answerable ("was the client in today?"). */
  function liveSection() {
    const now = Date.now();
    const rows = presence.filter((p) => now - Date.parse(p.last_seen) < 3600_000);
    const dot = (p) => now - Date.parse(p.last_seen) < 180_000
      ? '<span style="color:#16a34a">●</span>' : '<span style="color:var(--tx-3)">○</span>';
    const doing = (p) => {
      const page = { index: 'in the Studio', home: 'on the dashboard',
                     admin: 'on this admin page', portal: 'in the portal' }[p.page] || p.page;
      return p.plan_name ? `${page} — <b>${esc(p.plan_name)}</b>` : page;
    };
    return `<div id="liveNow">
      <h2 class="sec" style="margin-top:0">Live now
        <span>heartbeat every minute · refreshes itself</span></h2>
      ${rows.length ? `<table class="team"><thead><tr>
          <th></th><th>Who</th><th>Role</th><th>Where</th><th>Last heartbeat</th>
        </tr></thead><tbody>${rows.map((p) => `
          <tr>
            <td>${dot(p)}</td>
            <td>${esc(p.email || '—')}</td>
            <td>${esc(p.role || '—')}</td>
            <td>${doing(p)}</td>
            <td class="muted">${esc(ago(p.last_seen) || '—')}</td>
          </tr>`).join('')}</tbody></table>`
        : '<div class="empty-note">Nobody has been in during the last hour.</div>'}
    </div>`;
  }

  /* ---------------- render ---------------- */
  function render() {
    const isAdmin = FP.auth.isAdmin();
    let h = liveSection();
    h += `<h2 class="sec">Clients <span>${clients.length} compan${clients.length === 1 ? 'y' : 'ies'}</span></h2>`;
    h += clients.map(clientCard).join('') || '<div class="empty-note">No clients yet — add the first one below.</div>';

    h += `<form class="newform" id="newClient" style="margin-top:16px">
      <input class="inp" id="ncName" placeholder="New client company name" required />
      <input class="inp" id="ncEmail" type="email" placeholder="Contact email (optional)" />
      <button class="btn primary">Add client</button>
    </form>`;

    h += `<h2 class="sec">Team <span>Source One staff accounts</span></h2>`;
    if (staff.length) {
      h += `<table class="team"><thead><tr>
        <th>Email</th><th>Name</th><th>Role</th><th>Last sign-in</th><th>Active</th>
      </tr></thead><tbody>${staff.map((p) => `
        <tr>
          <td>${esc(p.email)}</td>
          <td>${esc(p.full_name || '—')}</td>
          <td>${isAdmin
            ? `<select class="inp" style="padding:5px 8px;font-size:12.5px" data-role="${esc(p.id)}">
                ${STAFF_ROLES.map(([v, l]) =>
                  `<option value="${v}"${p.role === v ? ' selected' : ''}>${l}</option>`).join('')}
              </select>`
            : esc(p.role)}</td>
          <td class="muted">${ago(logins[p.id]?.last_sign_in_at) || 'never'}</td>
          <td>${isAdmin
            ? `<input type="checkbox" data-active="${esc(p.id)}" ${p.active ? 'checked' : ''}/>`
            : (p.active ? 'yes' : 'no')}</td>
        </tr>`).join('')}</tbody></table>`;
    } else {
      h += `<div class="empty-note">Team management is admin-only — planners see clients above.</div>`;
    }

    if (isAdmin) {
      h += `<form class="newform" id="newStaff" style="margin-top:14px; grid-template-columns: 1.2fr 1fr 1fr auto auto">
        <input class="inp" id="nsEmail" type="email" placeholder="teammate@sourceoneevents.com" required />
        <input class="inp" id="nsName" placeholder="Full name" />
        <input class="inp" id="nsPw" placeholder="Password (8+ chars)" minlength="8" required />
        <select class="inp" id="nsRole">${STAFF_ROLES.map(([v, l]) =>
          `<option value="${v}"${v === 'planner' ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn primary">Add teammate</button>
      </form>`;
    }

    $('content').innerHTML = h;
    wire();
  }

  function clientCard(c) {
    const login = clientUsers.find((u) => u.client_id === c.id);
    const auth = login && logins[login.id];
    const myShows = shows.filter((s) => s.client_id === c.id);
    const link = `${location.origin}/login.html?c=${c.portal_token}`;

    /* the status the user actually cares about, as one chip */
    let status;
    if (!c.active) status = '<span class="chip err">Deactivated</span>';
    else if (!login) status = '<span class="chip mute">No login yet — set a password</span>';
    else if (!auth?.last_sign_in_at) status = '<span class="chip warn">Link sent — not used yet</span>';
    else status = `<span class="chip ok">Signed in ${esc(ago(auth.last_sign_in_at))}</span>`;

    return `<div class="ccard" data-client="${esc(c.id)}">
      <div class="ccard-head">
        <h3>${esc(c.name)}</h3>
        ${status}
        <div style="flex:1"></div>
        ${myShows.length
          ? `<button class="btn soft" data-goplan="${esc(myShows[0].id)}">Open floor plan${myShows.length > 1 ? 's' : ''}</button>`
          : '<span class="muted" style="font-size:12.5px">no plan assigned yet</span>'}
      </div>

      <div class="rowline">
        <label>Their link</label>
        <input class="inp" readonly value="${esc(link)}" />
        <button class="mini" data-copy="${esc(link)}">Copy</button>
      </div>
      <div class="rowline">
        <label>Password</label>
        <input class="inp" type="text" autocomplete="off" data-pw="${esc(c.id)}"
               placeholder="${login ? 'Type a new password to reset it (8+ chars)' : 'Set the access password (activates the link)'}" />
        <button class="mini" data-pwsave="${esc(c.id)}">${login ? 'Reset' : 'Set'}</button>
      </div>

      <div class="plans">
        ${myShows.map((s) => `<span class="plan-chip" data-goplan="${esc(s.id)}"
            title="Open this plan in the Studio">${esc(s.name)}
            <span class="x" data-unassign="${esc(s.id)}" title="Unassign from ${esc(c.name)}">✕</span></span>`).join('')}
        <select class="inp" style="width:auto;padding:6px 9px;font-size:12.5px" data-assignsel="${esc(c.id)}">
          <option value="">Assign a plan…</option>
          ${shows.filter((s) => !s.client_id).map((s) =>
            `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}
        </select>
      </div>
    </div>`;
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    const c = $('content');

    c.querySelectorAll('[data-goplan]').forEach((b) => b.addEventListener('click', (e) => {
      if (e.target.closest('[data-unassign]')) return;   /* the ✕ is not a navigation */
      FP.setPref('store', 'supabase');
      location.href = `index.html?plan=${encodeURIComponent(b.dataset.goplan)}`;
    }));

    c.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); msg('Link copied.', 'ok'); }
      catch { msg('Select the link and press ⌘C.', 'err'); }
    }));

    c.querySelectorAll('[data-pwsave]').forEach((b) => b.addEventListener('click', async () => {
      const cid = b.dataset.pwsave;
      const input = c.querySelector(`[data-pw="${CSS.escape(cid)}"]`);
      const password = (input.value || '').trim();
      if (password.length < 8) return msg('Password needs at least 8 characters.', 'err');
      const login = clientUsers.find((u) => u.client_id === cid);
      msg('Saving…');
      const res = login
        ? await FP.auth.callFn('admin-clients', { action: 'set-password', email: login.email, password })
        : await FP.auth.callFn('admin-clients', { action: 'create-client-user', client_id: cid, password });
      if (res.error) return msg(res.error, 'err');
      input.value = '';
      msg('Saved — send the client their link and this password.', 'ok');
      await load(); render();
    }));

    c.querySelectorAll('[data-assignsel]').forEach((sel) => sel.addEventListener('change', async () => {
      if (!sel.value) return;
      const { error } = await sb.from('show')
        .update({ client_id: sel.dataset.assignsel }).eq('id', sel.value);
      if (error) return msg(error.message, 'err');
      msg('Plan assigned.', 'ok');
      await load(); render();
    }));

    c.querySelectorAll('[data-unassign]').forEach((x) => x.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { error } = await sb.from('show').update({ client_id: null }).eq('id', x.dataset.unassign);
      if (error) return msg(error.message, 'err');
      msg('Plan unassigned.', 'ok');
      await load(); render();
    }));

    $('newClient')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('ncName').value.trim();
      if (!name) return;
      msg('Creating client…');
      const { error } = await sb.from('client').insert({
        name, contact_email: $('ncEmail').value.trim() || null,
        created_by: FP.auth.user()?.id || null,
      });
      if (error) return msg(error.message, 'err');
      msg('Client added — set their password to activate the link.', 'ok');
      await load(); render();
    });

    c.querySelectorAll('[data-role]').forEach((sel) => sel.addEventListener('change', async () => {
      const { error } = await sb.from('profile')
        .update({ role: sel.value }).eq('id', sel.dataset.role);
      if (error) { msg(error.message, 'err'); await load(); render(); return; }
      msg('Role updated.', 'ok');
    }));

    c.querySelectorAll('[data-active]').forEach((cb) => cb.addEventListener('change', async () => {
      const { error } = await sb.from('profile')
        .update({ active: cb.checked }).eq('id', cb.dataset.active);
      if (error) { msg(error.message, 'err'); await load(); render(); return; }
      msg(cb.checked ? 'Account reactivated.' : 'Account deactivated.', 'ok');
    }));

    $('newStaff')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg('Creating account…');
      const res = await FP.auth.callFn('admin-clients', {
        action: 'create-staff-user',
        email: $('nsEmail').value.trim(),
        full_name: $('nsName').value.trim() || null,
        password: $('nsPw').value,
        role: $('nsRole').value,
      });
      if (res.error) return msg(res.error, 'err');
      msg('Teammate added — send them their email and password.', 'ok');
      await load(); render();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();
})(window);
