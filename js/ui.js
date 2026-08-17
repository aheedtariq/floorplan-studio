/* ============================================================
   ui.js — panels, inspector, modals, toolbar.

   The inspector is generated from field definitions, not hand-written
   per kind: FP.config.kind(id).fields drives what you can edit. Adding a
   field to config puts a control on screen with no UI code, which is the
   same mechanism the exhibitor submission form will use in phase 3.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});
  const G = FP.geo;
  const C = FP.config;
  const S = FP.state;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const R = () => FP.render;
  const unit = () => FP.plan.unit;

  let activeTab = 'props';
  let catalogQuery = '';

  /* ============================================================
     Toast
     ============================================================ */
  let toastTimer = null;
  FP.toast = (msg, isError = false) => {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle('err', isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  };

  /* ============================================================
     Modal
     ============================================================ */
  FP.modal = ({ title, body, foot = '', wide = false, onMount }) => {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = body;
    $('modalFoot').innerHTML = foot;
    $('modal').classList.toggle('wide', wide);
    $('modalBackdrop').hidden = false;
    if (onMount) onMount($('modalBody'), $('modalFoot'));
    const first = $('modalBody').querySelector('input,select,textarea');
    if (first) setTimeout(() => first.focus(), 40);
  };
  FP.closeModal = () => { $('modalBackdrop').hidden = true; };

  /* ============================================================
     Small builders
     ============================================================ */
  const field = (label, control, help) =>
    `<div class="field"><label>${esc(label)}</label>${control}${
      help ? `<div class="helptext" style="margin:4px 0 0">${esc(help)}</div>` : ''}</div>`;

  const input = (attrs) =>
    `<input class="inp ${attrs.cls || ''}" ${Object.entries(attrs)
      .filter(([k]) => !['cls'].includes(k))
      .map(([k, v]) => `${k}="${esc(v)}"`).join(' ')} />`;

  const numInput = (id, value, suffix, extra = '') =>
    `<div class="unit-inp"><input class="inp num" id="${id}" type="number" step="any"
      value="${value ?? ''}" ${extra}/>${suffix ? `<span class="u">${esc(suffix)}</span>` : ''}</div>`;

  const select = (id, value, options) =>
    `<select class="inp" id="${id}">${options.map(([v, l]) =>
      `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`
    ).join('')}</select>`;

  const iconSvg = (path, cls = '') =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

  /* ============================================================
     Tool rail
     ============================================================ */
  const RAIL = [
    { id: 'select', tool: 'select', key: 'V', name: 'Select & move',
      icon: '<path d="m4 3 7 17 2.5-6.5L20 11z"/>' },
    { id: 'pan', tool: 'pan', key: 'H', name: 'Pan',
      icon: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V12m0-1a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1.5a5 5 0 0 1-4-2L6 15a1.6 1.6 0 0 1 2.5-2l.5.7"/>' },
    { sep: true },
    { id: 'space', tool: 'draw', kind: 'space', key: 'B', name: 'Draw booth space',
      icon: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9h18"/>' },
    { id: 'wall', tool: 'line', kind: 'wall', key: 'W', name: 'Draw wall',
      icon: '<path d="M3 8h18M3 16h18M8 8v8M16 8v8"/>' },
    { id: 'dead', tool: 'draw', kind: 'dead-space', key: 'D', name: 'Mark dead space',
      icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 9 10 6M17 9 7 15"/>' },
    { id: 'poly', tool: 'poly', kind: 'dead-space-poly', key: 'P', name: 'Freeform dead space',
      icon: '<path d="m5 4 15 5-4 11-9-3z"/>' },
    { id: 'exit', tool: 'draw', kind: 'fire-exit', key: 'X', name: 'Place fire exit',
      icon: '<path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 1-3.5S9 12 11 12c1.6 0 1-4 1-9Z"/>' },
    { id: 'aisle', tool: 'draw', kind: 'aisle', key: 'A', name: 'Draw aisle',
      icon: '<path d="M6 3v18M18 3v18" stroke-dasharray="3 3"/><path d="M12 8v8m0 0-2-2m2 2 2-2"/>' },
    { sep: true },
    { id: 'text', tool: 'text', kind: 'text', key: 'T', name: 'Text label',
      icon: '<path d="M5 6h14M12 6v13M9 19h6"/>' },
    { id: 'dim', tool: 'line', kind: 'dimension', key: '', name: 'Dimension line',
      icon: '<path d="M3 8v8M21 8v8M3 12h18"/><path d="m7 9-3 3 3 3M17 9l3 3-3 3"/>' },
    { id: 'measure', tool: 'measure', key: 'M', name: 'Measure (does not draw)',
      icon: '<path d="M2 12 12 2l10 10-10 10z"/><path d="M8 8l2 2M12 6l2 2M6 12l2 2"/>' },
    { id: 'fill', tool: 'fill', key: 'U', name: 'Fill area with booths',
      icon: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>' },
  ];

  function renderRail() {
    $('toolRail').innerHTML = RAIL.map((r) => {
      if (r.sep) return '<div class="rail-sep"></div>';
      const active = S.tool === r.tool && (!r.kind || S.armedKind === r.kind);
      return `<button class="rail-btn${active ? ' active' : ''}" data-rail="${r.id}"
        data-key="${r.key || ''}" title="${esc(r.name)}${r.key ? ` (${r.key})` : ''}">
        ${iconSvg(r.icon)}</button>`;
    }).join('');
  }

  /* ============================================================
     Catalog
     ============================================================ */
  function renderPresets() {
    $('boothPresets').innerHTML = C.presets.map((p, i) => {
      const armed = S.armedKind === 'space' && S.armedSize
        && S.armedSize[0] === p.w && S.armedSize[1] === p.h;
      return `<button class="preset${armed ? ' armed' : ''}" data-preset="${i}">
        <b>${esc(p.label)}</b><span>${esc(p.note)}</span></button>`;
    }).join('');
  }

  /* Which catalog groups are folded away. Remembered across sessions —
     a planner laying out booths does not want to scroll past utilities
     every time. */
  const collapsed = new Set(FP.prefs.catalogCollapsed || []);
  /* Separate from `collapsed`: categories that default CLOSED but the
     user chose to open. Two sets because a category's resting state
     depends on its own defaultOpen flag — "the user closed this" and
     "the user opened this" are different facts when defaults differ
     per category. */
  const userToggled = new Set(FP.prefs.catalogOpened || []);

  /* Clients place the rentals they're choosing — walls, booths, safety
     and power are staff tools and never appear in their palette. */
  const clientPlaceable = (k) =>
    k.layer === 'contents' || ['carpet', 'turf', 'hanging-sign'].includes(k.id);

  function renderCatalog() {
    const q = catalogQuery.trim().toLowerCase();
    const isClient = FP.auth?.isClient?.();
    const kinds = C.kindsForScope(S.scope.type).filter((k) =>
      (!isClient || clientPlaceable(k)) &&
      (!q || k.name.toLowerCase().includes(q) || k.id.includes(q)));

    /* staff workflows disappear with the staff kinds */
    document.querySelectorAll('#boothPresets, #btnBoothRow, #btnAutoNumber, #btnUnderlay')
      .forEach((n) => { const sect = n.closest('.sect') || n; sect.style.display = isClient ? 'none' : ''; });

    /* How many of each kind are actually on the plan right now — the
       catalog is a palette, but a bare list of tool types tells you
       nothing about your own document. A live count does. */
    const placed = {};
    for (const el of FP.inScope()) placed[el.kind] = (placed[el.kind] || 0) + 1;

    $('catalog').innerHTML = C.categories.map((cat) => {
      const list = kinds.filter((k) => k.cat === cat.id);
      if (!list.length) return '';
      const catCount = list.reduce((sum, k) => sum + (placed[k.id] || 0), 0);
      /* A search always expands, so nothing hides behind a collapsed
         header. Otherwise: an explicit user choice (collapsed set) wins;
         failing that, the category's own defaultOpen decides what a
         first-time visitor sees — a handful of groups open, the rest
         tucked away, rather than nine categories all sprawled out. */
      const open = q ? true
        : collapsed.has(cat.id) ? false
        : userToggled.has(cat.id) ? true
        : cat.defaultOpen !== false;
      return `<section class="sect${open ? '' : ' closed'}">
        <button class="sect-head" data-toggle="${cat.id}" aria-expanded="${open}"
          style="--cat:${cat.color || 'var(--tx-3)'}">
          <svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
          <span class="cat-ic">${iconSvg(cat.icon || '')}</span>
          <span>${esc(cat.name)}</span>
          <span class="ct" title="${catCount} placed on this plan">${catCount}</span>
        </button>
        <div class="cat-list">${list.map((k) => catItem(k, placed[k.id] || 0)).join('')}</div>
      </section>`;
    }).join('') || `<div class="empty">No elements match “${esc(catalogQuery)}”.</div>`;
  }

  function catItem(k, count = 0) {
    const armed = S.armedKind === k.id && !S.armedSize;
    const size = k.shape === 'rect' && k.size ? `${k.size[0]}×${k.size[1]}`
               : k.shape === 'line' ? 'drag'
               : k.shape === 'poly' ? 'click' : '';
    /* The kind's colour rides in as a custom property so the swatch can
       tint its own background and keep the glyph legible against it. */
    return `<button class="cat-item${armed ? ' armed' : ''}" data-kind="${k.id}"
      title="${esc(k.name)}${count ? ` — ${count} on this plan` : ''}" style="--k:${k.fill}">
      <span class="swatch">${iconSvg(k.icon || '')}</span>
      <span class="nm">${esc(k.name)}</span>
      ${count ? `<span class="on-plan">${count}</span>` : ''}
      ${size ? `<span class="sz">${esc(size)}</span>` : ''}
    </button>`;
  }

  /** Arm a kind and pick the drawing tool that suits its shape. */
  function armKind(kindId, size = null, spaceType = null) {
    const k = C.kind(kindId);
    const tool = { rect: 'draw', line: 'line', poly: 'poly', marker: 'marker', text: 'text' }[k.shape] || 'draw';
    /* clicking the armed item again DISARMS it — back to the cursor */
    if (S.tool === tool && S.armedKind === kindId &&
        JSON.stringify(S.armedSize || null) === JSON.stringify(size || null)) {
      S.armedSize = null;
      S.armedSpaceType = null;
      FP.setTool('select');
      return;
    }
    S.armedSize = size;
    S.armedSpaceType = spaceType;
    FP.setTool(tool, kindId);
  }

  /* A floating "back to cursor" chip whenever a placement tool is armed —
     works over the 2D canvas and the 3D walkthrough alike. */
  function ensureToolChip() {
    let chip = $('toolChip');
    if (!chip) {
      chip = document.createElement('button');
      chip.id = 'toolChip';
      chip.className = 'tool-chip';
      chip.hidden = true;
      ($('stage') || document.body).appendChild(chip);
      chip.onclick = () => {
        S.armedSize = null;
        S.armedSpaceType = null;
        FP.setTool('select');
      };
    }
    return chip;
  }

  function syncToolChip() {
    const chip = ensureToolChip();
    const active = S.tool !== 'select' && S.tool !== 'pan';
    chip.hidden = !active;
    if (active) {
      const what = S.armedKind ? C.kind(S.armedKind).name
        : { measure: 'Measure', calibrate: 'Calibrate', fill: 'Fill with booths',
            line: 'Line', poly: 'Polygon', text: 'Text' }[S.tool] || 'Tool';
      chip.innerHTML = `✕&nbsp; ${esc(what)} — back to cursor <kbd>Esc</kbd>`;
    }
  }

  /* A floating Duplicate/Delete bar whenever something deletable is
     selected. The Arrange group in the panel does the same jobs, but a
     click on the floor deserves an answer right where it happened. */
  function ensureSelChip() {
    let chip = $('selChip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'selChip';
      chip.className = 'sel-chip';
      chip.hidden = true;
      ($('stage') || document.body).appendChild(chip);
      chip.innerHTML = `
        <b></b>
        <button class="mini" data-sc="dup">Duplicate</button>
        <button class="mini danger" data-sc="del">Delete</button>`;
      chip.querySelector('[data-sc="dup"]').onclick = () => {
        FP.duplicateSelected();
        R().draw();
      };
      chip.querySelector('[data-sc="del"]').onclick = () => {
        const n = FP.removeSelected();
        if (n) FP.toast(`Deleted ${n} item${n === 1 ? '' : 's'} — Ctrl+Z brings it back`);
        R().draw();
      };
    }
    return chip;
  }

  function syncSelChip() {
    const chip = ensureSelChip();
    const sel = FP.selected();
    /* locked structure never offers Delete — clicking it is inspection */
    const deletable = sel.filter((e) => !FP.isLocked(e));
    chip.hidden = !deletable.length;
    if (deletable.length) {
      chip.querySelector('b').textContent = sel.length === 1
        ? C.kind(sel[0].kind).name
        : `${sel.length} selected`;
    }
  }

  /* ============================================================
     Inspector — Properties
     ============================================================ */
  function renderProps() {
    const pane = $('tab-props');
    const sel = FP.selected();

    if (!sel.length) {
      pane.innerHTML = emptyProps();
      /* the empty state still carries the leave-booth-scope action */
      const exit = pane.querySelector('#btnExitScope');
      if (exit) exit.addEventListener('click', () => { FP.exitScope(); R().fit(); });
      return;
    }
    pane.innerHTML = sel.length === 1 ? singleProps(sel[0]) : multiProps(sel);
    wireProps(sel);
  }

  function emptyProps() {
    const st = FP.stats();
    const scope = FP.scopeSpace();
    if (scope) {
      const kids = FP.childrenOf(scope.id).length;
      return `<div class="grp">
        <h4 class="grp-title">Editing booth ${esc(scope.props.number || '')}</h4>
        <div class="kv"><span>Exhibitor</span><span>${esc(scope.props.exhibitor || '—')}</span></div>
        <div class="kv"><span>Footprint</span><span>${esc(G.fmtDims(scope.geometry.w, scope.geometry.h, unit()))}</span></div>
        <div class="kv"><span>Items placed</span><span>${kids}</span></div>
      </div>
      <div class="helptext">Place tables, displays and power drops inside the footprint.
        Everything is checked against the same rules as the hall.</div>
      <button class="mini" id="btnExitScope" style="width:100%">Back to hall plan</button>`;
    }
    return `<div class="empty">
      ${iconSvg('<path d="m4 3 7 17 2.5-6.5L20 11z"/>')}
      Nothing selected.<br/>Pick an element on the plan, or choose something to draw.
      <div class="stat-grid" style="margin-top:22px;text-align:left">
        <div class="stat accent"><b>${st.total}</b><span>Spaces</span></div>
        <div class="stat"><b>${G.fmtArea(st.sellable, unit()).replace(/ sq ft| m²/, '')}</b><span>Sellable ${unit() === 'm' ? 'm²' : 'sq ft'}</span></div>
      </div></div>`;
  }

  function singleProps(el) {
    const k = C.kind(el.kind);
    const q = el.geometry;
    const isSpace = C.flag(el.kind, 'sellable');
    let h = '';

    h += `<div class="grp">
      <h4 class="grp-title">${esc(k.name)}</h4>`;

    /* status + exhibitor for sellable spaces */
    if (isSpace) {
      h += field('Status', `<div class="seg" id="statusSeg">${
        C.statuses.map((s) => `<button data-status="${s.id}"
          class="${el.props.status === s.id ? 'on' : ''}"
          style="${el.props.status === s.id ? `color:${s.color}` : ''}">${esc(s.name)}</button>`).join('')
      }</div>`);
      h += field('Exhibitor', input({ id: 'pExhibitor', value: el.props.exhibitor || '', placeholder: 'Company name' }));
      /* section = the placard-style named area this booth belongs to;
         datalist offers every section already used on this plan */
      const sections = [...new Set(FP.spaces()
        .map((s) => String(s.props.section || '').trim()).filter(Boolean))].sort();
      h += field('Section', `${input({ id: 'pSection', value: el.props.section || '',
        placeholder: 'e.g. Local, Produce, Tech', list: 'sectionList' })}
        <datalist id="sectionList">${sections.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>`);
    }

    /* fields declared by the kind record */
    for (const f of k.fields || []) {
      h += renderFieldControl(f, el.props[f.key]);
    }

    h += `</div>`;

    /* geometry */
    h += `<div class="grp"><h4 class="grp-title">Geometry</h4>`;
    if (el.shape === 'rect') {
      h += `<div class="row2">${field('Width', numInput('gW', G.round(q.w, 2), unit()))}
        ${field('Height', numInput('gH', G.round(q.h, 2), unit()))}</div>`;
      h += `<div class="row2">${field('X', numInput('gX', G.round(q.x, 2), unit()))}
        ${field('Y', numInput('gY', G.round(q.y, 2), unit()))}</div>`;
      h += field('Rotation', numInput('gRot', G.round(q.rot || 0, 1), '°'));
      h += `<div class="rot-row">
        <button class="mini" data-rot="45">↻ 45°</button>
        <button class="mini" data-rot="90">↻ 90°</button>
        <button class="mini" data-rot="180">↻ 180°</button>
        <button class="mini" data-rot="-45">↺ 45°</button>
        <button class="mini" data-rot="0" title="Back to 0°">Reset</button>
      </div>`;
      h += `<div class="kv"><span>Area</span><span>${esc(G.fmtArea(G.area(el), unit()))}</span></div>`;
    } else if (el.shape === 'line') {
      h += `<div class="row2">${field('Length', numInput('gLen', G.round(G.length(el), 2), unit()))}
        ${field('Thickness', numInput('gTh', G.round(q.thickness ?? 0.5, 2), unit()))}</div>`;
      h += `<div class="kv"><span>From</span><span>${G.round(q.x1, 1)}, ${G.round(q.y1, 1)}</span></div>
        <div class="kv"><span>To</span><span>${G.round(q.x2, 1)}, ${G.round(q.y2, 1)}</span></div>`;
    } else if (el.shape === 'poly') {
      h += `<div class="kv"><span>Points</span><span>${q.pts.length}</span></div>
        <div class="kv"><span>Area</span><span>${esc(G.fmtArea(G.area(el), unit()))}</span></div>`;
    } else {
      h += `<div class="row2">${field('X', numInput('gX', G.round(q.x, 2), unit()))}
        ${field('Y', numInput('gY', G.round(q.y, 2), unit()))}</div>`;
      if (q.r !== undefined) h += field('Radius', numInput('gR', G.round(q.r, 2), unit()));
    }
    h += `</div>`;

    /* appearance */
    h += `<div class="grp"><h4 class="grp-title">Appearance</h4>
      <div class="color-row" id="colorRow">
        ${C.palette.map((c) => `<button class="color-dot${el.props.color === c ? ' on' : ''}"
          data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
        <button class="color-dot${!el.props.color ? ' on' : ''}" data-color=""
          style="background:${k.fill};opacity:.55" title="Default"></button>
      </div>
      <label class="check"><input type="checkbox" id="pLocked" ${el.props.locked ? 'checked' : ''}/> Locked</label>
      <label class="check"><input type="checkbox" id="pHidden" ${el.props.hidden ? 'checked' : ''}/> Hidden</label>
    </div>`;

    /* a protected element offers no move/delete controls — clicking it
       is inspection, not an invitation to take the floor apart */
    h += FP.isLocked(el)
      ? `<div class="grp"><h4 class="grp-title">Arrange</h4>
          <p class="helptext" style="margin:0">This part of the floor plan is managed
          by Source One — you can view it, but not move or delete it.</p></div>`
      : arrangeGroup(isSpace, el);
    return h;
  }

  function multiProps(sel) {
    const spaces = sel.filter((e) => C.flag(e.kind, 'sellable'));
    let h = `<div class="grp"><h4 class="grp-title">${sel.length} elements selected</h4>`;
    const kinds = [...new Set(sel.map((e) => C.kind(e.kind).name))];
    h += `<div class="kv"><span>Types</span><span>${esc(kinds.slice(0, 3).join(', '))}${kinds.length > 3 ? '…' : ''}</span></div>`;
    if (spaces.length) {
      h += `<div class="kv"><span>Total area</span><span>${esc(G.fmtArea(spaces.reduce((s, e) => s + G.area(e), 0), unit()))}</span></div>`;
      h += field('Set status', `<div class="seg" id="statusSeg">${
        C.statuses.map((s) => `<button data-status="${s.id}">${esc(s.name)}</button>`).join('')}</div>`);
    }
    h += `<div class="color-row" id="colorRow" style="margin-top:8px">
      ${C.palette.map((c) => `<button class="color-dot" data-color="${c}" style="background:${c}"></button>`).join('')}
    </div></div>`;

    h += `<div class="grp"><h4 class="grp-title">Align</h4>
      <div class="btn-row">
        <button class="mini" data-align="left" title="Align left">${iconSvg('<path d="M4 3v18M8 7h10M8 17h6"/>')}</button>
        <button class="mini" data-align="hcenter" title="Centre horizontally">${iconSvg('<path d="M12 3v18M7 7h10M9 17h6"/>')}</button>
        <button class="mini" data-align="right" title="Align right">${iconSvg('<path d="M20 3v18M6 7h10M10 17h6"/>')}</button>
      </div>
      <div class="btn-row" style="margin-top:6px">
        <button class="mini" data-align="top" title="Align top">${iconSvg('<path d="M3 4h18M7 8v10M17 8v6"/>')}</button>
        <button class="mini" data-align="vcenter" title="Centre vertically">${iconSvg('<path d="M3 12h18M7 7v10M17 9v6"/>')}</button>
        <button class="mini" data-align="bottom" title="Align bottom">${iconSvg('<path d="M3 20h18M7 6v10M17 10v6"/>')}</button>
      </div>
      <div class="btn-row" style="margin-top:6px">
        <button class="mini" data-distribute="h">Distribute across</button>
        <button class="mini" data-distribute="v">Distribute down</button>
      </div>
    </div>`;

    h += arrangeGroup(false, null);
    return h;
  }

  function arrangeGroup(isSpace, el) {
    return `<div class="grp"><h4 class="grp-title">Arrange</h4>
      <div class="btn-row">
        <button class="mini" data-act="front">Bring front</button>
        <button class="mini" data-act="back">Send back</button>
      </div>
      <div class="btn-row" style="margin-top:6px">
        <button class="mini" data-act="duplicate">Duplicate</button>
        <button class="mini danger" data-act="delete">Delete</button>
      </div>
      ${isSpace && S.scope.type === 'hall'
        ? `<button class="row-btn" data-act="enter" style="margin-top:10px">
            ${iconSvg('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>')}
            Edit booth interior</button>`
        : ''}
    </div>`;
  }

  /** One control from a field definition — the shared form primitive. */
  function renderFieldControl(f, value) {
    const id = `fld_${f.key}`;
    switch (f.type) {
      case 'textarea':
        return field(f.label, `<textarea class="inp" id="${id}" rows="3">${esc(value ?? '')}</textarea>`, f.help);
      case 'number': {
        const suffix = f.unit === 'len' ? unit() : f.unit || '';
        return field(f.label, numInput(id, value ?? '', suffix), f.help);
      }
      case 'select':
        return field(f.label, select(id, value, f.options || []), f.help);
      case 'bool':
        return `<label class="check"><input type="checkbox" id="${id}" ${value ? 'checked' : ''}/> ${esc(f.label)}</label>`;
      case 'date':
        return field(f.label, input({ id, type: 'date', value: value ?? '' }), f.help);
      case 'color':
        return '';   /* handled by the palette row */
      default:
        return field(f.label, input({ id, value: value ?? '', placeholder: f.placeholder || '' }), f.help);
    }
  }

  /* ---------- property wiring ---------- */
  function wireProps(sel) {
    const pane = $('tab-props');
    const single = sel.length === 1 ? sel[0] : null;

    /* a focus session produces exactly one undo entry */
    const live = (node, apply) => {
      let touched = false;
      node.addEventListener('focus', () => { touched = false; });
      node.addEventListener('input', () => {
        if (!touched) { FP.snapshot(); touched = true; }
        apply(node);
        FP.changed();
        R().draw();
      });
      node.addEventListener('change', () => {
        if (!touched) { FP.snapshot(); touched = true; }
        apply(node);
        FP.changed();
        R().draw();
      });
    };

    const byId = (id) => pane.querySelector(`#${id}`);

    /* exhibitor + kind fields */
    if (single) {
      const ex = byId('pExhibitor');
      if (ex) live(ex, (n) => { single.props.exhibitor = n.value; });
      const sec = byId('pSection');
      if (sec) live(sec, (n) => { single.props.section = n.value.trim(); });

      (C.kind(single.kind).fields || []).forEach((f) => {
        const node = byId(`fld_${f.key}`);
        if (!node) return;
        live(node, (n) => {
          single.props[f.key] = f.type === 'bool' ? n.checked
            : f.type === 'number' ? (n.value === '' ? '' : Number(n.value))
            : n.value;
        });
      });

      /* geometry */
      const geo = {
        gX: (v) => ({ x: v }), gY: (v) => ({ y: v }),
        gW: (v) => ({ w: Math.max(v, 0.25) }), gH: (v) => ({ h: Math.max(v, 0.25) }),
        gRot: (v) => ({ rot: v }), gR: (v) => ({ r: Math.max(v, 0.1) }),
        gTh: (v) => ({ thickness: Math.max(v, 0) }),
      };
      Object.entries(geo).forEach(([id, fn]) => {
        const node = byId(id);
        if (!node) return;
        live(node, (n) => {
          const v = Number(n.value);
          if (!isFinite(v)) return;
          Object.assign(single.geometry, fn(v));
        });
      });

      /* quick-rotate buttons: each press turns by the step (0 resets) */
      pane.querySelectorAll('[data-rot]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const step = Number(btn.dataset.rot);
          FP.snapshot();
          single.geometry.rot = step === 0 ? 0
            : (((single.geometry.rot || 0) + step) % 360 + 360) % 360;
          FP.changed();
          R().draw();
          renderProps();
        }));

      const len = byId('gLen');
      if (len) live(len, (n) => {
        const v = Number(n.value);
        const q = single.geometry;
        const cur = Math.hypot(q.x2 - q.x1, q.y2 - q.y1) || 1;
        if (!isFinite(v) || v <= 0) return;
        q.x2 = q.x1 + ((q.x2 - q.x1) / cur) * v;
        q.y2 = q.y1 + ((q.y2 - q.y1) / cur) * v;
      });

      const lock = byId('pLocked');
      if (lock) lock.addEventListener('change', () => {
        FP.snapshot(); single.props.locked = lock.checked; FP.changed(); R().draw();
      });
      const hide = byId('pHidden');
      if (hide) hide.addEventListener('change', () => {
        FP.snapshot(); single.props.hidden = hide.checked; FP.changed(); R().draw();
      });
    }

    /* status */
    pane.querySelectorAll('#statusSeg button').forEach((b) => {
      b.addEventListener('click', () => {
        FP.snapshot();
        sel.forEach((el) => { if (C.flag(el.kind, 'sellable')) el.props.status = b.dataset.status; });
        FP.changed();
        renderAll();
      });
    });

    /* colour */
    pane.querySelectorAll('#colorRow .color-dot').forEach((b) => {
      b.addEventListener('click', () => {
        FP.snapshot();
        const c = b.dataset.color || null;
        sel.forEach((el) => { el.props.color = c; });
        FP.changed();
        renderAll();
      });
    });

    /* align / distribute */
    pane.querySelectorAll('[data-align]').forEach((b) =>
      b.addEventListener('click', () => alignSelected(b.dataset.align)));
    pane.querySelectorAll('[data-distribute]').forEach((b) =>
      b.addEventListener('click', () => distributeSelected(b.dataset.distribute)));

    /* arrange actions */
    pane.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        switch (b.dataset.act) {
          case 'front': FP.setZ('front'); break;
          case 'back': FP.setZ('back'); break;
          case 'duplicate': FP.duplicateSelected(); break;
          case 'delete': {
            const n = FP.removeSelected();
            if (n) FP.toast(`Deleted ${n} item${n === 1 ? '' : 's'} — Ctrl+Z brings it back`);
            break;
          }
          case 'enter': if (single) { FP.enterScope(single.id); R().fit(); } break;
        }
        R().draw();
      });
    });

    const exit = byId('btnExitScope');
    if (exit) exit.addEventListener('click', () => { FP.exitScope(); R().fit(); });
  }

  /* ---------- align helpers ---------- */
  function alignSelected(mode) {
    const sel = FP.selected().filter((e) => !FP.isLocked(e));
    if (sel.length < 2) return;
    const box = G.bboxOfMany(sel);
    FP.snapshot();
    sel.forEach((el) => {
      const b = G.bbox(el);
      let dx = 0, dy = 0;
      if (mode === 'left') dx = box.x - b.x;
      if (mode === 'right') dx = box.x + box.w - (b.x + b.w);
      if (mode === 'hcenter') dx = box.x + box.w / 2 - (b.x + b.w / 2);
      if (mode === 'top') dy = box.y - b.y;
      if (mode === 'bottom') dy = box.y + box.h - (b.y + b.h);
      if (mode === 'vcenter') dy = box.y + box.h / 2 - (b.y + b.h / 2);
      FP.moveElementDeep(el, dx, dy);
    });
    FP.changed();
    R().draw();
  }

  function distributeSelected(axis) {
    const sel = FP.selected().filter((e) => !FP.isLocked(e));
    if (sel.length < 3) return FP.toast('Select at least three elements');
    const key = axis === 'h' ? 'x' : 'y';
    const size = axis === 'h' ? 'w' : 'h';
    const sorted = sel.map((el) => ({ el, b: G.bbox(el) })).sort((a, b) => a.b[key] - b.b[key]);
    const first = sorted[0].b, last = sorted[sorted.length - 1].b;
    const span = (last[key] + last[size]) - first[key];
    const total = sorted.reduce((s, o) => s + o.b[size], 0);
    const gap = (span - total) / (sorted.length - 1);
    FP.snapshot();
    let cursor = first[key];
    sorted.forEach(({ el, b }) => {
      const d = cursor - b[key];
      FP.moveElementDeep(el, axis === 'h' ? d : 0, axis === 'h' ? 0 : d);
      cursor += b[size] + gap;
    });
    FP.changed();
    R().draw();
  }

  /* ============================================================
     Inspector — Booths
     ============================================================ */
  function renderBooths() {
    const pane = $('tab-booths');
    const st = FP.stats();
    const all = FP.spaces();
    const q = (S.filter || '').trim().toLowerCase();
    const list = all.filter((s) =>
      !q || String(s.props.number || '').toLowerCase().includes(q)
        || (s.props.exhibitor || '').toLowerCase().includes(q));

    let h = `<div class="stat-grid">
      <div class="stat accent"><b>${st.total}</b><span>Spaces</span></div>
      <div class="stat ok"><b>${st.complete}</b><span>Complete</span></div>
      <div class="stat warn"><b>${st.outstanding}</b><span>Outstanding</span></div>
      <div class="stat"><b>${Math.round(st.utilization * 100)}%</b><span>Floor used</span></div>
    </div>`;

    /* Colour by any property instead of highlighting booths by hand —
       this is the panel that replaces the felt pen on the working plans. */
    const mode = C.colorMode(S.colorBy || 'status');
    h += `<div class="grp">
      <h4 class="grp-title">Colour booths by</h4>
      <select class="inp" id="colorByMode">
        ${C.colorModes.map((m) =>
          `<option value="${m.id}"${m.id === mode.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}
      </select>
      <div class="legend-row" id="colorByLegend">${colorByLegendHtml(mode)}</div>
    </div>`;

    h += `<div class="list-tools">
      ${input({ id: 'boothSearch', value: S.filter || '', placeholder: 'Filter by number or exhibitor' })}
    </div>`;

    if (!all.length) {
      h += `<div class="empty">${iconSvg('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9h18"/>')}
        No spaces yet.<br/>Draw one with <kbd>B</kbd> or generate a block.</div>`;
    } else {
      h += `<div class="blist">${list.map(boothRow).join('')}</div>`;
      if (!list.length) h += `<div class="empty">Nothing matches that filter.</div>`;
    }
    pane.innerHTML = h;

    $('colorByMode')?.addEventListener('change', (ev) => {
      S.colorBy = ev.target.value;
      FP.setPref('colorBy', S.colorBy);
      $('colorByLegend').innerHTML = colorByLegendHtml(C.colorMode(S.colorBy));
      R().draw();
    });

    const search = $('boothSearch');
    if (search) {
      search.addEventListener('input', () => {
        S.filter = search.value;
        renderBooths();
        $('boothSearch').focus();
        $('boothSearch').setSelectionRange(999, 999);
      });
    }
    pane.querySelectorAll('.bitem').forEach((row) => {
      row.addEventListener('click', () => {
        const el = FP.get(row.dataset.id);
        if (!el) return;
        if (S.scope.type === 'booth') FP.exitScope();
        FP.select([el.id]);
        R().centerOn(G.bbox(el));
        setTab('props');
      });
      row.addEventListener('dblclick', () => {
        FP.enterScope(row.dataset.id);
        R().fit();
      });
    });
  }

  /** Legend chips for whichever colour-by mode is active. */
  function colorByLegendHtml(mode) {
    const chip = (color, label) =>
      `<span class="lg-chip"><i style="background:${color}"></i>${esc(label)}</span>`;

    if (mode.id === 'status') {
      return C.statuses.map((s) => chip(s.color, s.name)).join('');
    }
    if (mode.id === 'section') {
      const counts = {};
      FP.spaces().forEach((s) => {
        const name = String(s.props.section || '').trim();
        if (name) counts[name] = (counts[name] || 0) + 1;
      });
      const names = Object.keys(counts).sort();
      if (!names.length) return chip('#e2e8f0', 'No sections yet — set one on any booth');
      return names.map((n) => chip(C.sectionColor(n), `${n} — ${counts[n]}`)).join('');
    }
    if (mode.buckets) {
      return mode.buckets.map((b) => chip(b.color, b.name)).join('');
    }
    if (mode.values) {
      return Object.entries(mode.values).map(([key, color]) => {
        const label = mode.id === 'type' ? C.spaceType(key).name
          : key === 'yes' ? 'Submitted' : key === 'no' ? 'Not submitted'
          : key.charAt(0).toUpperCase() + key.slice(1);
        return chip(color, label);
      }).join('');
    }
    return '';
  }

  function boothRow(s) {
    const status = C.status(s.props.status);
    const q = s.geometry;
    return `<div class="bitem${FP.isSelected(s.id) ? ' sel' : ''}" data-id="${s.id}">
      <span class="tag">${esc(s.props.number || '—')}</span>
      <span class="meta">
        <b>${esc(s.props.exhibitor || 'Unassigned')}</b>
        <span>${esc(G.fmtDims(q.w, q.h, unit()))} · ${esc(C.spaceType(s.props.spaceType).name)}</span>
      </span>
      <span class="pill" style="background:${status.color}22;color:${status.color}">${esc(status.name)}</span>
    </div>`;
  }

  /* ============================================================
     Inspector — Safety
     ============================================================ */
  function renderSafety() {
    const pane = $('tab-safety');
    const issues = S.issues || [];
    const counts = FP.rules.counts(issues);

    let h = `<div class="stat-grid">
      <div class="stat ${counts.error ? '' : 'ok'}"><b style="${counts.error ? 'color:var(--err)' : ''}">${counts.error}</b><span>Errors</span></div>
      <div class="stat"><b style="${counts.warning ? 'color:var(--warn)' : ''}">${counts.warning}</b><span>Warnings</span></div>
    </div>`;

    if (!issues.length) {
      h += `<div class="all-clear">
        ${iconSvg('<path d="M20 6 9 17l-5-5"/>')}
        <b>All checks pass</b>
        <span>Every active rule is satisfied by the current plan.</span>
      </div>`;
    } else {
      h += issues.map((i, idx) => `<div class="issue ${i.severity}" data-issue="${idx}">
        ${iconSvg(i.severity === 'error'
          ? '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16h.01"/>'
          : '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>', 'ico')}
        <span class="txt"><b>${esc(i.message)}</b><span>${esc(i.detail)}</span></span>
      </div>`).join('');
    }

    h += `<div class="grp" style="margin-top:18px"><h4 class="grp-title">Rule settings</h4>
      <div class="helptext">This is configuration, not a live report — the dropdown sets what
      a rule becomes <i>if</i> it's ever broken (error / warning / just a note). It doesn't mean
      anything is broken now; check the pass/fail summary above for that. Turn a rule off, or
      change its thresholds, per show — the same set runs in the exhibitor portal later.</div>
      ${FP.rules.records().map(ruleRow).join('')}
      <button class="mini" id="btnResetRules" style="width:100%;margin-top:8px">Reset to defaults</button>
    </div>`;

    pane.innerHTML = h;

    pane.querySelectorAll('[data-issue]').forEach((node) => {
      node.addEventListener('click', () => {
        const issue = issues[Number(node.dataset.issue)];
        const els = issue.ids.map(FP.get).filter(Boolean);
        if (!els.length) return;
        if (S.scope.type === 'booth') FP.exitScope();
        FP.select(els.map((e) => e.id));
        FP.zoomToElements ? FP.zoomToElements(els) : R().fit(G.bboxOfMany(els), 120);
      });
    });

    pane.querySelectorAll('[data-rule]').forEach((node) => {
      node.addEventListener('change', () => {
        const id = node.dataset.rule;
        if (node.type === 'checkbox') FP.rules.setOverride(id, { enabled: node.checked });
        else if (node.dataset.param) {
          FP.rules.setOverride(id, { params: { [node.dataset.param]: Number(node.value) } });
        } else {
          FP.rules.setOverride(id, { severity: node.value });
        }
        FP.changed();
        renderAll();
        R().draw();
      });
    });

    const reset = $('btnResetRules');
    if (reset) reset.addEventListener('click', () => {
      FP.snapshot(); FP.plan.ruleConfig = {}; FP.changed(); renderAll(); R().draw();
    });
  }

  function ruleRow(r) {
    const numericParams = Object.entries(r.params || {})
      .filter(([, v]) => typeof v === 'number');
    return `<div class="layer" style="align-items:flex-start;flex-wrap:wrap">
      <input type="checkbox" data-rule="${r.id}" ${r.enabled ? 'checked' : ''}
        style="accent-color:var(--accent);margin-top:3px"/>
      <span class="nm" style="flex:1 1 120px">${esc(r.name)}</span>
      <select class="inp" data-rule="${r.id}" title="Severity if this rule is ever broken — not its current status"
        style="width:88px;padding:3px 6px;font-size:11px">
        ${['error', 'warning', 'info'].map((s) =>
          `<option value="${s}"${r.severity === s ? ' selected' : ''}>${s}</option>`).join('')}
      </select>
      ${numericParams.map(([key, v]) => `<label style="display:flex;align-items:center;gap:5px;
        font-size:10.5px;color:var(--tx-3);width:100%;padding-left:22px">
        ${esc(key)}
        <input class="inp num" type="number" step="any" data-rule="${r.id}" data-param="${key}"
          value="${v}" style="width:70px;padding:3px 6px"/></label>`).join('')}
    </div>`;
  }

  /* ============================================================
     Inspector — Plan
     ============================================================ */
  function renderPlan() {
    const p = FP.plan;
    const st = FP.stats();
    let h = '';

    h += `<div class="grp"><h4 class="grp-title">Show</h4>
      ${field('Venue', input({ id: 'planVenue', value: p.venue || '', placeholder: 'Convention centre' }))}
      ${field('Hall', input({ id: 'planHall', value: p.hall || '', placeholder: 'Hall B' }))}
      <div class="row2">
        ${field('Load-in', input({ id: 'dLoadIn', type: 'date', value: p.dates.loadIn || '' }))}
        ${field('Show opens', input({ id: 'dOpen', type: 'date', value: p.dates.open || '' }))}
      </div>
      <div class="row2">
        ${field('Teardown', input({ id: 'dTeardown', type: 'date', value: p.dates.teardown || '' }))}
        ${field('Submission deadline', input({ id: 'dDeadline', type: 'date', value: p.dates.deadline || '' }))}
      </div>
    </div>`;

    h += `<div class="grp"><h4 class="grp-title">Hall</h4>
      <div class="row2">
        ${field('Width', numInput('planW', p.width, unit()))}
        ${field('Depth', numInput('planH', p.height, unit()))}
      </div>
      <div class="row2">
        ${field('Grid', numInput('planGrid', p.grid, unit()))}
        ${field('Units', select('planUnit', p.unit, [['ft', 'Feet'], ['m', 'Metres']]))}
      </div>
      <div class="kv"><span>Floor area</span><span>${esc(G.fmtArea(st.hall, unit()))}</span></div>
      <div class="kv"><span>Sellable</span><span>${esc(G.fmtArea(st.sellable, unit()))}</span></div>
      <div class="kv"><span>Dead space</span><span>${esc(G.fmtArea(st.dead, unit()))}</span></div>
      <div class="kv"><span>Utilisation</span><span>${Math.round(st.utilization * 100)}%</span></div>
    </div>`;

    h += `<div class="grp"><h4 class="grp-title">Layers</h4>
      ${C.layers.map((l) => {
        const state = p.layers[l.id] || { visible: true, locked: false };
        const count = p.elements.filter((e) => e.layer === l.id).length;
        return `<div class="layer">
          <button class="eye${state.visible ? '' : ' off'}" data-layer="${l.id}" data-op="visible"
            title="Show / hide">${iconSvg(state.visible
              ? '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'
              : '<path d="M3 3l18 18M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.3 6.4A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4-.8"/>')}
          </button>
          <span class="nm">${esc(l.name)}</span>
          <span class="ct">${count}</span>
          <button class="eye${state.locked ? '' : ' off'}" data-layer="${l.id}" data-op="locked"
            title="Lock / unlock">${iconSvg(state.locked
              ? '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'
              : '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2.6"/>')}
          </button>
        </div>`;
      }).join('')}
    </div>`;

    const ul = FP.getUnderlay();
    const where = S.scope.type === 'booth'
      ? `Booth ${esc(FP.scopeSpace()?.props.number || '')}` : 'the hall';

    if (ul?.src) {
      h += `<div class="grp"><h4 class="grp-title">Reference image</h4>
        <div class="calib ${ul.calibrated ? 'done' : 'todo'}">
          ${iconSvg(ul.calibrated
            ? '<path d="M20 6 9 17l-5-5"/>'
            : '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>')}
          <div>
            <b>${ul.calibrated ? 'Scaled to real dimensions' : 'Not yet scaled'}</b>
            <span>${ul.calibrated
              ? 'Locked so tracing cannot nudge it.'
              : 'Drag across something whose real length you know.'}</span>
          </div>
        </div>
        <button class="mini" id="btnCalibrate" style="width:100%;margin-bottom:8px">
          ${iconSvg('<path d="M3 8v8M21 8v8M3 12h18M8 10v4M13 10v4M18 10v4"/>')}
          ${ul.calibrated ? 'Re-calibrate scale' : 'Calibrate scale…'}
        </button>
        ${field('Opacity', `<input class="inp" id="ulOpacity" type="range" min="0" max="1" step="0.05"
          value="${ul.opacity ?? 0.5}"/>`)}
        <div class="row2">
          ${field('Width', numInput('ulW', G.round(ul.w, 1), unit(), ul.locked ? 'disabled' : ''))}
          ${field('Height', numInput('ulH', G.round(ul.h, 1), unit(), ul.locked ? 'disabled' : ''))}
        </div>
        <div class="row2">
          ${field('X', numInput('ulX', G.round(ul.x, 1), unit(), ul.locked ? 'disabled' : ''))}
          ${field('Y', numInput('ulY', G.round(ul.y, 1), unit(), ul.locked ? 'disabled' : ''))}
        </div>
        ${field('Rotation', numInput('ulRot', G.round(ul.rot || 0, 1), 'deg', ul.locked ? 'disabled' : ''))}
        <label class="check"><input type="checkbox" id="ulLock" ${ul.locked ? 'checked' : ''}/>
          Lock image</label>
        <button class="mini danger" id="btnRemoveUnderlay" style="width:100%;margin-top:6px">Remove image</button>
      </div>`;
    } else {
      h += `<div class="grp"><h4 class="grp-title">Reference image</h4>
        <p class="helptext">Trace an existing drawing for ${where}. Import it, then
          calibrate against a known dimension so everything you draw on top is to scale.</p>
        <button class="mini" id="btnAddUnderlay" style="width:100%">Import image…</button>
      </div>`;
    }

    h += `<div class="grp"><h4 class="grp-title">Danger zone</h4>
      <div class="btn-row">
        <button class="mini" id="btnClearPlan">Clear all elements</button>
      </div></div>`;

    $('tab-plan').innerHTML = h;
    wirePlan();
  }

  function wirePlan() {
    const p = FP.plan;
    const pane = $('tab-plan');
    const bind = (id, apply) => {
      const node = pane.querySelector(`#${id}`);
      if (!node) return;
      let touched = false;
      node.addEventListener('focus', () => { touched = false; });
      const run = () => {
        if (!touched) { FP.snapshot(); touched = true; }
        apply(node);
        FP.changed();
        R().draw();
      };
      node.addEventListener('input', run);
      node.addEventListener('change', run);
    };

    bind('planVenue', (n) => { p.venue = n.value; });
    bind('planHall', (n) => { p.hall = n.value; });
    bind('dLoadIn', (n) => { p.dates.loadIn = n.value; });
    bind('dOpen', (n) => { p.dates.open = n.value; });
    bind('dTeardown', (n) => { p.dates.teardown = n.value; });
    bind('dDeadline', (n) => { p.dates.deadline = n.value; });
    bind('planW', (n) => { p.width = Math.max(Number(n.value) || 1, 1); });
    bind('planH', (n) => { p.height = Math.max(Number(n.value) || 1, 1); });
    bind('planGrid', (n) => { p.grid = Math.max(Number(n.value) || 1, 0.25); });
    bind('planUnit', (n) => { p.unit = n.value; });
    /* Underlay edits go through FP.getUnderlay so they land on whichever
       scope is being traced — the hall's image or the booth's own. */
    const u = () => FP.getUnderlay();
    bind('ulOpacity', (n) => { u().opacity = Number(n.value); });
    bind('ulW',   (n) => { u().w = Number(n.value) || u().w; });
    bind('ulH',   (n) => { u().h = Number(n.value) || u().h; });
    bind('ulX',   (n) => { u().x = Number(n.value) || 0; });
    bind('ulY',   (n) => { u().y = Number(n.value) || 0; });
    bind('ulRot', (n) => { u().rot = Number(n.value) || 0; });

    const lock = pane.querySelector('#ulLock');
    if (lock) lock.addEventListener('change', () => {
      FP.snapshot(); u().locked = lock.checked; FP.changed(); renderPlan();
    });

    const calib = pane.querySelector('#btnCalibrate');
    if (calib) calib.addEventListener('click', startCalibration);

    const addUl = pane.querySelector('#btnAddUnderlay');
    if (addUl) addUl.addEventListener('click', importUnderlay);

    pane.querySelectorAll('[data-layer]').forEach((b) => {
      b.addEventListener('click', () => {
        const l = p.layers[b.dataset.layer];
        if (!l) return;
        FP.snapshot();
        l[b.dataset.op] = !l[b.dataset.op];
        FP.changed();
        renderPlan();
        R().draw();
      });
    });

    const rm = pane.querySelector('#btnRemoveUnderlay');
    if (rm) rm.addEventListener('click', () => {
      FP.snapshot(); FP.setUnderlay(null); FP.changed(); renderPlan(); R().draw();
    });

    const clear = pane.querySelector('#btnClearPlan');
    if (clear) clear.addEventListener('click', () => {
      confirmModal('Clear all elements?',
        'Every element on this plan is removed. The show details and hall size stay. This can be undone.',
        () => {
          FP.snapshot();
          p.elements = [];
          S.selection = [];
          S.scope = { type: 'hall', spaceId: null };
          FP.changed();
          renderAll();
          R().draw();
        });
    });
  }

  function confirmModal(title, body, onYes, yesLabel = 'Confirm') {
    FP.modal({
      title,
      body: `<p class="helptext" style="margin:0">${esc(body)}</p>`,
      foot: `<button class="btn ghost" data-no>Cancel</button>
             <button class="btn danger" data-yes>${esc(yesLabel)}</button>`,
      onMount: (_b, foot) => {
        foot.querySelector('[data-no]').onclick = FP.closeModal;
        foot.querySelector('[data-yes]').onclick = () => { FP.closeModal(); onYes(); };
      },
    });
  }
  FP.confirmModal = confirmModal;

  /* ============================================================
     Bulk tools
     ============================================================ */
  function boothBlockModal() {
    const p = FP.plan;
    FP.modal({
      title: 'Generate booth block',
      body: `<p class="helptext">Lays out a grid of spaces with aisles between them, numbered
        as it goes. Everything it makes is ordinary elements you can edit afterwards.</p>
        <div class="row2">
          ${field('Columns', numInput('bCols', 6))}
          ${field('Rows', numInput('bRows', 2))}
        </div>
        <div class="row2">
          ${field('Booth width', numInput('bW', 10, unit()))}
          ${field('Booth depth', numInput('bH', 10, unit()))}
        </div>
        <div class="row2">
          ${field('Aisle between columns', numInput('bGx', 0, unit()))}
          ${field('Aisle between rows', numInput('bGy', 10, unit()))}
        </div>
        <div class="row2">
          ${field('Start X', numInput('bX', 20, unit()))}
          ${field('Start Y', numInput('bY', 20, unit()))}
        </div>
        <div class="row2">
          ${field('First number', input({ id: 'bNum', value: String(p.nextSpaceNo) }))}
          ${field('Space type', select('bType', 'inline',
            C.spaceTypes.map((t) => [t.id, t.name])))}
        </div>
        ${field('Numbering', select('bOrder', 'row', [
          ['row', 'Left to right, row by row'],
          ['col', 'Top to bottom, column by column'],
          ['boustro', 'Serpentine (left, then right)'],
        ]))}`,
      foot: `<button class="btn ghost" data-no>Cancel</button>
             <button class="btn primary" data-yes>Generate</button>`,
      onMount: (body, foot) => {
        foot.querySelector('[data-no]').onclick = FP.closeModal;
        foot.querySelector('[data-yes]').onclick = () => {
          const v = (id) => Number(body.querySelector(`#${id}`).value);
          const cols = Math.max(1, Math.round(v('bCols')));
          const rows = Math.max(1, Math.round(v('bRows')));
          const w = v('bW'), h = v('bH');
          const gx = v('bGx'), gy = v('bGy');
          const x0 = v('bX'), y0 = v('bY');
          const startNo = parseInt(body.querySelector('#bNum').value, 10) || 101;
          const type = body.querySelector('#bType').value;
          const order = body.querySelector('#bOrder').value;

          const cells = [];
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) cells.push({ r, c });
          }
          cells.sort((a, b) => {
            if (order === 'col') return a.c - b.c || a.r - b.r;
            if (order === 'boustro') {
              if (a.r !== b.r) return a.r - b.r;
              return a.r % 2 ? b.c - a.c : a.c - b.c;
            }
            return a.r - b.r || a.c - b.c;
          });

          const els = cells.map((cell, i) => {
            const el = FP.makeElement('space', {
              x: x0 + cell.c * (w + gx),
              y: y0 + cell.r * (h + gy),
              w, h,
            });
            el.props.number = String(startNo + i);
            el.props.spaceType = type;
            return el;
          });
          FP.plan.nextSpaceNo = startNo + els.length;
          FP.closeModal();
          FP.addElements(els);
          R().draw();
          FP.toast(`Generated ${els.length} spaces`);
        };
      },
    });
  }

  function autoNumberModal() {
    const spaces = FP.spaces();
    if (!spaces.length) return FP.toast('No spaces to number', true);
    FP.modal({
      title: 'Number spaces',
      body: `<p class="helptext">Renumbers ${spaces.length} spaces. Existing numbers are replaced.</p>
        ${field('Method', select('anMethod', 'aisle', [
          ['aisle', 'Aisle numbering — hundreds = aisle, odd/even by side'],
          ['reading', 'Reading order — simple sweep'],
        ]))}

        <div id="anAisleFields">
          <div class="row2">
            ${field('First aisle', numInput('aaStart', 1))}
            ${field('Increment', numInput('aaStep', 2))}
          </div>
          ${field('Even numbers on', select('aaSide', 'far', [
            ['far', 'Far side of each aisle'],
            ['near', 'Near side of each aisle'],
          ]))}
          <p class="helptext" style="margin-top:6px">Two rows facing each other across
            an aisle share one hundred-block — e.g. 200/202/204 opposite 201/203/205.
            Rows that only back onto each other (no aisle between them) get separate
            blocks. This matches how the floor is numbered on-site.</p>
        </div>

        <div id="anReadingFields" style="display:none">
          <div class="row2">
            ${field('Prefix', input({ id: 'anPrefix', value: '', placeholder: 'e.g. A' }))}
            ${field('Start at', numInput('anStart', 101))}
          </div>
          <div class="row2">
            ${field('Increment', numInput('anStep', 1))}
            ${field('Row tolerance', numInput('anTol', 5, unit()))}
          </div>
          ${field('Sweep', select('anOrder', 'row', [
            ['row', 'Rows, left to right'],
            ['boustro', 'Rows, serpentine'],
            ['col', 'Columns, top to bottom'],
          ]))}
        </div>`,
      foot: `<button class="btn ghost" data-no>Cancel</button>
             <button class="btn primary" data-yes>Renumber</button>`,
      onMount: (body, foot) => {
        const methodSel = body.querySelector('#anMethod');
        const syncMethod = () => {
          const aisle = methodSel.value === 'aisle';
          body.querySelector('#anAisleFields').style.display = aisle ? '' : 'none';
          body.querySelector('#anReadingFields').style.display = aisle ? 'none' : '';
        };
        methodSel.addEventListener('change', syncMethod);
        syncMethod();

        foot.querySelector('[data-no]').onclick = FP.closeModal;
        foot.querySelector('[data-yes]').onclick = () => {
          let count;

          if (methodSel.value === 'aisle') {
            count = FP.interact.aisleNumber({
              startAisle: parseInt(body.querySelector('#aaStart').value, 10) || 1,
              step: parseInt(body.querySelector('#aaStep').value, 10) || 2,
              evenSide: body.querySelector('#aaSide').value,
            });
          } else {
            const prefix = body.querySelector('#anPrefix').value;
            const start = parseInt(body.querySelector('#anStart').value, 10) || 1;
            const inc = parseInt(body.querySelector('#anStep').value, 10) || 1;
            const tol = Number(body.querySelector('#anTol').value) || 5;
            const order = body.querySelector('#anOrder').value;

            const rows = [];
            spaces.map((s) => ({ s, b: G.bbox(s) }))
              .sort((a, b) => a.b.y - b.b.y)
              .forEach((item) => {
                const row = rows.find((r) => Math.abs(r.y - item.b.y) <= tol);
                if (row) row.items.push(item);
                else rows.push({ y: item.b.y, items: [item] });
              });

            let ordered = [];
            if (order === 'col') {
              ordered = spaces.map((s) => ({ s, b: G.bbox(s) }))
                .sort((a, b) => a.b.x - b.b.x || a.b.y - b.b.y);
            } else {
              rows.forEach((r, i) => {
                r.items.sort((a, b) => a.b.x - b.b.x);
                if (order === 'boustro' && i % 2) r.items.reverse();
                ordered.push(...r.items);
              });
            }

            FP.snapshot();
            ordered.forEach((item, i) => { item.s.props.number = `${prefix}${start + i * inc}`; });
            FP.plan.nextSpaceNo = start + ordered.length * inc;
            FP.changed();
            count = ordered.length;
          }

          FP.closeModal();
          renderAll();
          R().draw();
          FP.toast(`Renumbered ${count} space${count === 1 ? '' : 's'}`);
        };
      },
    });
  }

  /* ============================================================
     Photo → plan.

     Workers photograph venues on site; those photos become the template
     a real plan is traced from. The guide below is the field manual for
     what to shoot, shown every time so the photos arrive usable.
     ============================================================ */
  function importUnderlay() {
    FP.modal({
      title: 'Import a venue photo or floor plan',
      body: `
        <p class="helptext">The image becomes a temporary template under the plan.
          You scale it, trace the real walls and structure over it, then remove
          the photo — leaving a clean, editable floor plan.</p>

        <div class="grp">
          <h4 class="grp-title">Taking the photo at the venue</h4>
          <div class="kv"><span>1 · Best source</span><span style="font-family:var(--font)">The venue's posted floor plan or fire-evacuation placard — every hall has one</span></div>
          <div class="kv"><span>2 · Straight on</span><span style="font-family:var(--font)">Face it square, whole sheet in frame, no angle, no glare</span></div>
          <div class="kv"><span>3 · One known length</span><span style="font-family:var(--font)">Note a real measurement — a double door is 6 ft, or pace out one wall</span></div>
          <div class="kv"><span>4 · No placard?</span><span style="font-family:var(--font)">Shoot the whole floor from a balcony or mezzanine, as high and centred as you can</span></div>
        </div>

        <p class="helptext">Angled shots skew the trace — if the photo looks like a
          parallelogram, retake it. PDFs work too: screenshot the page first.</p>

        ${FP.auth?.canEdit?.() ? `
        <div class="grp">
          <h4 class="grp-title">Or: convert it automatically with AI</h4>
          <p class="helptext" style="margin:0 0 6px">Skip the tracing — Claude reads the
            photo and draws the plan for you: walls, doors, numbered booths, and zones
            arrive as real, editable elements you fine-tune instead of redraw.</p>
          <button class="mini" data-ai style="width:100%">Convert photo with AI…</button>
        </div>` : ''}

        <div class="grp">
          <h4 class="grp-title">Or: scan the room with an iPhone (LiDAR)</h4>
          <p class="helptext" style="margin:0 0 6px">On a LiDAR iPhone (12 Pro or newer
            Pro/Max), scan the room with any RoomPlan-based scanner app and export the
            scan as <b>JSON</b>. Import it here and the walls, doors, and furniture are
            rebuilt as real plan elements at true dimensions — no tracing, no scaling.</p>
          <button class="mini" data-lidar style="width:100%">Import LiDAR scan (.json)…</button>
        </div>`,
      foot: `<button class="btn ghost" data-no>Cancel</button>
             <button class="btn primary" data-pick>Choose photo…</button>`,
      onMount: (body, foot) => {
        foot.querySelector('[data-no]').onclick = FP.closeModal;
        foot.querySelector('[data-pick]').onclick = () => {
          FP.closeModal();
          pickUnderlayFile();
        };
        body.querySelector('[data-lidar]').onclick = () => {
          FP.closeModal();
          pickLidarFile();
        };
        const ai = body.querySelector('[data-ai]');
        if (ai) ai.onclick = () => {
          FP.closeModal();
          pickAiFile();
        };
      },
    });
  }

  /* ------------------------------------------------------------
     AI conversion — photo in, editable plan out.

     The picker feeds a confirmation modal rather than converting
     immediately: the one thing that meaningfully improves the result
     is a known hall width, so we ask for it while the upload is still
     a click away. The conversion itself runs in photoplan.js.
     ------------------------------------------------------------ */
  function pickAiFile() {
    const picker = $('filePicker');
    picker.accept = 'image/*';
    picker.value = '';
    picker.onchange = () => {
      const file = picker.files[0];
      if (file) aiConvertModal(file);
    };
    picker.click();
  }

  function aiConvertModal(file) {
    FP.modal({
      title: 'Convert photo with AI',
      body: `
        <p class="helptext">Claude reads <b>${esc(file.name)}</b> and draws the plan
          as real, editable elements — walls, doors, numbered booths, zones. Review
          and fine-tune afterwards; one undo removes the whole import.</p>
        <div class="field"><label>Hall width in feet (optional — locks the scale)</label>
          <input class="inp num" id="aiWidthHint" type="number" min="10" step="5" placeholder="e.g. 200"/></div>
        <p class="helptext" id="aiStatus" style="min-height:18px;margin-top:8px"></p>`,
      foot: `<button class="btn ghost" data-no>Cancel</button>
             <button class="btn primary" data-go>Convert</button>`,
      onMount: (body, foot) => {
        const status = body.querySelector('#aiStatus');
        const go = foot.querySelector('[data-go]');
        foot.querySelector('[data-no]').onclick = FP.closeModal;
        go.onclick = async () => {
          const widthHint = Number(body.querySelector('#aiWidthHint').value) || 0;
          go.disabled = true;
          go.textContent = 'Converting…';
          const made = await FP.photoplan.convert(file, {
            widthHint,
            onStatus: (m) => { status.textContent = m; },
          });
          if (made.error) {
            go.disabled = false;
            go.textContent = 'Convert';
            status.textContent = '';
            return FP.toast(made.error, true);
          }
          FP.closeModal();
          renderAll();
          R().fit();
          R().draw();
          FP.toast(`AI plan imported — ${made.booths} booths, ${made.walls} walls, `
                 + `${made.doors} doors, ${made.zones} zones. Check the scale, then tweak away.`);
          archivePlanPhoto(file);
        };
      },
    });
  }

  function pickLidarFile() {
    const picker = $('filePicker');
    picker.accept = '.json,application/json';
    picker.value = '';
    picker.onchange = () => {
      const file = picker.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const made = FP.importRoomPlan(reader.result);
        if (made.error) return FP.toast(made.error, true);
        renderAll();
        R().fit();
        R().draw();
        FP.toast(`Scan imported — ${made.walls} walls, ${made.doors} doors, `
               + `${made.objects} furniture pieces at true size`);
        archivePlanPhoto(file);
      };
      reader.readAsText(file);
    };
    picker.click();
  }

  function pickUnderlayFile() {
    const picker = $('filePicker');
    picker.accept = 'image/*';
    picker.value = '';
    picker.onchange = () => {
      const file = picker.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          /* Drop it over whatever we are tracing — the hall, or the booth
             footprint if a booth interior is open — then calibrate. */
          const sp = FP.scopeSpace();
          const box = sp
            ? G.bbox(sp)
            : { x: 0, y: 0, w: FP.plan.width, h: FP.plan.height };
          const ratio = img.height / img.width;

          FP.snapshot();
          FP.setUnderlay({
            src: reader.result,
            x: box.x, y: box.y,
            w: box.w, h: box.w * ratio,
            rot: 0, opacity: 0.5, locked: false, calibrated: false,
          });
          FP.changed();
          renderAll();
          R().draw();
          FP.toast('Image placed — now calibrate it against a known dimension');
          startCalibration();
          archivePlanPhoto(file);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    };
    picker.click();
  }

  /* Every venue photo imported into a cloud plan is also archived to the
     plan's photo library in storage (visible on the dashboard), so the
     original shot survives after the underlay is removed. Fire-and-forget:
     a failed archive must never block the tracing workflow. */
  async function archivePlanPhoto(file) {
    try {
      const sb = FP.auth?.client?.();
      if (!sb || !FP.auth.signedIn() || FP.storeId?.() !== 'supabase' || !FP.plan?.id) return;
      const { data: show } = await sb.from('show')
        .select('client_id').eq('id', FP.plan.id).maybeSingle();
      const folder = `${show?.client_id || 'internal'}/${FP.plan.id}`;
      const path = `${folder}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
      const { error } = await sb.storage.from('plan-photos').upload(path, file);
      if (!error) FP.toast('Photo saved to this plan’s library');
    } catch { /* archive is best-effort */ }
  }

  /* ============================================================
     Scale calibration

     Importing a drawing is only useful if what you trace comes out at
     real dimensions. Drag across something whose length you know — a
     door, a column bay, a printed dimension — and the image is scaled
     to match, holding the start of the drag fixed.
     ============================================================ */
  function startCalibration() {
    const ul = FP.getUnderlay();
    if (!ul?.src) return FP.toast('Import a reference image first', true);
    if (ul.locked) {
      /* Re-calibrating has to be able to move it. */
      ul.locked = false;
    }
    FP.setTool('calibrate');
    FP.toast('Drag across a dimension you know the real length of');
  }

  function fillRegionDialog(region) {
    const rows = Math.max(1, Math.floor((region.h + 10) / 30));
    const cols = Math.max(1, Math.floor(region.w / 10));
    FP.modal({
      title: 'Fill area with booths',
      body: `<p class="helptext">Lays booths into the dragged area on the standard
        module — shoulder to shoulder along the run, back-to-back in pairs across
        it, with an aisle after each pair. About ${cols * rows * 2} booths will fit
        this area at the defaults below.</p>
        <div class="row2">
          ${field('Booth width', numInput('frW', 10, unit()))}
          ${field('Booth depth', numInput('frH', 10, unit()))}
        </div>
        <div class="row2">
          ${field('Aisle width', numInput('frAisle', 10, unit()))}
          ${field('Direction', select('frAxis', 'h', [['h', 'Rows run left–right'], ['v', 'Rows run top–bottom']]))}
        </div>
        ${field('Space type', select('frType', 'inline', C.spaceTypes.map((t) => [t.id, t.name])))}`,
      foot: `<button class="btn ghost" data-no>Cancel</button>
             <button class="btn primary" data-yes>Fill</button>`,
      onMount: (body, foot) => {
        foot.querySelector('[data-no]').onclick = FP.closeModal;
        foot.querySelector('[data-yes]').onclick = () => {
          const v = (id) => Number(body.querySelector(`#${id}`).value);
          const made = FP.interact.fillRegion(region, {
            boothW: v('frW') || 10, boothH: v('frH') || 10,
            aisle: v('frAisle') || 10,
            axis: body.querySelector('#frAxis').value,
            spaceType: body.querySelector('#frType').value,
          });
          FP.closeModal();
          /* Stays armed, like every other placement tool — drag another
             region straight away without re-clicking Fill. */
          renderAll();
          R().draw();
          FP.toast(made.length ? `${made.length} spaces created` : 'Area too small for that booth size');
        };
      },
    });
  }

  function calibrationDialog({ x, y, drawn }) {
    const u = unit();
    FP.modal({
      title: 'Set the real length',
      body: `<p class="helptext">You drew <b>${esc(G.fmtLen(drawn, u))}</b> at the current
          image scale. Enter what that distance actually measures and the image is
          resized to match — the point where you started the drag stays put.</p>
        ${field(`Real length (${u})`, numInput('calReal', G.round(drawn, 2), u, 'min="0.01"'))}
        <p class="helptext" style="margin-top:10px">Tip: a standard double door is 6 ft,
          and a column bay is usually a round number. Use the longest known run you can
          — a longer reference gives a more accurate scale.</p>`,
      foot: `<button class="btn ghost" data-cancel>Cancel</button>
             <button class="btn primary" data-ok>Apply scale</button>`,
      onMount: (body, foot) => {
        const input = body.querySelector('#calReal');
        const apply = () => {
          const real = Number(input.value);
          if (!real || real <= 0) return FP.toast('Enter a length greater than zero', true);
          const scale = FP.calibrateUnderlay(x, y, drawn, real);
          FP.closeModal();
          FP.setTool('select');
          renderAll();
          R().draw();
          FP.toast(scale
            ? `Image scaled ${scale > 1 ? 'up' : 'down'} ${scale.toFixed(3)}× and locked`
            : 'Could not calibrate');
        };
        foot.querySelector('[data-ok]').onclick = apply;
        foot.querySelector('[data-cancel]').onclick = () => {
          FP.closeModal();
          FP.setTool('select');
          R().draw();
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
        input.select();
      },
    });
  }

  /* ============================================================
     Account / cloud sync

     Storage is either the browser or Supabase, chosen at runtime through
     FP.useStore(). Everything above FP.store is identical either way, so
     this panel is the whole of the difference the user sees.
     ============================================================ */
  function syncAccountBadge() {
    const el = $('accountLabel');
    if (!el) return;
    const cloud = FP.storeId?.() === 'supabase';
    const email = FP.auth?.signedIn?.() ? FP.auth.user().email : null;
    el.textContent = cloud && email ? email.split('@')[0] : cloud ? 'Cloud' : 'Local';
    $('btnAccount').classList.toggle('on', cloud && !!email);
  }
  FP.syncAccountBadge = syncAccountBadge;

  function accountModal() {
    const ok = FP.auth?.available?.();
    const signedIn = FP.auth?.signedIn?.();
    const cloud = FP.storeId?.() === 'supabase';
    const user = signedIn ? FP.auth.user() : null;
    const role = FP.auth?.role?.();

    if (!ok) {
      FP.modal({
        title: 'Cloud sync',
        body: `<p class="helptext">The Supabase client could not be loaded, so cloud
          sync is unavailable. Plans are saving to this browser only.</p>
          <p class="helptext">This usually means the page is open from a
          <code>file://</code> path or the network blocked the CDN. Serve the folder
          over http and reload.</p>`,
        foot: '<button class="btn primary" data-close>Close</button>',
        onMount: (_b, f) => (f.querySelector('[data-close]').onclick = FP.closeModal),
      });
      return;
    }

    const body = signedIn ? `
      <div class="grp">
        <h4 class="grp-title">Signed in</h4>
        <div class="kv"><span>Account</span><span>${esc(user.email)}</span></div>
        <div class="kv"><span>Role</span><span>${esc(role || 'pending')}</span></div>
        <div class="kv"><span>Can edit plans</span><span>${FP.auth.canEdit() ? 'yes' : 'no'}</span></div>
      </div>
      <div class="grp">
        <h4 class="grp-title">Where plans are saved</h4>
        <div class="seg" id="storeSeg">
          <button data-store="local"${!cloud ? ' class="on"' : ''}>This browser</button>
          <button data-store="supabase"${cloud ? ' class="on"' : ''}>Cloud</button>
        </div>
        <p class="helptext" style="margin-top:8px">
          Cloud plans are shared with your team and protected by row level
          security — exhibitors only ever see their own booth.
        </p>
        ${cloud ? '' : `<button class="mini" id="btnPushPlan" style="width:100%;margin-top:6px">
          Upload the open plan to the cloud</button>`}
      </div>
      ${FP.auth.isAdmin() ? `<div class="grp">
        <h4 class="grp-title">Administration</h4>
        <button class="mini" id="btnTeam" style="width:100%">Team &amp; access…</button>
      </div>` : ''}` : `
      <div class="grp">
        <h4 class="grp-title">Sign in</h4>
        <div class="field"><label>Email</label>
          <input class="inp" id="acEmail" type="email" placeholder="you@sourceoneevents.com"/></div>
        <div class="field"><label>Password</label>
          <input class="inp" id="acPass" type="password" placeholder="••••••••"/></div>
        <div class="btn-row">
          <button class="mini" id="btnSignIn">Sign in</button>
          <button class="mini" id="btnSignUp">Create account</button>
        </div>
        <p class="helptext" style="margin-top:10px">
          Or get a one-time link by email — no password needed.
        </p>
        <button class="mini" id="btnMagic" style="width:100%">Email me a sign-in link</button>
        <div id="acMsg" class="helptext" style="margin-top:10px"></div>
      </div>
      <div class="grp">
        <h4 class="grp-title">Working offline</h4>
        <p class="helptext" style="margin:0">Without signing in the editor still works
          fully — plans save to this browser and export as files.</p>
      </div>`;

    FP.modal({
      title: 'Cloud sync',
      body,
      foot: signedIn
        ? `<button class="btn ghost" data-signout>Sign out</button>
           <button class="btn primary" data-close>Done</button>`
        : '<button class="btn primary" data-close>Close</button>',
      onMount: (b, f) => {
        f.querySelector('[data-close]').onclick = FP.closeModal;

        f.querySelector('[data-signout]')?.addEventListener('click', async () => {
          await FP.auth.signOut();
          FP.useStore('local');
          FP.closeModal();
          syncAccountBadge();
          FP.toast('Signed out — back to local storage');
        });

        b.querySelectorAll('[data-store]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const which = btn.dataset.store;
            FP.useStore(which);
            syncAccountBadge();
            FP.closeModal();
            FP.toast(which === 'supabase' ? 'Saving to the cloud' : 'Saving to this browser');
            if (which === 'supabase') plansModal();
          }));

        b.querySelector('#btnTeam')?.addEventListener('click', () => (location.href = 'admin.html'));

        b.querySelector('#btnPushPlan')?.addEventListener('click', async () => {
          try {
            FP.useStore('supabase');
            await FP.store.put(FP.plan);
            FP.closeModal();
            syncAccountBadge();
            FP.toast(`Uploaded “${FP.plan.name}”`);
          } catch (err) {
            FP.useStore('local');
            FP.toast(err.message || 'Upload failed', true);
          }
        });

        const msg = (t, bad) => {
          const m = b.querySelector('#acMsg');
          if (m) { m.textContent = t; m.style.color = bad ? 'var(--err)' : 'var(--ok)'; }
        };
        const creds = () => ({
          email: (b.querySelector('#acEmail')?.value || '').trim(),
          pass: b.querySelector('#acPass')?.value || '',
        });

        b.querySelector('#btnSignIn')?.addEventListener('click', async () => {
          const { email, pass } = creds();
          if (!email || !pass) return msg('Enter an email and password.', true);
          msg('Signing in…');
          const r = await FP.auth.signInWithPassword(email, pass);
          if (r.error) return msg(r.error, true);
          FP.useStore('supabase');
          FP.closeModal();
          syncAccountBadge();
          FP.toast('Signed in');
          plansModal();
        });

        b.querySelector('#btnSignUp')?.addEventListener('click', async () => {
          const { email, pass } = creds();
          if (!email || !pass) return msg('Enter an email and password.', true);
          msg('Creating account…');
          const r = await FP.auth.signUpWithPassword(email, pass);
          if (r.error) return msg(r.error, true);
          if (r.needsConfirmation) {
            return msg('Check your email to confirm the address, then sign in.');
          }
          FP.useStore('supabase');
          FP.closeModal();
          syncAccountBadge();
          FP.toast('Account created');
        });

        b.querySelector('#btnMagic')?.addEventListener('click', async () => {
          const { email } = creds();
          if (!email) return msg('Enter your email first.', true);
          msg('Sending…');
          const r = await FP.auth.signInWithMagicLink(email);
          msg(r.error || 'Link sent — check your inbox.', !!r.error);
        });
      },
    });
  }

  /* ============================================================
     Plans modal
     ============================================================ */
  async function plansModal() {
    const plans = await FP.listPlans();
    const rows = plans.map((p) => {
      const spaces = (p.elements || []).filter((e) => C.flag(e.kind, 'sellable')).length;
      return `<div class="plan-card${p.id === FP.plan.id ? ' current' : ''}" data-plan="${p.id}">
        <div class="thumb">${thumb(p)}</div>
        <div class="info">
          <b>${esc(p.name)}</b>
          <span>${spaces} spaces · ${esc(p.venue || 'No venue')} · ${new Date(p.updated).toLocaleDateString()}</span>
        </div>
        <button class="tb" data-del="${p.id}" title="Delete">
          ${iconSvg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>')}
        </button>
      </div>`;
    }).join('');

    /* Templates: a show is far quicker to start from a comparable plan
       than from an empty hall. */
    const templates = `
      <h4 class="grp-title" style="margin:4px 0 8px">Start from a template</h4>
      <div class="tpl-row">
        <button class="tpl" data-tpl="sample">
          <b>Trade show floor</b>
          <span>Back-to-back inline rows, islands, 200 × 120 ft</span>
        </button>
        <button class="tpl" data-tpl="pcma">
          <b>PCMA Convening Leaders</b>
          <span>Centre stage, learning lounges, Braindate, 320 × 200 ft</span>
        </button>
      </div>
      ${rows ? '<h4 class="grp-title" style="margin:18px 0 8px">Your plans</h4>' : ''}`;

    FP.modal({
      title: 'Plans',
      wide: true,
      body: templates + (rows || `<div class="empty">No saved plans yet.</div>`),
      foot: `<button class="btn ghost" data-import>Import file…</button>
             <button class="btn primary" data-new>New plan</button>`,
      onMount: (body, foot) => {
        body.querySelectorAll('[data-tpl]').forEach((b) => {
          b.addEventListener('click', async () => {
            const plan = b.dataset.tpl === 'pcma' ? FP.pcmaPlan() : FP.samplePlan();
            FP.loadPlan(plan);
            await FP.save();
            FP.closeModal();
            R().fit();
            renderAll();
            FP.toast(`Loaded “${plan.name}”`);
          });
        });
        body.querySelectorAll('.plan-card').forEach((card) => {
          card.addEventListener('click', async (ev) => {
            if (ev.target.closest('[data-del]')) return;
            await FP.openPlan(card.dataset.plan);
            FP.closeModal();
            R().fit();
            renderAll();
          });
        });
        body.querySelectorAll('[data-del]').forEach((b) => {
          b.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const id = b.dataset.del;
            await FP.deletePlan(id);
            if (id === FP.plan.id) newPlan();
            plansModal();
          });
        });
        foot.querySelector('[data-new]').onclick = () => { FP.closeModal(); newPlan(); };
        foot.querySelector('[data-import]').onclick = () => { FP.closeModal(); FP.exporters.importPlan(); };
      },
    });
  }

  function thumb(p) {
    const w = p.width || 200, h = p.height || 120;
    const els = (p.elements || []).filter((e) => e.shape === 'rect' && !e.parentId).slice(0, 80);
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      <rect width="${w}" height="${h}" fill="var(--bg-4)"/>
      ${els.map((e) => {
        const k = C.kind(e.kind);
        return `<rect x="${e.geometry.x}" y="${e.geometry.y}" width="${e.geometry.w}"
          height="${e.geometry.h}" fill="${k.fill}" fill-opacity=".7"/>`;
      }).join('')}
    </svg>`;
  }

  function newPlan() {
    FP.loadPlan(FP.blankPlan(`Show ${new Date().toLocaleDateString()}`));
    R().fit();
    renderAll();
  }

  /* ============================================================
     Help
     ============================================================ */
  function helpModal() {
    const group = (title, rows) => `<div><h4>${title}</h4><dl>${rows.map(([k, v]) =>
      `<div class="kr"><span>${esc(v)}</span><kbd>${esc(k)}</kbd></div>`).join('')}</dl></div>`;
    FP.modal({
      title: 'Keyboard shortcuts',
      wide: true,
      body: `<div class="keys">
        ${group('Tools', [
          ['V', 'Select and move'], ['B', 'Draw booth space'], ['W', 'Wall'],
          ['D', 'Dead space'], ['P', 'Freeform dead space'], ['X', 'Fire exit'],
          ['A', 'Aisle'], ['T', 'Text'], ['M', 'Measure'], ['H', 'Pan'],
        ])}
        ${group('Editing', [
          ['Ctrl Z', 'Undo'], ['Ctrl ⇧ Z', 'Redo'], ['Ctrl D', 'Duplicate'],
          ['Ctrl C / V', 'Copy / paste'], ['Del', 'Delete selection'],
          ['Arrows', 'Nudge by grid'], ['⇧ Arrows', 'Nudge ×5'],
          ['Ctrl A', 'Select all'], ['Ctrl ] / [', 'Bring front / send back'],
        ])}
        ${group('View', [
          ['Scroll', 'Zoom'], ['Space drag', 'Pan'], ['F', 'Fit to screen'],
          ['G', 'Toggle grid'], ['S', 'Toggle snap'], ['L', 'Toggle labels'],
          ['Ctrl 0', 'Fit'],
        ])}
        ${group('While drawing', [
          ['⇧', 'Square / 45° constrain'], ['Alt (while dragging)', 'Ignore snap'],
          ['Alt (on release)', 'Place one, then switch to Select'],
          ['Enter', 'Finish polygon'], ['Backspace', 'Remove last point'],
          ['Esc', 'Cancel'], ['Double-click', 'Open booth interior'],
        ])}
      </div>`,
      foot: `<button class="btn ghost" data-tour>Interactive tour</button>
             <a class="btn ghost" href="guide.html" target="_blank" rel="noopener"
               style="text-decoration:none">Open the user guide</a>
             <button class="btn primary" data-close>Got it</button>`,
      onMount: (_b, foot) => {
        foot.querySelector('[data-close]').onclick = FP.closeModal;
        foot.querySelector('[data-tour]').onclick = () => { FP.closeModal(); FP.tour?.open(); };
      },
    });
  }

  /* ============================================================
     Scope bar
     ============================================================ */
  function ensureScopeBar() {
    let bar = $('scopeBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'scopeBar';
      bar.className = 'scope-bar';
      document.querySelector('.stage-overlay').appendChild(bar);
    }
    return bar;
  }

  function renderScopeBar() {
    const bar = ensureScopeBar();
    const space = FP.scopeSpace();
    if (!space) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = `
      <button class="crumb" data-back>${iconSvg('<path d="M15 18l-6-6 6-6"/>')} Hall plan</button>
      <span class="crumb-sep">/</span>
      <span class="crumb current">Booth ${esc(space.props.number || '')}${
        space.props.exhibitor ? ` — ${esc(space.props.exhibitor)}` : ''}</span>`;
    bar.querySelector('[data-back]').onclick = () => { FP.exitScope(); R().fit(); };
  }

  /* ============================================================
     Top bar + HUD
     ============================================================ */
  function wireTopbar() {
    $('planName').addEventListener('input', (e) => {
      FP.plan.name = e.target.value;
      FP.changed({ recheck: false });
    });

    $('btnUndo').onclick = () => { FP.undo(); R().draw(); };
    $('btnRedo').onclick = () => { FP.redo(); R().draw(); };
    $('btnZoomIn').onclick = () => R().zoomAt(1.25, ...canvasCenter());
    $('btnZoomOut').onclick = () => R().zoomAt(0.8, ...canvasCenter());
    $('btnZoomLevel').onclick = () => R().setZoom(4);
    $('btnFit').onclick = () => R().fit();

    $('btnGrid').onclick = () => { S.showGrid = !S.showGrid; syncToggles(); R().draw(); };
    $('btnSnap').onclick = () => { S.snap = !S.snap; syncToggles(); };
    $('btnLabels').onclick = () => { S.showLabels = !S.showLabels; syncToggles(); R().draw(); };

    $('btnTheme').onclick = () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      FP.setPref('theme', next);
      R().draw();
    };

    $('btnHelp').onclick = helpModal;
    $('btnPlans').onclick = plansModal;
    $('btnAccount').onclick = accountModal;

    const menu = $('exportMenu');
    $('btnExport').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', () => { menu.hidden = true; });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-export]');
      if (!b) return;
      menu.hidden = true;
      FP.exporters.run(b.dataset.export);
    });

    $('modalClose').onclick = FP.closeModal;
    $('modalBackdrop').addEventListener('click', (e) => {
      if (e.target === $('modalBackdrop')) FP.closeModal();
    });

    $('btnBoothRow').onclick = boothBlockModal;
    $('btnAutoNumber').onclick = autoNumberModal;
    $('btnUnderlay').onclick = importUnderlay;

    $('catalogSearch').addEventListener('input', (e) => {
      catalogQuery = e.target.value;
      renderCatalog();
    });

    $('toolRail').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rail]');
      if (!b) return;
      const r = RAIL.find((x) => x.id === b.dataset.rail);
      if (!r) return;
      S.armedSize = null;
      /* clicking the active tool again puts the cursor back */
      if (r.tool !== 'select' && S.tool === r.tool &&
          (r.kind || null) === (S.armedKind || null)) {
        FP.setTool('select');
        return;
      }
      FP.setTool(r.tool, r.kind || null);
    });

    $('catalog').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kind]');
      if (b) armKind(b.dataset.kind);
    });

    $('catalog').addEventListener('click', (e) => {
      const t = e.target.closest('[data-toggle]');
      if (!t) return;
      const id = t.dataset.toggle;
      const cat = C.categories.find((c) => c.id === id);
      const nowOpen = t.getAttribute('aria-expanded') !== 'true';

      if (cat?.defaultOpen === false) {
        nowOpen ? userToggled.add(id) : userToggled.delete(id);
        FP.setPref('catalogOpened', [...userToggled]);
      } else {
        nowOpen ? collapsed.delete(id) : collapsed.add(id);
        FP.setPref('catalogCollapsed', [...collapsed]);
      }
      renderCatalog();

      /* Opening a section also TAKES you to it. The re-render replaced
         the clicked node, so find the fresh header and bring it to the
         top of the panel — its items land right under the cursor
         instead of unfolding somewhere off-screen. */
      if (nowOpen) {
        document.querySelector(`[data-toggle="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    $('boothPresets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-preset]');
      if (!b) return;
      const p = C.presets[Number(b.dataset.preset)];
      armKind('space', [p.w, p.h], p.spaceType);
    });

    $('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) setTab(b.dataset.tab);
    });
  }

  function canvasCenter() {
    const { w, h } = R().size();
    return [w / 2, h / 2];
  }

  function setTab(id) {
    activeTab = id;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === `tab-${id}`));
    renderPane();
  }
  FP.setTab = setTab;

  function syncToggles() {
    $('btnGrid').setAttribute('aria-pressed', String(S.showGrid));
    $('btnSnap').setAttribute('aria-pressed', String(S.snap));
    $('btnLabels').setAttribute('aria-pressed', String(S.showLabels));
  }

  function syncTopbar() {
    $('btnUndo').disabled = !FP.history.past.length;
    $('btnRedo').disabled = !FP.history.future.length;
    $('btnZoomLevel').textContent = `${Math.round((S.view.zoom / 4) * 100)}%`;
    if ($('planName').value !== FP.plan.name) $('planName').value = FP.plan.name;
    const ss = $('saveState');
    ss.textContent = S.dirty ? 'Unsaved' : 'Saved';
    ss.classList.toggle('dirty', S.dirty);

    const counts = FP.rules.counts(S.issues || []);
    const badge = $('safetyBadge');
    const total = counts.error + counts.warning;
    badge.hidden = !total;
    badge.textContent = total;
    badge.classList.toggle('warn', !counts.error);
  }

  function syncHud() {
    const sel = FP.selected();
    const railItem = RAIL.find((r) => r.tool === S.tool && (!r.kind || r.kind === S.armedKind));
    $('hudTool').textContent = railItem ? railItem.name.split(' ')[0] : S.tool;
    $('hudSel').textContent = !sel.length
      ? 'Nothing selected'
      : sel.length === 1
        ? FP.rules.label(sel[0])
        : `${sel.length} selected`;
  }

  function updateScaleBar() {
    const raw = 90 / S.view.zoom;
    const steps = unit() === 'm' ? [0.5, 1, 2, 5, 10, 20, 50, 100]
                                 : [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
    const pick = steps.find((s) => s >= raw) ?? steps[steps.length - 1];
    $('scaleBar').style.setProperty('--sb-w', `${Math.round(pick * S.view.zoom)}px`);
    $('scaleLabel').textContent = `${pick} ${unit()}`;
  }

  /* ============================================================
     Electrical — panel schedule

     Load and voltage drop come from FP.rules.electrical, the same code
     the rules engine uses, so the schedule can never disagree with the
     warnings shown in the Safety tab.
     ============================================================ */
  /* ============================================================
     Drape — the material takeoff.

     Replaces counting runs off the drawing by hand. The panel and
     upright counts come straight from FP.drape.takeoff(), which reads
     the same geometry the plan draws, so the order can never disagree
     with what is actually on the floor.
     ============================================================ */
  function renderDrape() {
    const pane = $('tab-drape');
    const p = FP.plan;
    const t = FP.drape.takeoff(p);

    const groupRow = (g) => `<div class="board">
      <div class="board-head">
        <span class="b-id" style="text-transform:capitalize">${esc(g.color)} · ${g.height} ft</span>
        <span class="b-meta">${esc(FP.drape.describe(g, t.unit))}</span>
        <span class="b-load">${esc(G.fmtLen(g.length, t.unit))}</span>
      </div>
      <div class="board-sub">${g.sections} panel${g.sections === 1 ? '' : 's'}
        (${g.sectionWidth} ft ea.) · ${g.uprights} upright${g.uprights === 1 ? '' : 's'}
        &amp; base${g.uprights === 1 ? '' : 's'} · ${g.runs} run${g.runs === 1 ? '' : 's'}</div>
    </div>`;

    pane.innerHTML = `
      <div class="stat-grid">
        <div class="stat"><b>${Math.round(t.totalLength)}</b><span>Linear ${t.unit}</span></div>
        <div class="stat"><b>${t.totalPanels}</b><span>Panels</span></div>
        <div class="stat"><b>${t.totalUprights}</b><span>Uprights</span></div>
        <div class="stat"><b>${t.groups.length}</b><span>Colour / height</span></div>
      </div>

      <div class="grp">
        <h4 class="grp-title">Generate from the floor plan</h4>
        <p class="helptext">Lays a back wall along every row and side rails between
          touching neighbours — back-to-back rows share one wall rather than
          double-ordering it. Re-running replaces only what it generated;
          anything drawn by hand is left alone.</p>
        <div class="row2">
          <div class="field"><label>Back wall height</label>
            <select class="inp" id="dgBackH">
              <option value="8" selected>8 ft</option><option value="10">10 ft</option>
              <option value="12">12 ft</option><option value="16">16 ft</option>
            </select></div>
          <div class="field"><label>Side rail height</label>
            <select class="inp" id="dgRailH">
              <option value="3" selected>3 ft</option><option value="8">8 ft</option>
            </select></div>
        </div>
        <div class="row2">
          <div class="field"><label>Colour</label>
            <select class="inp" id="dgColor">
              <option value="black" selected>Black</option><option value="blue">Blue</option>
              <option value="white">White</option><option value="grey">Grey</option>
              <option value="red">Red</option></select></div>
          <div class="field"><label>Section width</label>
            <div class="unit-inp"><input class="inp num" id="dgSection" type="number" value="10" min="1" step="1"/>
              <span class="u">${esc(t.unit)}</span></div></div>
        </div>
        <label class="check"><input type="checkbox" id="dgRails" checked/> Include side rails between booths</label>
        <button class="mini" id="btnGenDrape" style="width:100%;margin-top:8px">
          Generate pipe &amp; drape
        </button>
      </div>

      ${t.groups.length ? `<div class="grp">
        <h4 class="grp-title">Material takeoff</h4>
        ${t.groups.map(groupRow).join('')}
      </div>
      <div class="grp">
        <button class="row-btn" id="btnDrapeCsv">
          ${iconSvg('<path d="M12 3v12m0-12 4 4m-4-4-4 4"/><path d="M4 17v3h16v-3"/>')}
          Drape order sheet (.csv)
        </button>
      </div>` : `<div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"
          stroke-linecap="round" stroke-linejoin="round">${C.kind('drape').icon}</svg>
        No pipe &amp; drape on this plan yet.<br/>Generate it from the booth
        layout, or draw runs from the <b>Structure</b> group.
      </div>`}`;

    pane.querySelector('#btnGenDrape').onclick = () => {
      const count = FP.drape.generate({
        backHeight: pane.querySelector('#dgBackH').value,
        railHeight: pane.querySelector('#dgRailH').value,
        color: pane.querySelector('#dgColor').value,
        sectionWidth: Number(pane.querySelector('#dgSection').value) || 10,
        sideRails: pane.querySelector('#dgRails').checked,
      }).length;
      renderAll();
      FP.toast(`${count} drape run${count === 1 ? '' : 's'} generated`);
    };

    pane.querySelector('#btnDrapeCsv')?.addEventListener('click', () => FP.exporters.run('drape'));
  }

  function renderElectrical() {
    const pane = $('tab-power');
    const E = FP.rules.electrical;
    const p = FP.plan;
    const ctx = { plan: p, cfg: C, all: p.elements, unit: p.unit };

    const loads = E.loadByBoard(ctx);
    const boards = Object.entries(loads);
    const runs = p.elements.filter((e) => C.flag(e.kind, 'cableRun'));
    const drops = E.dropsOf(ctx);

    if (!boards.length && !drops.length) {
      pane.innerHTML = `<div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"
          stroke-linecap="round" stroke-linejoin="round">${C.kind('electrical-panel').icon}</svg>
        No electrical distribution yet.<br/>
        Place a panel from the <b>Electrical distribution</b> group, then add
        distros and drops that reference it by ID.
      </div>${busGenHtml()}`;
      wireBusGen(pane);
      return;
    }

    const totalLoad = drops.reduce((s, d) => s + (Number(d.props.amps) || 0), 0);
    const alwaysOn = drops.filter((d) => d.props.hours === '24hr').length;

    const derate = (FP.rules.records().find((r) => r.id === 'r-panel-load')?.params.derate) ?? 0.8;

    const boardRow = ([id, node]) => {
      const cap = Number(node.board.props.mainAmps) || 0;
      const pct = cap ? (node.total / cap) * 100 : 0;
      const state = !cap ? '' : pct > 100 ? 'over' : pct > derate * 100 ? 'warn' : 'ok';
      const kind = C.kind(node.board.kind);
      const feed = (node.board.props.panelId || '').trim();
      const isDistro = C.flag(node.board.kind, 'distro');

      const circuits = node.drops
        .slice()
        .sort((a, b) => String(a.props.circuitId).localeCompare(String(b.props.circuitId), undefined, { numeric: true }))
        .map((d) => {
          const owner = d.parentId ? FP.get(d.parentId) : null;
          const conn = (C.kind('power-drop').fields.find((f) => f.key === 'connector')?.options || [])
            .find(([v]) => v === d.props.connector);
          return `<div class="ckt" data-goto="${d.id}">
            <span class="c-id">${esc(d.props.circuitId || '—')}</span>
            <span class="c-where">${owner ? `Booth ${esc(owner.props.number || '?')}` : esc(d.props.label || 'Hall')}</span>
            <span class="c-conn">${esc(conn ? conn[1] : d.props.connector || '')}</span>
            ${d.props.hours === '24hr' ? '<span class="c-24">24h</span>' : ''}
            <span class="c-amps">${Number(d.props.amps) || 0} A</span>
          </div>`;
        }).join('');

      return `<div class="board ${state}">
        <div class="board-head" data-goto="${node.board.id}">
          <span class="b-id">${esc(id)}</span>
          <span class="b-meta">${esc(kind.name)} · ${esc(node.board.props.voltage || '')} V${
            node.board.props.phase === '3' ? ' 3Ø' : ''}${isDistro && feed ? ` · fed from ${esc(feed)}` : ''}</span>
          <span class="b-load">${Math.round(node.total)} / ${cap || '—'} A</span>
        </div>
        <div class="loadbar"><i style="width:${Math.min(pct, 100)}%"></i>
          <u style="left:${Math.min(derate * 100, 100)}%"></u></div>
        <div class="board-sub">${cap ? `${Math.round(pct)}% of capacity · ${node.drops.length} circuit${node.drops.length === 1 ? '' : 's'}` : 'No main breaker set'}</div>
        ${circuits ? `<div class="ckt-list">${circuits}</div>` : ''}
      </div>`;
    };

    const runRow = (r) => {
      const vd = E.voltageDrop(r);
      const pct = vd ? vd.percent : null;
      const state = pct === null ? '' : pct > 3 ? 'over' : pct > 2 ? 'warn' : 'ok';
      return `<div class="ckt ${state}" data-goto="${r.id}">
        <span class="c-id">${esc(r.props.circuitId || '—')}</span>
        <span class="c-where">${esc(r.props.gauge)} AWG · ${esc(G.fmtLen(G.length(r), p.unit))}</span>
        <span class="c-conn">${esc(r.props.method || '')}</span>
        <span class="c-amps">${pct === null ? '—' : `${pct.toFixed(1)}%`}</span>
      </div>`;
    };

    pane.innerHTML = `
      <div class="stat-grid">
        <div class="stat"><b>${Math.round(totalLoad)}</b><span>Amps connected</span></div>
        <div class="stat"><b>${drops.length}</b><span>Drops</span></div>
        <div class="stat"><b>${boards.length}</b><span>Boards</span></div>
        <div class="stat${alwaysOn ? ' warn' : ''}"><b>${alwaysOn}</b><span>24-hour</span></div>
      </div>

      <div class="grp">
        <h4 class="grp-title">Panel schedule</h4>
        ${boards.map(boardRow).join('')}
      </div>

      ${runs.length ? `<div class="grp">
        <h4 class="grp-title">Feeders — voltage drop</h4>
        <p class="helptext">Single phase VD = 2 × 12.9 × I × L ÷ circular mils. Limit ${
          FP.rules.records().find((r) => r.id === 'r-vdrop')?.params.maxPercent ?? 3}%.</p>
        ${runs.map(runRow).join('')}
      </div>` : ''}

      ${busReachHtml()}
      ${busGenHtml()}

      <div class="grp">
        <h4 class="grp-title">Exports</h4>
        <button class="row-btn" data-elec-export="electrical">
          ${iconSvg('<path d="M12 3v12m0-12 4 4m-4-4-4 4"/><path d="M4 17v3h16v-3"/>')}
          Electrical schedule (.csv)
        </button>
        <button class="row-btn" data-elec-export="workorders">
          ${iconSvg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>')}
          Per-booth work orders (print)
        </button>
      </div>`;

    pane.querySelectorAll('[data-goto]').forEach((row) =>
      row.addEventListener('click', () => {
        const el = FP.get(row.dataset.goto);
        if (!el) return;
        if (el.parentId && S.scope.type === 'hall') FP.select([el.parentId]);
        else FP.select([el.id]);
        R().centerOn(G.bbox(el));
      }));

    pane.querySelectorAll('[data-elec-export]').forEach((b) =>
      b.addEventListener('click', () => FP.exporters.run(b.dataset.elecExport)));

    wireBusGen(pane);
    pane.querySelectorAll('[data-bus-goto]').forEach((row) =>
      row.addEventListener('click', () => {
        const el = FP.get(row.dataset.busGoto);
        if (!el) return;
        FP.select([el.id]);
        R().centerOn(G.bbox(el));
      }));
  }

  /** Booths that ordered power but sit further than half the bus module away. */
  function busReachHtml() {
    if (!FP.interact?.busReach) return '';
    const module = FP.interact.BUS_MODULE || 30;
    const out = FP.interact.busReach().filter((r) => r.distance > module / 2 + 0.01);
    if (!out.length) return '';
    return `<div class="grp">
      <h4 class="grp-title">Booths beyond bus reach</h4>
      <p class="helptext">More than ${G.fmtLen(module / 2, FP.plan.unit)} from any bus —
        feeding these would cross an aisle.</p>
      ${out.map((r) => `<div class="ckt over" data-bus-goto="${r.space.id}">
        <span class="c-id">${esc(r.space.props.number || '—')}</span>
        <span class="c-where">${esc(r.space.props.exhibitor || 'Unassigned')}</span>
        <span class="c-amps">${G.fmtLen(r.distance, FP.plan.unit)}</span>
      </div>`).join('')}
    </div>`;
  }

  function busGenHtml() {
    return `<div class="grp">
      <h4 class="grp-title">Electrical buses</h4>
      <p class="helptext">Lays feeder runs on the standard module — 10 ft booth,
        10 ft aisle, 10 ft booth — so every booth backs onto one and no drop
        has to cross an aisle.</p>
      <div class="row2">
        <div class="field"><label>Direction</label>
          <select class="inp" id="busAxis">
            <option value="h">Horizontal</option>
            <option value="v">Vertical</option>
          </select></div>
        <div class="field"><label>Spacing</label>
          <div class="unit-inp"><input class="inp num" id="busSpacing" type="number"
            value="${FP.interact?.BUS_MODULE || 30}" min="10" step="5"/>
            <span class="u">${esc(FP.plan.unit)}</span></div></div>
      </div>
      <div class="row2">
        <div class="field"><label>Offset from edge</label>
          <div class="unit-inp"><input class="inp num" id="busOffset" type="number"
            value="15" min="0" step="5"/><span class="u">${esc(FP.plan.unit)}</span></div></div>
        <div class="field"><label>Fed from</label>
          <input class="inp" id="busPanel" value="MDP-1"/></div>
      </div>
      <button class="mini" id="btnGenBuses" style="width:100%">Generate buses</button>
    </div>`;
  }

  function wireBusGen(pane) {
    pane.querySelector('#btnGenBuses')?.addEventListener('click', () => {
      const made = FP.interact.generateBuses({
        axis: pane.querySelector('#busAxis').value,
        spacing: Number(pane.querySelector('#busSpacing').value) || 30,
        offset: Number(pane.querySelector('#busOffset').value) || 15,
        panelId: pane.querySelector('#busPanel').value.trim() || 'MDP-1',
      }).length;
      renderAll();
      FP.toast(made ? `${made} bus run${made === 1 ? '' : 's'} generated` : 'Nothing to generate — check the hall size');
    });
  }

  /* ============================================================
     Render orchestration
     ============================================================ */
  function renderPane() {
    if (activeTab === 'props') renderProps();
    else if (activeTab === 'booths') renderBooths();
    else if (activeTab === 'safety') renderSafety();
    else if (activeTab === 'power') renderElectrical();
    else if (activeTab === 'drape') renderDrape();
    else if (activeTab === 'plan') renderPlan();
  }

  function renderAll() {
    renderRail();
    renderPresets();
    renderCatalog();
    renderScopeBar();
    renderPane();
    syncTopbar();
    syncHud();
    syncToggles();
  }
  FP.renderAll = renderAll;

  /* ============================================================
     Init
     ============================================================ */
  FP.initUI = () => {
    wireTopbar();
    syncToggles();

    /* iPad portrait: the catalog collapses to the icon rail; a rail tap
       slides the full catalog over the canvas, a canvas tap tucks it away */
    const leftPanel = $('leftPanel');
    const narrow = () => matchMedia('(max-width: 900px)').matches;
    leftPanel?.addEventListener('click', (e) => {
      if (!narrow()) return;
      if (e.target.closest('.rail-btn')) leftPanel.classList.add('open');
    });
    $('canvas')?.addEventListener('pointerdown', () =>
      leftPanel?.classList.remove('open'));

    /* phone: the inspector is a bottom sheet raised by a floating button
       (CSS shows the button and reshapes the panel under 700px) */
    const rightPanel = document.querySelector('.panel.right');
    if (rightPanel) {
      const fab = document.createElement('button');
      fab.id = 'inspFab';
      fab.className = 'insp-fab';
      fab.innerHTML = `${iconSvg('<path d="M4 6h16M4 12h16M4 18h10"/>')}<span>Inspector</span>`;
      document.body.appendChild(fab);
      fab.onclick = () => rightPanel.classList.toggle('open');
      $('canvas')?.addEventListener('pointerdown', () =>
        rightPanel.classList.remove('open'));
    }

    /* keep panels in step with the model */
    let paneTimer = null;
    const schedulePane = () => {
      clearTimeout(paneTimer);
      paneTimer = setTimeout(() => { renderPane(); renderCatalog(); syncTopbar(); syncHud(); }, 60);
    };

    FP.on('change', schedulePane);
    FP.on('change', syncSelChip);
    FP.on('select', () => { renderPane(); syncHud(); syncSelChip(); });
    FP.on('tool', () => { renderRail(); renderPresets(); renderCatalog(); syncHud(); syncToggles(); });
    FP.on('scope', () => { renderScopeBar(); renderCatalog(); renderPane(); });
    FP.on('plan-loaded', renderAll);
    FP.on('saved', syncTopbar);
    /* A failed save must never be silent — "Unsaved" alone reads as
       "not saved YET", not "your changes are not reaching the cloud". */
    FP.on('save-error', (e) => FP.toast(
      `Could not save: ${e?.message || 'unknown error'}`, true));
    FP.on('tool', syncToolChip);
    syncToolChip();
    FP.on('painted', updateScaleBar);

    FP.on('cursor', (w) => {
      $('hudCoords').textContent = `${G.round(w.x, 1)}, ${G.round(w.y, 1)} ${unit()}`;
    });

    FP.on('show-help', helpModal);
    FP.on('calibrate-line', calibrationDialog);
    FP.on('fill-region', fillRegionDialog);

    FP.on('edit-text', (id) => {
      const el = FP.get(id);
      if (!el) return;
      FP.select([id]);
      setTab('props');
      setTimeout(() => {
        const node = document.getElementById('fld_text');
        if (node) { node.focus(); node.select(); }
      }, 80);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('modalBackdrop').hidden) FP.closeModal();
    });

    renderAll();
  };
})(window);
