/* ============================================================
   admin.js — team and access.

   Lets an admin see every account and change its role. Deliberately thin,
   because the rules it enforces are not enforced here:

     · who may read this list      -> RLS (profile_self_read)
     · who may change a role       -> RLS (profile_admin_write)
     · you cannot remove the last  -> trigger (private.guard_last_admin)
       active admin

   This file only hides controls the database would refuse anyway, so a
   user never clicks something destined to fail. If someone bypasses the
   UI entirely and posts to the REST endpoint, every one of those rules
   still holds.
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
    ['crew',      'Crew',      'Read-only access to the whole floor'],
    ['sales',     'Sales',     'Read-only, plus exhibitor records'],
    ['planner',   'Planner',   'Can create and edit plans'],
    ['admin',     'Admin',     'Everything, including this panel'],
  ];

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

  FP.adminModal = async () => {
    if (!FP.auth?.isAdmin?.()) {
      const signedIn = FP.auth?.signedIn?.();
      const role = FP.auth?.role?.();
      FP.modal({
        title: 'Team & access',
        body: `<p class="helptext">${signedIn
          ? `Only an admin can manage accounts. You are signed in as <b>${esc(role || 'crew')}</b>.`
          : 'Sign in with an admin account to manage team access.'}</p>`,
        foot: '<button class="btn primary" data-close>Close</button>',
        onMount: (_b, f) => (f.querySelector('[data-close]').onclick = FP.closeModal),
      });
      return;
    }

    FP.modal({
      title: 'Team & access',
      wide: true,
      body: '<div class="helptext">Loading accounts…</div>',
      foot: '<button class="btn primary" data-close>Done</button>',
      onMount: (_b, f) => (f.querySelector('[data-close]').onclick = FP.closeModal),
    });

    await paint();
  };

  async function paint() {
    const body = $('modalBody');
    if (!body) return;

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

      <div class="grp">
        <h4 class="grp-title">Adding someone</h4>
        <p class="helptext" style="margin:0">
          Ask them to open the app and create an account, or send them a sign-in
          link from the Cloud panel. They will appear here as Crew once they have
          signed in for the first time, and you can promote them.
        </p>
      </div>

      <div id="teamMsg" class="helptext" style="margin-top:8px"></div>`;

    wire();
  }

  function msg(text, bad) {
    const m = $('teamMsg');
    if (!m) return;
    m.textContent = text;
    m.style.color = bad ? 'var(--err)' : 'var(--ok)';
  }

  function wire() {
    const sb = FP.auth.client();

    document.querySelectorAll('[data-role-for]').forEach((sel) =>
      sel.addEventListener('change', async () => {
        const id = sel.dataset.roleFor;
        const role = sel.value;
        msg('Saving…');
        const { error } = await sb.from('profile').update({ role }).eq('id', id);
        if (error) {
          msg(error.message, true);
          await paint();                 /* snap the control back to the truth */
          return;
        }
        msg('Role updated.');
        /* Demoting yourself changes what you may do next, so re-read the
           session's own profile before repainting. */
        await paint();
        FP.syncAccountBadge?.();
      }));

    document.querySelectorAll('[data-toggle]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = btn.dataset.toggle;
        const turningOn = btn.textContent.trim() === 'Disabled';
        msg('Saving…');
        const { error } = await sb.from('profile').update({ active: turningOn }).eq('id', id);
        if (error) { msg(error.message, true); await paint(); return; }
        msg(turningOn ? 'Account reactivated.' : 'Account disabled.');
        await paint();
      }));
  }
})(window);
