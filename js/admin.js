/* ============================================================
   admin.js — the internal panel: client tenants, and team access.

   Deliberately thin, because the rules it enforces are not enforced here:

     · who may read these lists     -> RLS (client_staff_read, profile_self_read)
     · who may change a role        -> RLS (profile_admin_write)
     · who a client user can see    -> RLS (show_client_read, element_client_*)
     · account creation / links     -> admin-clients edge function,
                                       which re-checks the caller is staff
     · you cannot remove the last   -> trigger (private.guard_last_admin)
       active admin

   This file only hides controls the database would refuse anyway. If
   someone bypasses the UI and posts to the REST endpoint, every one of
   those rules still holds.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Mirrors the app_role enum. Ordered least to most privileged so the
     select reads as a ladder. */
  const ROLES = [
    ['exhibitor', 'Exhibitor', 'Sees only their own booth'],
    ['client',    'Client',    'Sees and edits only their company’s plans'],
    ['crew',      'Crew',      'Read-only access to the whole floor'],
    ['sales',     'Sales',     'Read-only, plus exhibitor records'],
    ['planner',   'Planner',   'Can create and edit plans'],
    ['admin',     'Admin',     'Everything, including this panel'],
  ];

  /* ============================================================
     Modal shell — two tabs. Clients is the working surface; Team
     is occasional, so it comes second.
     ============================================================ */
  FP.adminModal = async () => {
    if (!FP.auth?.canEdit?.()) {
      const signedIn = FP.auth?.signedIn?.();
      const role = FP.auth?.role?.();
      FP.modal({
        title: 'Admin',
        body: `<p class="helptext">${signedIn
          ? `Only staff can manage clients and accounts. You are signed in as <b>${esc(role || 'crew')}</b>.`
          : 'Sign in with a staff account to manage clients and team access.'}</p>`,
        foot: '<button class="btn primary" data-close>Close</button>',
        onMount: (_b, f) => (f.querySelector('[data-close]').onclick = FP.closeModal),
      });
      return;
    }

    FP.modal({
      title: 'Admin',
      wide: true,
      body: `
        <div class="adm-tabs">
          <button class="mini on" data-atab="clients">Clients</button>
          <button class="mini" data-atab="team">Team &amp; access</button>
        </div>
        <div id="admBody"><div class="helptext">Loading…</div></div>`,
      foot: '<button class="btn primary" data-close>Done</button>',
      onMount: (b, f) => {
        f.querySelector('[data-close]').onclick = FP.closeModal;
        b.querySelectorAll('[data-atab]').forEach((btn) =>
          btn.addEventListener('click', () => {
            b.querySelectorAll('[data-atab]').forEach((x) => x.classList.toggle('on', x === btn));
            btn.dataset.atab === 'team' ? paintTeam() : paintClients();
          }));
      },
    });

    await paintClients();
  };

  function msg(text, bad) {
    const m = $('admMsg');
    if (!m) return;
    m.textContent = text;
    m.style.color = bad ? 'var(--err)' : 'var(--ok)';
  }

  /* ============================================================
     CLIENTS — tenants. Each client company gets its own plans and
     its own logins, isolated by RLS.
     ============================================================ */
  async function fetchClientData() {
    const sb = FP.auth.client();
    if (!sb) return { error: 'Not connected' };
    const [cl, sh, pr] = await Promise.all([
      sb.from('client').select('id, name, contact_name, contact_email, active, created_at')
        .order('created_at', { ascending: true }),
      sb.from('show').select('id, name, client_id').order('created_at', { ascending: false }),
      /* Planner sessions cannot read other profiles (admin-only RLS);
         the roster section simply stays empty for them. */
      sb.from('profile').select('id, email, full_name, role, active, client_id').eq('role', 'client'),
    ]);
    if (cl.error) return { error: cl.error.message };
    return {
      clients: cl.data || [],
      shows: sh.data || [],
      users: pr.error ? [] : (pr.data || []),
    };
  }

  async function paintClients() {
    const body = $('admBody');
    if (!body) return;
    body.innerHTML = '<div class="helptext">Loading clients…</div>';

    const { clients, shows, users, error } = await fetchClientData();
    if (error) {
      body.innerHTML = `<p class="helptext" style="color:var(--err)">${esc(error)}</p>`;
      return;
    }

    const open = paintClients._open || {};

    body.innerHTML = `
      <p class="helptext">
        Each client is an isolated workspace: their logins see and edit
        <b>only</b> the plans assigned to them — enforced by the database,
        not by this screen.
      </p>

      <form id="newClient" class="adm-newrow">
        <input class="inp" id="ncName" placeholder="New client company name" required />
        <input class="inp" id="ncEmail" placeholder="Contact email (optional)" type="email" />
        <button class="btn primary" type="submit">Add client</button>
      </form>

      <div id="clientList">
        ${clients.length ? clients.map((c) => clientHtml(c, shows, users, !!open[c.id])).join('')
          : '<p class="helptext">No clients yet — add the first one above.</p>'}
      </div>

      <div id="admMsg" class="helptext" style="margin-top:8px"></div>`;

    wireClients(clients);
  }

  function clientHtml(c, shows, users, isOpen) {
    const mine = shows.filter((s) => s.client_id === c.id);
    const free = shows.filter((s) => !s.client_id);
    const roster = users.filter((u) => u.client_id === c.id);

    return `<div class="client-card${c.active ? '' : ' off'}" data-cid="${esc(c.id)}">
      <button class="client-head" data-open="${esc(c.id)}">
        <b>${esc(c.name)}</b>
        <span class="client-meta">${mine.length} plan${mine.length === 1 ? '' : 's'} ·
          ${roster.length} login${roster.length === 1 ? '' : 's'}</span>
        <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;transform:rotate(${isOpen ? 90 : 0}deg)"><path d="m9 6 6 6-6 6"/></svg>
      </button>

      ${isOpen ? `<div class="client-body">
        <div class="grp">
          <h4 class="grp-title">Plans</h4>
          ${mine.map((s) => `<div class="kv"><span>${esc(s.name)}</span>
             <button class="mini" data-unassign="${esc(s.id)}">Unassign</button></div>`).join('')
           || '<p class="helptext" style="margin:0">No plans assigned yet.</p>'}
          ${free.length ? `<div class="adm-newrow" style="margin-top:8px">
            <select class="inp" data-assign-sel="${esc(c.id)}">
              ${free.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}
            </select>
            <button class="mini" data-assign="${esc(c.id)}">Assign plan</button>
          </div>` : ''}
        </div>

        <div class="grp">
          <h4 class="grp-title">Client logins</h4>
          ${roster.map((u) => `<div class="kv">
              <span>${esc(u.full_name || u.email)}<br><small style="color:var(--tx-3)">${esc(u.email)}</small></span>
              <span style="display:flex;gap:6px">
                <button class="mini" data-link="${esc(u.email)}">One-time link</button>
                <button class="mini" data-pass="${esc(u.email)}">Set password</button>
              </span>
            </div>`).join('') || '<p class="helptext" style="margin:0">No logins yet.</p>'}

          <form class="adm-newrow" data-newuser="${esc(c.id)}" style="margin-top:8px">
            <input class="inp" name="name" placeholder="Name" autocomplete="off" />
            <input class="inp" name="email" placeholder="Email" type="email" required autocomplete="off" />
            <input class="inp" name="password" placeholder="Password (min 8)" type="text"
                   required minlength="8" autocomplete="off" />
            <button class="mini" type="submit">Create login</button>
          </form>
          <div class="adm-linkout" data-linkout="${esc(c.id)}" hidden>
            <input class="inp" readonly aria-label="One-time sign-in link" />
            <button class="mini" data-copylink>Copy</button>
          </div>
        </div>
      </div>` : ''}
    </div>`;
  }

  function wireClients(clients) {
    const sb = FP.auth.client();
    const body = $('admBody');
    const openMap = (paintClients._open = paintClients._open || {});

    $('newClient')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('ncName').value.trim();
      if (!name) return;
      msg('Creating client…');
      const { error } = await sb.from('client').insert({
        name,
        contact_email: $('ncEmail').value.trim() || null,
        created_by: FP.auth.user()?.id || null,
      });
      if (error) return msg(error.message, true);
      msg('Client added.');
      await paintClients();
    });

    body.querySelectorAll('[data-open]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = btn.dataset.open;
        openMap[id] = !openMap[id];
        await paintClients();
      }));

    body.querySelectorAll('[data-assign]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const cid = btn.dataset.assign;
        const sel = body.querySelector(`[data-assign-sel="${CSS.escape(cid)}"]`);
        if (!sel?.value) return;
        msg('Assigning…');
        const { error } = await sb.from('show').update({ client_id: cid }).eq('id', sel.value);
        if (error) return msg(error.message, true);
        msg('Plan assigned.');
        await paintClients();
      }));

    body.querySelectorAll('[data-unassign]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        msg('Unassigning…');
        const { error } = await sb.from('show').update({ client_id: null }).eq('id', btn.dataset.unassign);
        if (error) return msg(error.message, true);
        msg('Plan unassigned.');
        await paintClients();
      }));

    body.querySelectorAll('[data-newuser]').forEach((form) =>
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        msg('Creating login…');
        const res = await FP.auth.callFn('admin-clients', {
          action: 'create-client-user',
          client_id: form.dataset.newuser,
          email: String(f.get('email') || '').trim(),
          password: String(f.get('password') || ''),
          full_name: String(f.get('name') || '').trim() || null,
        });
        if (res.error) return msg(res.error, true);
        msg('Login created — you can now issue a one-time link.');
        await paintClients();
      }));

    body.querySelectorAll('[data-link]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        msg('Generating one-time link…');
        const res = await FP.auth.callFn('admin-clients', {
          action: 'login-link',
          email: btn.dataset.link,
          /* clients land on the dashboard, not the raw editor */
          redirect_to: location.origin + '/home.html',
        });
        if (res.error) return msg(res.error, true);
        const card = btn.closest('.client-card');
        const out = card?.querySelector('[data-linkout]');
        if (out) {
          out.hidden = false;
          out.querySelector('input').value = res.link || '';
          out.querySelector('[data-copylink]').onclick = async () => {
            try {
              await navigator.clipboard.writeText(res.link || '');
              msg('Link copied — send it to the client. It signs them in once.');
            } catch {
              out.querySelector('input').select();
              msg('Press ⌘C to copy the selected link.');
            }
          };
        }
        msg('One-time link ready below — it signs the client straight in.');
      }));

    body.querySelectorAll('[data-pass]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const password = prompt(`New password for ${btn.dataset.pass} (min 8 characters):`);
        if (password == null) return;
        msg('Setting password…');
        const res = await FP.auth.callFn('admin-clients', {
          action: 'set-password', email: btn.dataset.pass, password,
        });
        if (res.error) return msg(res.error, true);
        msg('Password updated.');
      }));

    void clients;
  }

  /* ============================================================
     TEAM — unchanged behaviour, now living in a tab.
     ============================================================ */
  async function fetchProfiles() {
    const sb = FP.auth.client();
    if (!sb) return { error: 'Not connected' };
    const { data, error } = await sb
      .from('profile')
      .select('id, email, full_name, role, active, created_at')
      .order('created_at', { ascending: true });
    return error ? { error: error.message } : { rows: data || [] };
  }

  function rowHtml(p, meId, activeAdmins) {
    const isMe = p.id === meId;
    /* The trigger refuses this too — disabling it here just avoids
       offering an action that is guaranteed to fail. */
    const lastAdmin = p.role === 'admin' && p.active && activeAdmins <= 1;

    return `<div class="team-row${p.active ? '' : ' off'}" data-id="${esc(p.id)}">
      <div class="team-who">
        <b>${esc(p.full_name || p.email.split('@')[0])}${isMe ? ' <span class="you">you</span>' : ''}</b>
        <span>${esc(p.email)}</span>
      </div>
      <select class="inp team-role" data-role-for="${esc(p.id)}" ${lastAdmin ? 'disabled' : ''}>
        ${ROLES.map(([v, label]) =>
          `<option value="${v}"${v === p.role ? ' selected' : ''}>${esc(label)}</option>`).join('')}
      </select>
      <button class="mini team-active" data-toggle="${esc(p.id)}"
        ${lastAdmin ? 'disabled' : ''}
        title="${p.active ? 'Deactivate this account' : 'Reactivate this account'}">
        ${p.active ? 'Active' : 'Disabled'}
      </button>
    </div>`;
  }

  async function paintTeam() {
    const body = $('admBody');
    if (!body) return;

    if (!FP.auth?.isAdmin?.()) {
      body.innerHTML = `<p class="helptext">Only an admin can manage team roles.
        You are signed in as <b>${esc(FP.auth?.role?.() || 'crew')}</b>.</p>`;
      return;
    }

    const { rows, error } = await fetchProfiles();
    if (error) {
      body.innerHTML = `<p class="helptext" style="color:var(--err)">${esc(error)}</p>`;
      return;
    }

    const meId = FP.auth.user()?.id;
    const activeAdmins = rows.filter((p) => p.role === 'admin' && p.active).length;

    body.innerHTML = `
      <p class="helptext">
        New accounts start as <b>Crew</b> — read-only. Promote deliberately.
        Roles are enforced by the database, so changing one here changes what
        that person can do everywhere, including outside this app.
      </p>

      <div class="team-head">
        <span>Account</span><span>Role</span><span>Status</span>
      </div>
      <div id="teamList">${rows.map((p) => rowHtml(p, meId, activeAdmins)).join('')}</div>

      <div class="grp" style="margin-top:16px">
        <h4 class="grp-title">What each role can do</h4>
        ${ROLES.map(([, label, note]) =>
          `<div class="kv"><span>${esc(label)}</span><span style="font-family:var(--font)">${esc(note)}</span></div>`).join('')}
      </div>

      <div id="admMsg" class="helptext" style="margin-top:8px"></div>`;

    wireTeam();
  }

  function wireTeam() {
    const sb = FP.auth.client();

    document.querySelectorAll('[data-role-for]').forEach((sel) =>
      sel.addEventListener('change', async () => {
        const id = sel.dataset.roleFor;
        const role = sel.value;
        msg('Saving…');
        const { error } = await sb.from('profile').update({ role }).eq('id', id);
        if (error) {
          msg(error.message, true);
          await paintTeam();               /* snap the control back to the truth */
          return;
        }
        msg('Role updated.');
        /* Demoting yourself changes what you may do next, so re-read the
           session's own profile before repainting. */
        await paintTeam();
        FP.syncAccountBadge?.();
      }));

    document.querySelectorAll('[data-toggle]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = btn.dataset.toggle;
        const turningOn = btn.textContent.trim() === 'Disabled';
        msg('Saving…');
        const { error } = await sb.from('profile').update({ active: turningOn }).eq('id', id);
        if (error) { msg(error.message, true); await paintTeam(); return; }
        msg(turningOn ? 'Account reactivated.' : 'Account disabled.');
        await paintTeam();
      }));
  }
})(window);
