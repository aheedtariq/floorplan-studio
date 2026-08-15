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
    $('btnHelp').onclick = () => FP.tour.open();
    $('btnNew').onclick = newPlanModal;
    $('btnAdmin').onclick = () => (location.href = 'admin.html');

    await load();
    render();

    /* first sign-in: the full walkthrough, skippable on every page */
    if (!FP.prefs.tourDone) FP.tour.open();
  }

  async function load() {
    const [sh, cl, cu] = await Promise.all([
      sb.from('show').select('id, name, width, height, unit, client_id, freeze_date, published_at, created_at, is_template')
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
    const plans = shows.filter((s) => !s.is_template);
    const templates = shows.filter((s) => s.is_template);

    $('pageTitle').textContent = isClient ? 'Your event plans' : 'All plans';
    $('pageSub').textContent = isClient
      ? 'Open a plan to arrange your event — every change saves automatically, and the Source One team sees it live.'
      : `${plans.length} plan${plans.length === 1 ? '' : 's'} · ${clients.length} client${clients.length === 1 ? '' : 's'}`;

    const c = $('content');
    if (!plans.length && !templates.length) {
      c.innerHTML = `<div class="empty">
        ${isClient
          ? 'No plans have been shared with your company yet.<br>Contact the Source One team.'
          : 'No plans yet. Click <b>New plan</b> to start one, or build from a venue photo inside the Studio.'}
      </div>`;
      return;
    }

    let h = plans.length
      ? `<div class="grid">${plans.map(card).join('')}</div>`
      : '<div class="empty">No plans yet. Click <b>New plan</b> — a template gets you 80% of the way.</div>';

    /* Templates: the reusable starting points for future orders.
       Internal-only rows, so clients never receive them from RLS. */
    if (!isClient && FP.auth.canEdit()) {
      h += `<h2 class="section-h" style="margin:28px 0 12px;font-size:15px">Templates
              <span style="font-weight:400;color:var(--tx-3);font-size:12.5px;margin-left:8px">
                start a customer's plan from a proven layout</span></h2>`;
      h += templates.length
        ? `<div class="grid">${templates.map(templateCard).join('')}</div>`
        : `<div class="empty" style="padding:18px">No saved templates yet — open any plan card
             and press <b>Save as template</b>, or pick a built-in layout in <b>New plan</b>.</div>`;
    }
    c.innerHTML = h;

    c.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => {
      FP.setPref('store', 'supabase');
      location.href = `index.html?plan=${encodeURIComponent(b.dataset.open)}`;
    }));
    c.querySelectorAll('[data-photos]').forEach((b) => (b.onclick = () => photosModal(b.dataset.photos)));
    c.querySelectorAll('[data-link]').forEach((b) => (b.onclick = () => linkModal(b.dataset.link)));
    c.querySelectorAll('[data-use]').forEach((b) => (b.onclick = () => newPlanModal(b.dataset.use)));
    c.querySelectorAll('[data-mktpl]').forEach((b) => (b.onclick = () => saveAsTemplate(b.dataset.mktpl)));
    c.querySelectorAll('[data-deltpl]').forEach((b) => (b.onclick = async () => {
      const t = shows.find((s) => s.id === b.dataset.deltpl);
      if (!confirm(`Delete the template “${t?.name}”? Plans made from it are not affected.`)) return;
      const { error } = await sb.from('show').delete().eq('id', b.dataset.deltpl);
      if (error) alert(error.message);
      await load(); render();
    }));
    c.querySelectorAll('[data-assign]').forEach((sel) =>
      sel.addEventListener('change', async () => {
        const { error } = await sb.from('show')
          .update({ client_id: sel.value || null }).eq('id', sel.dataset.assign);
        if (error) alert(error.message);
        await load(); render();
      }));
  }

  function templateCard(s) {
    const booths = boothCounts[s.id] || 0;
    return `<div class="plan-card">
      <h3>${esc(s.name)}</h3>
      <div class="plan-meta">
        <span><b>${booths}</b> booth${booths === 1 ? '' : 's'}</span>
        <span>${esc(String(s.width))} × ${esc(String(s.height))} ${esc(s.unit || 'ft')}</span>
      </div>
      <span class="chip internal">TEMPLATE</span>
      <div class="card-actions">
        <button class="btn soft" data-use="${esc(s.id)}">Use template</button>
        <button class="mini" data-open="${esc(s.id)}">Edit</button>
        <button class="mini danger" data-deltpl="${esc(s.id)}">Delete</button>
      </div>
    </div>`;
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
        ${!isClientUser && FP.auth.canEdit() ? `<button class="mini" data-mktpl="${esc(s.id)}"
          title="Copy this layout into the template library">Save as template</button>` : ''}
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

  /* The first-login walkthrough lives in tour.js (FP.tour.open) — the
     dashboard just triggers it: automatically once, then from Help. */

  /* ---------------- client link ----------------
     One PERMANENT link per client company + a password staff set.
     Setting the password creates the client's login behind the scenes
     if it doesn't exist yet. */
  async function linkModal(clientId) {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    const login = clientUsers.find((u) => u.client_id === clientId);
    const link = `${location.origin}/login.html?c=${client.portal_token}`;

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
  /* Deep-copy a show and its elements under fresh ids. The one careful
     part is the id remap: parent links must survive, and parents must
     land before children or the FK complains. */
  async function copyShow(srcId, name, isTemplate) {
    const { data: src, error } = await sb.from('show').select('*').eq('id', srcId).single();
    if (error) throw new Error(error.message);
    const { data: els, error: elErr } = await sb.from('element')
      .select('*').eq('show_id', srcId).order('z');
    if (elErr) throw new Error(elErr.message);

    const id = FP.uid();
    const {
      id: _id, created_at: _ca, created_by: _cb, client_id: _cl,
      published_at: _pa, freeze_date: _fd, load_in: _li, opens: _op,
      teardown: _td, deadline: _dl, ...keep
    } = src;
    const { error: insErr } = await sb.from('show').insert({
      ...keep, id, name, is_template: isTemplate,
      created_by: FP.auth.user()?.id || null,
    });
    if (insErr) throw new Error(insErr.message);

    const map = {};
    (els || []).forEach((e) => (map[e.id] = FP.uid()));
    const rows = (els || []).map((e) => ({
      id: map[e.id], show_id: id,
      parent_id: e.parent_id ? map[e.parent_id] : null,
      kind: e.kind, shape: e.shape, layer: e.layer,
      geometry: e.geometry, props: e.props, z: e.z,
    }));
    for (const batch of [rows.filter((r) => !r.parent_id), rows.filter((r) => r.parent_id)]) {
      if (!batch.length) continue;
      const { error: e2 } = await sb.from('element').insert(batch);
      if (e2) throw new Error(e2.message);
    }
    return id;
  }

  async function saveAsTemplate(showId) {
    const s = shows.find((x) => x.id === showId);
    if (!s) return;
    const name = prompt('Template name', `${s.name} — template`);
    if (!name) return;
    try {
      await copyShow(showId, name.trim(), true);
      await load(); render();
    } catch (e) { alert(e.message); }
  }

  /* New plan — blank, a built-in layout, or a copy of a saved template.
     Built-ins are generated inside the Studio on first open, so booths
     arrive furnished and numbered by the same code as hand placement. */
  function newPlanModal(useTemplateId) {
    const templates = shows.filter((s) => s.is_template);
    const builtins = [
      ['rows', 'Classic booth rows — 10×10 back-to-back, named aisles'],
      ['tabletop', 'Tabletop expo — 8×10 spaces, tight aisles'],
      ['islands', 'Island showcase — 20×20 islands, wide aisles'],
    ];
    overlay(`<div class="sheet box">
      <h2>New plan</h2>
      <p>Start from a template — booths, aisles, and entrances arrive ready to
         adapt — or from a blank hall you'll trace from a venue photo.</p>
      <label>Start from</label>
      <select class="inp" id="bxTpl">
        <option value="">Blank hall</option>
        <optgroup label="Built-in layouts">
          ${builtins.map(([k, label]) =>
            `<option value="builtin:${k}">${esc(label)}</option>`).join('')}
        </optgroup>
        ${templates.length ? `<optgroup label="Your templates">
          ${templates.map((t) =>
            `<option value="tpl:${esc(t.id)}"${useTemplateId === t.id ? ' selected' : ''}
             >${esc(t.name)} (${esc(String(t.width))}×${esc(String(t.height))})</option>`).join('')}
        </optgroup>` : ''}
      </select>
      <label>Plan name</label>
      <input class="inp" id="bxName" placeholder="e.g. Spring Home Show 2027" />
      <div class="row2" id="bxDims">
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

    /* a saved template brings its own hall size */
    const syncDims = () => {
      const v = $('bxTpl').value;
      $('bxDims').style.display = v.startsWith('tpl:') ? 'none' : '';
    };
    $('bxTpl').onchange = syncDims;
    syncDims();

    $('bxGo').onclick = async () => {
      const name = $('bxName').value.trim() || 'Untitled Show';
      const choice = $('bxTpl').value;
      boxMsg('Creating…');
      try {
        let id, suffix = '';
        if (choice.startsWith('tpl:')) {
          id = await copyShow(choice.slice(4), name, false);
        } else {
          const { data, error } = await sb.from('show').insert({
            name,
            width: Number($('bxW').value) || 200,
            height: Number($('bxH').value) || 120,
            created_by: FP.auth.user()?.id || null,
          }).select('id').single();
          if (error) throw new Error(error.message);
          id = data.id;
          if (choice.startsWith('builtin:')) suffix = `&template=${choice.slice(8)}`;
        }
        FP.setPref('store', 'supabase');
        location.href = `index.html?plan=${encodeURIComponent(id)}${suffix}`;
      } catch (e) { boxMsg(e.message, 'err'); }
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
