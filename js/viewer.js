/* ============================================================
   viewer.js — the public exhibitor directory.

   Reuses config.js, geometry.js and render.js unchanged. There is no
   second drawing path to keep in sync: the viewer sets FP.plan to the
   PUBLISHED SNAPSHOT — a different document from the working plan, with
   contacts, notes, internal status and the billing-relevant electrical
   fields already removed by publish.js — and then calls the same
   renderer the editor uses.

   Nothing here writes to the plan. interactions.js and ui.js are not
   loaded at all, so there is no editing surface to disable.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});
  const G = FP.geo;
  const C = FP.config;
  const R = FP.render;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let selectedId = null;
  let query = '';
  /* TCT-style filters: size, booth type, section (pavilion), open-only */
  const filt = { size: '', type: '', section: '', open: false };

  /* ---------------- data ---------------- */

  const spaces = () => FP.plan.elements
    .filter((e) => C.flag(e.kind, 'sellable') && !e.parentId);

  const sizeKey = (s) => `${s.geometry.w}×${s.geometry.h}`;

  function passesFilters(s) {
    if (filt.size && sizeKey(s) !== filt.size) return false;
    if (filt.type && (s.props.spaceType || 'inline') !== filt.type) return false;
    if (filt.section && String(s.props.section || '') !== filt.section) return false;
    return true;
  }

  const listed = () => spaces()
    .filter((s) => (filt.open
      ? !(s.props.exhibitor || '').trim()          /* booths still for sale */
      : (s.props.exhibitor || '').trim()))
    .filter(passesFilters)
    .sort((a, b) => (filt.open
      ? String(a.props.number || '').localeCompare(String(b.props.number || ''), undefined, { numeric: true })
      : String(a.props.exhibitor).localeCompare(String(b.props.exhibitor))));

  function matches(s) {
    if (!query) return true;
    const q = query.toLowerCase();
    return (s.props.exhibitor || '').toLowerCase().includes(q)
        || String(s.props.number || '').toLowerCase().includes(q)
        || (s.props.publicCategory || '').toLowerCase().includes(q)
        || (s.props.section || '').toLowerCase().includes(q)
        || C.spaceType(s.props.spaceType).name.toLowerCase().includes(q);
  }

  /* ---------------- directory ---------------- */

  function fillFilterOptions() {
    const all = spaces();
    const opt = (v, label = v) => `<option value="${esc(v)}">${esc(label)}</option>`;

    const sizes = [...new Set(all.map(sizeKey))]
      .sort((a, b) => (parseFloat(a) * parseFloat(a.split('×')[1] || 1)) -
                      (parseFloat(b) * parseFloat(b.split('×')[1] || 1)));
    $('vfSize').innerHTML = opt('', 'Any size') +
      sizes.map((k) => opt(k, `${k.replace('×', "' × ")}'`)).join('');

    const types = [...new Set(all.map((s) => s.props.spaceType || 'inline'))];
    $('vfType').innerHTML = opt('', 'Any type') +
      types.map((t) => opt(t, C.spaceType(t).name)).join('');

    const sections = [...new Set(all.map((s) => String(s.props.section || '').trim())
      .filter(Boolean))].sort();
    $('vfSection').innerHTML = opt('', 'All sections') + sections.map((s) => opt(s)).join('');
    $('vfSection').parentElement.style.display = sections.length ? '' : 'none';
  }

  function renderList() {
    const all = listed();
    const rows = all.filter(matches);
    const noun = filt.open ? 'available booth' : 'exhibitor';

    $('vCount').textContent = query || filt.size || filt.type || filt.section
      ? `${rows.length} of ${filt.open ? spaces().filter((s) => !(s.props.exhibitor || '').trim()).length : spaces().filter((s) => (s.props.exhibitor || '').trim()).length} ${noun}s`
      : `${all.length} ${noun}${all.length === 1 ? '' : 's'}`;

    $('vResults').innerHTML = rows.length
      ? rows.map((s) => `
        <button class="v-row${s.id === selectedId ? ' on' : ''}" data-id="${s.id}">
          <span class="n">${esc(s.props.number || '—')}</span>
          <span class="m">
            <b>${filt.open ? 'Available' : esc(s.props.exhibitor)}</b>
            <span>${esc(G.fmtDims(s.geometry.w, s.geometry.h, FP.plan.unit))}${
              s.props.section ? ` · ${esc(s.props.section)}` :
              s.props.publicCategory ? ` · ${esc(s.props.publicCategory)}` : ''}</span>
          </span>
        </button>`).join('')
      : `<div class="v-none">${filt.open ? 'No open booths match.' : `No exhibitor matches${query ? ` “${esc(query)}”` : ''}.`}</div>`;

    $('vResults').querySelectorAll('[data-id]').forEach((b) =>
      b.addEventListener('click', () => selectBooth(b.dataset.id, true)));
  }

  /* ---------------- detail card ---------------- */

  function renderCard() {
    const card = $('vCard');
    const s = selectedId ? FP.get(selectedId) : null;
    if (!s) { card.hidden = true; return; }

    const q = s.geometry;
    const contents = FP.childrenOf(s.id).length;
    const inBooth = FP.state.scope.type === 'booth';

    const row = (k, v) => `<div class="r"><i>${esc(k)}</i><b>${esc(v)}</b></div>`;

    card.hidden = false;
    card.innerHTML = `
      <header>
        <span class="bn">${esc(s.props.number || '—')}</span>
        <span class="bt">
          <b>${esc(s.props.exhibitor || 'Open space')}</b>
          <span>${esc(FP.plan.hall || FP.plan.venue || '')}</span>
        </span>
        <button class="x" id="vClose" aria-label="Close">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>
      <div class="rows">
        ${row('Booth', s.props.number || '—')}
        ${row('Status', (s.props.exhibitor || '').trim() ? 'Reserved' : 'Available')}
        ${row('Size', G.fmtDims(q.w, q.h, FP.plan.unit))}
        ${row('Area', G.fmtArea(G.area(s), FP.plan.unit))}
        ${row('Type', C.spaceType(s.props.spaceType).name)}
        ${s.props.section ? row('Section', s.props.section) : ''}
        ${s.props.publicCategory ? row('Category', s.props.publicCategory) : ''}
      </div>
      <footer>
        ${contents && !inBooth
          ? `<button class="primary" id="vEnter">
               <svg viewBox="0 0 24 24"><path d="M14 4h6v16h-6M4 12h10m0 0-3-3m3 3-3 3"/></svg>
               View interior</button>`
          : ''}
        <button id="vShare">
          <svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 15V3m0 0L8 7m4-4 4 4"/></svg>
          Copy link</button>
      </footer>`;

    $('vClose').onclick = () => { selectBooth(null); };
    const enter = $('vEnter');
    if (enter) enter.onclick = () => enterBooth(s.id);
    $('vShare').onclick = () => shareLink(s);
  }

  function shareLink(s) {
    const url = `${location.origin}${location.pathname}?booth=${encodeURIComponent(s.props.number || '')}`;
    const done = () => flash('Link copied');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link', url));
    } else {
      prompt('Copy this link', url);
    }
  }

  let flashTimer = null;
  function flash(msg) {
    const bar = $('vScopeBar');
    const prevHidden = bar.hidden;
    const prev = $('vScopeLabel').textContent;
    if (prevHidden) {
      bar.hidden = false;
      bar.querySelector('button').style.display = 'none';
    }
    $('vScopeLabel').textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      $('vScopeLabel').textContent = prev;
      bar.querySelector('button').style.display = '';
      bar.hidden = prevHidden;
    }, 1600);
  }

  /* ---------------- selection and scope ---------------- */

  function selectBooth(id, center = false) {
    selectedId = id;
    FP.state.selection = id ? [id] : [];
    if (center && id) {
      const el = FP.get(id);
      if (el) R.centerOn(G.bbox(el));
    }
    renderList();
    renderCard();
    R.draw();
    syncUrl();
  }

  function enterBooth(id) {
    FP.state.scope = { type: 'booth', spaceId: id };
    const el = FP.get(id);
    $('vScopeBar').hidden = false;
    $('vScopeBar').querySelector('button').style.display = '';
    $('vScopeLabel').textContent =
      `Booth ${el?.props.number || ''} — ${el?.props.exhibitor || ''}`;
    if (el) R.fit(G.bbox(el), 70);
    renderCard();
    R.draw();
  }

  function exitBooth() {
    FP.state.scope = { type: 'hall', spaceId: null };
    $('vScopeBar').hidden = true;
    R.fit();
    renderCard();
    R.draw();
  }

  function syncUrl() {
    const s = selectedId ? FP.get(selectedId) : null;
    const url = new URL(location.href);
    if (s?.props.number) url.searchParams.set('booth', s.props.number);
    else url.searchParams.delete('booth');
    history.replaceState(null, '', url);
  }

  /* ---------------- canvas interaction (pan / zoom / pick) ---------------- */

  function wireCanvas(svg) {
    let drag = null;

    svg.addEventListener('pointerdown', (ev) => {
      svg.setPointerCapture(ev.pointerId);
      drag = { x: ev.clientX, y: ev.clientY, vx: FP.state.view.x, vy: FP.state.view.y, moved: false };
    });

    svg.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      svg.classList.add('dragging');
      FP.state.view.x = drag.vx - dx / FP.state.view.zoom;
      FP.state.view.y = drag.vy - dy / FP.state.view.zoom;
      R.draw();
    });

    svg.addEventListener('pointerup', (ev) => {
      svg.classList.remove('dragging');
      const wasDrag = drag?.moved;
      drag = null;
      if (wasDrag) return;

      /* A click, not a pan: pick the booth under the cursor. */
      const w = R.eventWorld(ev);
      const hit = spaces().find((s) => G.hitTest(w.x, w.y, s));
      if (FP.state.scope.type === 'booth') return;
      selectBooth(hit ? hit.id : null);
    });

    svg.addEventListener('pointercancel', () => { drag = null; svg.classList.remove('dragging'); });

    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = svg.getBoundingClientRect();
      R.zoomAt(Math.exp(-ev.deltaY * 0.0022), ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });

    svg.addEventListener('dblclick', (ev) => {
      const w = R.eventWorld(ev);
      const hit = spaces().find((s) => G.hitTest(w.x, w.y, s));
      if (hit && FP.childrenOf(hit.id).length) enterBooth(hit.id);
    });
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    const canvas = $('canvas');
    document.documentElement.dataset.theme = FP.prefs?.theme || 'light';

    /* viewer.html?s=<show id> — the published cloud copy; without it,
       fall back to whatever this browser last published (offline dev) */
    const showId = new URLSearchParams(location.search).get('s');
    const snapshot = (showId && await fetchPublished(showId)) || FP.readPublicSnapshot();
    if (!snapshot) {
      $('vEmpty').hidden = false;
      $('vCount').textContent = '';
      $('showMeta').textContent = 'Nothing published';
      return;
    }

    /* The renderer reads FP.plan; hand it the public document. */
    FP.plan = FP.migrate(snapshot);
    FP.state.issues = [];
    FP.state.showLabels = true;
    FP.state.showGrid = false;

    $('showName').textContent = FP.plan.name || 'Exhibitor directory';
    $('showMeta').textContent = [
      FP.plan.venue, FP.plan.hall,
      FP.plan.dates?.open ? `Opens ${FP.plan.dates.open}` : '',
    ].filter(Boolean).join(' · ');
    document.title = `${FP.plan.name} — exhibitor directory`;

    R.init(canvas);
    wireCanvas(canvas);
    R.fit();
    renderList();

    fillFilterOptions();
    $('vSearch').addEventListener('input', (ev) => {
      query = ev.target.value;
      renderList();
    });
    const refilter = () => { renderList(); };
    $('vfSize').addEventListener('change', (ev) => { filt.size = ev.target.value; refilter(); });
    $('vfType').addEventListener('change', (ev) => { filt.type = ev.target.value; refilter(); });
    $('vfSection').addEventListener('change', (ev) => { filt.section = ev.target.value; refilter(); });
    $('vfOpen').addEventListener('change', (ev) => { filt.open = ev.target.checked; refilter(); });
    $('vZoomIn').onclick = () => R.setZoom(FP.state.view.zoom * 1.3);
    $('vZoomOut').onclick = () => R.setZoom(FP.state.view.zoom / 1.3);
    $('vFit').onclick = () => { exitBooth(); };
    $('vBack').onclick = exitBooth;
    $('vTheme').onclick = () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      FP.setPref?.('theme', next);
      R.draw();
    };

    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (FP.state.scope.type === 'booth') exitBooth();
        else selectBooth(null);
      }
      if (ev.key === '/' && document.activeElement !== $('vSearch')) {
        ev.preventDefault();
        $('vSearch').focus();
      }
    });

    /* Deep link: viewer.html?booth=154 */
    const wanted = new URLSearchParams(location.search).get('booth');
    if (wanted) {
      const target = spaces().find((s) => String(s.props.number) === wanted);
      if (target) selectBooth(target.id, true);
    }
  }

  /**
   * Read the published document. Kept separate from publish.js so the
   * viewer never loads the code that can *write* one.
   */
  FP.readPublicSnapshot = () => {
    try { return JSON.parse(localStorage.getItem('fps.public.v1')) || null; }
    catch { return null; }
  };

  /** Fetch a cloud-published snapshot. Anonymous, read-only by design —
      this is the public page of a published show. */
  async function fetchPublished(showId) {
    if (!/^[0-9a-f-]{36}$/i.test(showId)) return null;
    try {
      const base = 'https://bvbjjawpmdfpkmasrcpk.supabase.co';
      const key = 'sb_publishable_phh-vhvlqPg8YGEjuxIorw_hgn7bnAX';
      const r = await fetch(
        `${base}/rest/v1/public_plan?show_id=eq.${showId}&select=doc`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (!r.ok) return null;
      const rows = await r.json();
      return rows?.[0]?.doc || null;
    } catch { return null; }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
