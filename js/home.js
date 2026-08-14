/* ============================================================
   home.js — the dashboard.

   The front door after sign-in: every plan you're allowed to see as a
   card, a new-plan button for staff, per-plan client links, and the
   plan's photo library. RLS decides what "allowed to see" means, so
   this file renders whatever comes back and never filters by itself.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let sb, shows = [], clients = [], clientUsers = [], boothCounts = {};

  /* ---------------- boot ---------------- */
  async function boot() {
    document.documentElement.dataset.theme = FP.prefs?.theme || 'light';

    await FP.auth.init();
    if (!FP.auth.signedIn()) {
      location.replace('login.html');
      return;
    }
    sb = FP.auth.client();

    const p = FP.auth.profile();
    $('who').innerHTML = `<b>${esc(p?.full_name || p?.email || '')}</b>` +
      (FP.auth.isClient() ? '' : ` · ${esc(p?.role || '')}`);

    if (FP.auth.canEdit()) {
      $('btnNew').hidden = false;
      $('btnAdmin').hidden = false;
    }

    $('btnOut').onclick = async () => { await FP.auth.signOut(); location.replace('login.html'); };
    $('btnHelp').onclick = () => welcome(true);
    $('btnNew').onclick = newPlanModal;
    $('btnAdmin').onclick = () => {
      /* the Admin panel lives in the Studio; open it there */
      FP.setPref('store', 'supabase');
      location.href = 'index.html#admin';
    };

    await load();
    render();

    if (!FP.prefs.homeWelcomeSeen) welcome(false);
  }

  async function load() {
    const [sh, cl, cu] = await Promise.all([
      sb.from('show').select('id, name, width, height, unit, client_id, freeze_date, published_at, created_at')
        .order('created_at', { ascending: false }),
      FP.auth.canEdit()
        ? sb.from('client').select('id, name, portal_token, active').order('name')
        : Promise.resolve({ data: [] }),
      FP.auth.canEdit()
        ? sb.from('profile').select('id, email, full_name, client_id').eq('role', 'client')
        : Promise.resolve({ data: [] }),
    ]);
    shows = sh.data || [];
    clients = cl.data || [];
    clientUsers = cu.data || [];

    /* booth counts in one query — count client-side, the volumes are tiny */
    boothCounts = {};
    if (shows.length) {
      const els = await sb.from('element').select('show_id')
        .eq('kind', 'space')
        .in('show_id', shows.map((s) => s.id));
      (els.data || []).forEach((e) => (boothCounts[e.show_id] = (boothCounts[e.show_id] || 0) + 1));
    }
  }

  /* ---------------- render ---------------- */
  function render() {
    const isClient = FP.auth.isClient();
    $('pageTitle').textContent = isClient ? 'Your event plans' : 'All plans';
    $('pageSub').textContent = isClient
      ? 'Open a plan to arrange your event — every change saves automatically, and the Source One team sees it live.'
      : `${shows.length} plan${shows.length === 1 ? '' : 's'} · ${clients.length} client${clients.length === 1 ? '' : 's'}`;

    const c = $('content');
    if (!shows.length) {
      c.innerHTML = `<div class="empty">
        ${isClient
          ? 'No plans have been shared with your company yet.<br>Contact the Source One team.'
          : 'No plans yet. Click <b>New plan</b> to start one, or build from a venue photo inside the Studio.'}
      </div>`;
      return;
    }

    c.innerHTML = `<div class="grid">${shows.map(card).join('')}</div>`;

    c.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => {
      FP.setPref('store', 'supabase');
      location.href = `index.html?plan=${encodeURIComponent(b.dataset.open)}`;
    }));
    c.querySelectorAll('[data-photos]').forEach((b) => (b.onclick = () => photosModal(b.dataset.photos)));
    c.querySelectorAll('[data-link]').forEach((b) => (b.onclick = () => linkModal(b.dataset.link)));
    c.querySelectorAll('[data-assign]').forEach((sel) =>
      sel.addEventListener('change', async () => {
        const { error } = await sb.from('show')
          .update({ client_id: sel.value || null }).eq('id', sel.dataset.assign);
        if (error) alert(error.message);
        await load(); render();
      }));
  }

  function card(s) {
    const client = clients.find((x) => x.id === s.client_id);
    const isClientUser = FP.auth.isClient();
    const frozen = s.freeze_date && new Date(s.freeze_date) < new Date();
    const booths = boothCounts[s.id] || 0;

    return `<div class="plan-card">
      <h3>${esc(s.name)}</h3>
      <div class="plan-meta">
        <span><b>${booths}</b> booth${booths === 1 ? '' : 's'}</span>
        <span>${esc(String(s.width))} × ${esc(String(s.height))} ${esc(s.unit || 'ft')}</span>
        ${s.published_at ? '<span>· published</span>' : ''}
        ${frozen ? '<span>· frozen</span>' : ''}
      </div>
      ${isClientUser ? '' : client
        ? `<span class="chip client">CLIENT · ${esc(client.name)}</span>`
        : '<span class="chip internal">INTERNAL</span>'}

      <div class="card-actions">
        <button class="btn soft" data-open="${esc(s.id)}">Open plan</button>
        <button class="mini" data-photos="${esc(s.id)}">Photos</button>
        ${!isClientUser && client ? `<button class="mini" data-link="${esc(s.client_id)}">Client link</button>` : ''}
      </div>
      ${!isClientUser && FP.auth.canEdit() ? `
        <div class="card-actions" style="margin-top:8px">
          <select class="inp" style="padding:7px 10px;font-size:12.5px" data-assign="${esc(s.id)}"
                  title="Which client company can see and edit this plan">
            <option value="">Internal — no client</option>
            ${clients.map((cl) =>
              `<option value="${esc(cl.id)}"${cl.id === s.client_id ? ' selected' : ''}>${esc(cl.name)}</option>`).join('')}
          </select>
        </div>` : ''}
    </div>`;
  }

  /* ---------------- welcome / instructions ---------------- */
  function welcome(manual) {
    const staff = !FP.auth.isClient();
    const steps = staff
      ? [
          ['Build or open a plan', 'Click a card to open it in the Studio — or <b>New plan</b>, then trace the venue from a photo (Import reference image, scale it, trace the walls, remove the photo).'],
          ['Add the photos on site', 'Shoot the venue’s posted floor plan straight-on and note one real measurement. When you import a photo into a cloud plan, the original is saved to that plan’s photo library automatically.'],
          ['Lay out the show', 'Quick booths, booth rows, and the Source One rentals catalog — tables, lounges, bars, staging — all at real sizes. The Safety tab flags anything unbuildable.'],
          ['Hand it to the client', 'Open <b>Admin</b> → add the client company and assign the plan. Every client has one permanent link — set their access password and send them link + password. They see and edit only their own plans.'],
          ['Show it in 3D', 'The <b>3D</b> button stands the plan up as a walkthrough — the fastest way to get a client to say "move the bar now, not on load-in day."'],
        ]
      : [
          ['Open your plan', 'Click your event card. Everything you see is live — the Source One team works on the same plan.'],
          ['Arrange your space', 'Drag tables, seating, and displays from the catalog on the left. Changes save automatically.'],
          ['Walk it in 3D', 'Click <b>3D</b> in the top bar to stand inside your event and orbit around it.'],
          ['Locked after the freeze date', 'Up to the freeze date you can adjust freely; after that the layout locks so the build matches what you approved.'],
        ];

    overlay(`<div class="sheet">
      <h2>${staff ? 'How this works' : 'Welcome to your event workspace'}</h2>
      <p>${staff
        ? 'The 60-second version. The full manual is in the user guide.'
        : 'Set up your event exactly how you want it — here’s the short version.'}</p>
      ${steps.map(([t, d], i) => `<div class="step"><div class="n">${i + 1}</div><div><b>${t}</b><span>${d}</span></div></div>`).join('')}
      <div class="sheet-foot">
        <a href="guide.html" target="_blank" rel="noopener">Open the full user guide</a>
        <div class="grow"></div>
        <button class="btn primary" id="wClose">${manual ? 'Close' : 'Got it — let’s go'}</button>
      </div>
    </div>`);
    $('wClose').onclick = () => { FP.setPref('homeWelcomeSeen', 1); closeOverlay(); };
  }

  /* ---------------- client link ----------------
     One PERMANENT link per client company + a password staff set.
     Setting the password creates the client's login behind the scenes
     if it doesn't exist yet. */
  async function linkModal(clientId) {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    const login = clientUsers.find((u) => u.client_id === clientId);
    const link = `${location.origin}${location.pathname.replace(/home\.html$/, '')}login.html?c=${client.portal_token}`;

    overlay(`<div class="sheet box">
      <h2>Client access — ${esc(client.name)}</h2>
      <p>Send the client this <b>permanent link</b> plus the password you set below.
         The link opens a sign-in page for their company only.</p>
      <label>Their link</label>
      <div class="linkrow" style="margin-top:0">
        <input class="inp" readonly value="${esc(link)}" aria-label="Client link" />
        <button class="mini" id="bxCopy">Copy</button>
      </div>
      <label>${login ? 'Change their password' : 'Set their password (activates the link)'}</label>
      <div class="linkrow" style="margin-top:0">
        <input class="inp" id="bxPw" type="text" minlength="8" autocomplete="off"
               placeholder="Access password (min 8 characters)" style="font:inherit" />
        <button class="mini" id="bxSave">Save</button>
      </div>
      <div id="boxMsg">${login ? 'A password is already set — saving a new one replaces it.' : ''}</div>
      <div class="sheet-foot">
        <button class="btn ghost" id="bxCancel">Close</button>
      </div>
    </div>`);
    $('bxCancel').onclick = closeOverlay;
    $('bxCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(link); boxMsg('Link copied.', 'ok'); }
      catch { boxMsg('Select the link and press ⌘C.', 'err'); }
    };
    $('bxSave').onclick = async () => {
      const password = ($('bxPw').value || '').trim();
      if (password.length < 8) return boxMsg('Password needs at least 8 characters.', 'err');
      boxMsg('Saving…');
      const res = login
        ? await FP.auth.callFn('admin-clients', { action: 'set-password', email: login.email, password })
        : await FP.auth.callFn('admin-clients', { action: 'create-client-user', client_id: clientId, password });
      if (res.error) return boxMsg(res.error, 'err');
      boxMsg('Saved — send the client the link and this password.', 'ok');
      await load();
    };
  }

  /* ---------------- photos ---------------- */
  const photoFolder = (s) => `${s.client_id || 'internal'}/${s.id}`;

  async function photosModal(showId) {
    const s = shows.find((x) => x.id === showId);
    if (!s) return;
    overlay(`<div class="sheet box">
      <h2>Venue photos — ${esc(s.name)}</h2>
      <p>Every reference photo imported into this plan is archived here, in the plan's
         cloud photo library.</p>
      <div id="bxList"><div class="loading" style="padding:20px 0">Loading…</div></div>
      <div id="boxMsg"></div>
      <div class="sheet-foot">
        ${FP.auth.isClient() ? '' : `<label class="btn ghost" style="cursor:pointer">
          Upload photo<input type="file" id="bxUp" accept="image/*" hidden></label>`}
        <div class="grow"></div>
        <button class="btn primary" id="bxCancel">Close</button>
      </div>
    </div>`);
    $('bxCancel').onclick = closeOverlay;
    $('bxUp')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      boxMsg('Uploading…');
      const path = `${photoFolder(s)}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
      const { error } = await sb.storage.from('plan-photos').upload(path, file);
      boxMsg(error ? error.message : 'Uploaded.', error ? 'err' : 'ok');
      if (!error) listPhotos(s);
    });
    await listPhotos(s);
  }

  async function listPhotos(s) {
    const el = $('bxList');
    const { data, error } = await sb.storage.from('plan-photos')
      .list(photoFolder(s), { sortBy: { column: 'created_at', order: 'desc' } });
    if (error) { el.innerHTML = `<p style="color:var(--err)">${esc(error.message)}</p>`; return; }
    if (!data?.length) {
      el.innerHTML = `<p style="color:var(--tx-3)">No photos yet. They're added automatically
        when a reference image is imported into this plan in the Studio${FP.auth.isClient() ? '.' : ', or upload one here.'}</p>`;
      return;
    }
    el.innerHTML = data.map((f) =>
      `<div class="photo-row"><span>${esc(f.name.replace(/^\d+-/, ''))}</span>
        <button class="mini" data-view="${esc(f.name)}">View</button></div>`).join('');
    el.querySelectorAll('[data-view]').forEach((b) => (b.onclick = async () => {
      const { data: signed } = await sb.storage.from('plan-photos')
        .createSignedUrl(`${photoFolder(s)}/${b.dataset.view}`, 600);
      if (signed?.signedUrl) window.open(signed.signedUrl, '_blank', 'noopener');
    }));
  }

  /* ---------------- new plan ---------------- */
  function newPlanModal() {
    overlay(`<div class="sheet box">
      <h2>New plan</h2>
      <p>Set the hall's rough size — you'll refine it in the Studio, usually by
         tracing a venue photo.</p>
      <label>Plan name</label>
      <input class="inp" id="bxName" placeholder="e.g. Spring Home Show 2027" />
      <div class="row2">
        <div><label>Width (ft)</label><input class="inp" id="bxW" type="number" value="200" /></div>
        <div><label>Depth (ft)</label><input class="inp" id="bxH" type="number" value="120" /></div>
      </div>
      <div id="boxMsg"></div>
      <div class="sheet-foot">
        <button class="btn ghost" id="bxCancel">Cancel</button>
        <div class="grow"></div>
        <button class="btn primary" id="bxGo">Create & open</button>
      </div>
    </div>`);
    $('bxCancel').onclick = closeOverlay;
    $('bxGo').onclick = async () => {
      const name = $('bxName').value.trim() || 'Untitled Show';
      boxMsg('Creating…');
      const { data, error } = await sb.from('show').insert({
        name,
        width: Number($('bxW').value) || 200,
        height: Number($('bxH').value) || 120,
        created_by: FP.auth.user()?.id || null,
      }).select('id').single();
      if (error) return boxMsg(error.message, 'err');
      FP.setPref('store', 'supabase');
      location.href = `index.html?plan=${encodeURIComponent(data.id)}`;
    };
  }

  /* ---------------- overlay helpers ---------------- */
  function overlay(html) {
    const o = $('overlay');
    o.className = 'veil';
    o.hidden = false;
    o.innerHTML = html;
    o.onclick = (e) => { if (e.target === o) closeOverlay(); };
  }
  function closeOverlay() { const o = $('overlay'); o.hidden = true; o.innerHTML = ''; }
  function boxMsg(t, cls) { const m = $('boxMsg'); if (m) { m.textContent = t; m.className = cls || ''; } }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();
})(window);
