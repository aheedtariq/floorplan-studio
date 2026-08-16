/* ============================================================
   tour.js — the interactive first-login walkthrough.

   Not a slideshow: the tour dims the page, spotlights the REAL
   control for each step ("click here"), and lets the user perform
   the action live — clicks on the highlighted element count, and
   "Do it for me" performs them. It follows the user across pages
   (dashboard → Studio → 3D) via localStorage, covers every feature,
   and can be skipped at any moment. Staff and clients get different
   flows because they see different apps. Shows once (FP.prefs.
   tourDone), then reopens from Help / Getting started.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const KEY = 'fpTourAt'; /* {i} — continue on the next page */

  const page = (() => {
    const p = (location.pathname.split('/').pop() || 'index').replace('.html', '');
    return p || 'index';
  })();

  const $q = (s) => document.querySelector(s);
  const vis = (e) => !!(e && e.getClientRects().length);
  const isClient = () => !!FP.auth?.isClient?.();
  const canEdit = () => !!FP.auth?.canEdit?.();
  const isAdmin = () => FP.auth?.role?.() === 'admin';
  const narrow = () => matchMedia('(max-width: 900px)').matches;
  /* on iPad the left catalog is a slide-over — open it for panel steps */
  const openPanel = () => { if (narrow()) $q('.panel.left')?.classList.add('open'); };

  /* ============================================================
     The steps. `target` is a selector or a function; a step is
     skipped when its target isn't on screen or `when` says no.
     `tryIt` = the spotlight itself is clickable and the user is
     invited to click it (Next performs the click for them unless
     `click:false`). `nav` = the click leaves this page; the tour
     saves its place first and resumes on arrival.
     ============================================================ */

  const homeIntro = (title, body) => ({ page: 'home', target: null, title, body });

  const staffSteps = () => [
    homeIntro('Welcome to Floorplan Studio',
      `<p>This tour walks the <b>whole app</b>, step by step, pointing at the real
       buttons. When something glows, you can <b>actually click it</b> — or press
       <b>Next</b> and it happens for you.</p>
       <p>Skip any time. <b>Getting started</b> up top restarts the tour.</p>`),
    {
      page: 'home', target: '#btnNew', when: canEdit,
      title: 'New plan — start from a template',
      body: `<p>This creates a plan: name it, set the hall size, and pick a starting
        layout — <b>booth rows</b>, <b>tabletop expo</b>, <b>island showcase</b>, or any
        template you've saved. Booths arrive numbered <b>and furnished</b>.</p>`,
    },
    {
      page: 'home', target: '.plan-card',
      title: 'Every plan is a card',
      body: `<ul>
        <li><b>Open plan</b> — edit it in the Studio.</li>
        <li><b>Photos</b> — every venue photo saved to this plan.</li>
        <li><b>Client link</b> — the customer's private URL and password.</li>
        <li><b>Save as template</b> — reuse this layout for the next order.</li>
        <li>The <b>dropdown</b> assigns the plan to a client company.</li></ul>`,
    },
    {
      page: 'home', target: '#btnAdmin', when: isAdmin,
      title: 'The Admin page',
      body: `<p>Client companies, their links and passwords, who has signed in —
        and the <b>Live Now</b> board showing who is in the app this minute and
        which plan they have open.</p>`,
    },
    {
      page: 'home', target: '#btnHelp',
      title: 'Help is always here',
      body: `<p><b>Getting started</b> restarts this tour. <b>User guide</b> opens the
        full manual. Now let's go inside the Studio.</p>`,
    },
    {
      page: 'home', target: () => $q('.plan-card .btn[data-open]') || $q('#btnNew'),
      tryIt: true, nav: true,
      title: 'Open a plan — the tour continues inside',
      body: `<p>Click the glowing button. The Studio opens and this tour
        <b>picks up right there</b>.</p>`,
    },

    /* ---------------- the Studio ---------------- */
    {
      page: 'index', target: null,
      title: 'This is the Studio',
      body: `<p>Catalog on the <b>left</b>, your floor in the <b>middle</b>, the
        inspector on the <b>right</b>. There is no save button — every change
        stores itself the moment you make it.</p>`,
    },
    {
      page: 'index', target: '.plan-name-wrap',
      title: 'Name and autosave',
      body: `<p>Click the title to rename the plan. The little <b>Saved</b> tag
        flickers to <i>Saving…</i> as you work — that's the autosave heartbeat.</p>`,
    },
    {
      page: 'index', target: '#boothPresets', before: openPanel,
      tryIt: true, click: false, advance: true,
      title: 'Quick booths — try it',
      body: `<p><b>Click a size</b> (say 10 × 10) to arm it. These are the everyday
        booth sizes, one click away.</p>`,
    },
    {
      page: 'index', target: '#canvas',
      tryIt: true, click: false, advance: true, delay: 800,
      title: 'Now click an empty spot on the floor',
      body: `<p>The booth lands <b>numbered and furnished</b> — back drape, a 6-ft
        draped table, two chairs — every item labeled on the plan. Click again to
        place more; <b>Esc</b> puts the tool down.</p>`,
    },
    {
      page: 'index', target: () => (vis($q('#selChip')) ? $q('#selChip') : $q('#canvas')),
      tryIt: true, click: false,
      title: 'Select anything → Duplicate / Delete',
      body: `<p>Click any item on the floor and a floating bar appears with
        <b>Duplicate</b> and <b>Delete</b>. Drag to move, drag the corners to resize,
        <b>Del</b> deletes, <b>Ctrl+Z</b> undoes anything. Double-click a booth to
        step inside it.</p>`,
    },
    {
      page: 'index', target: '.search-wrap', before: openPanel,
      title: 'The catalog — real rental inventory',
      body: `<p>Below the search box is Source One's actual stock: tables, seating,
        bars, staging, <b>carpet and turf in the real colours</b>, hanging signs,
        power. Click one, then click the floor — everything arrives at true size,
        with its name on the plan.</p>`,
    },
    {
      page: 'index', target: '#toolRail', before: openPanel,
      title: 'Drawing tools',
      body: `<p>The rail holds the pens: <b>Select</b> (V), <b>Booth space</b> (B),
        <b>Wall</b> (W), <b>Dead space</b> (D), <b>Fire exit</b> (X), <b>Aisle</b> (A),
        <b>Text</b> (T), <b>Measure</b> (M), <b>Pan</b> (H). Hover any for its key.</p>`,
    },
    {
      page: 'index', target: '#btnBoothRow', before: openPanel, when: canEdit,
      title: 'Generate whole booth rows',
      body: `<p>Lay out an entire block in one go — booth size, back-to-back rows,
        aisle widths. It's how an 80-booth floor takes two minutes.</p>`,
    },
    {
      page: 'index', target: '#btnAutoNumber', before: openPanel, when: canEdit,
      title: 'Auto-number booths',
      body: `<p>Renumbers every booth in clean walking order — after you've moved
        things around, one click makes the numbering make sense again.</p>`,
    },
    {
      page: 'index', target: '#btnUnderlay', before: openPanel, when: canEdit,
      title: 'Photo → floor plan',
      body: `<p>Import a photo of the venue's printed floor plan, then either
        <b>Convert with AI</b> — walls, doors and numbered booths drawn for you —
        or <b>trace</b> over the photo with one calibrated measurement.
        iPhone <b>LiDAR room scans</b> import at true measured size too.</p>`,
    },
    {
      page: 'index', target: '.tab[data-tab="props"]',
      before: () => $q('.tab[data-tab="props"]')?.click(),
      title: 'Properties',
      body: `<p>Whatever you select shows here: position, size, rotation — and for
        a booth, its <b>number</b>, <b>exhibitor</b>, and <b>status</b>. The exhibitor
        name prints on the plan and on the booth's hanging sign in 3D.</p>`,
    },
    {
      page: 'index', target: '.tab[data-tab="booths"]',
      before: () => $q('.tab[data-tab="booths"]')?.click(),
      title: 'Booths',
      body: `<p>Every space on the floor, listed — search by booth number or company
        name, click a row to jump to it on the plan.</p>`,
    },
    {
      page: 'index', target: '.tab[data-tab="safety"]',
      before: () => $q('.tab[data-tab="safety"]')?.click(),
      title: 'Safety',
      body: `<p>Live checks as you draw: blocked fire exits, missing aisle clearance,
        booths sitting on egress paths. The red badge counts open problems —
        the goal is zero.</p>`,
    },
    {
      page: 'index', target: '.tab[data-tab="power"]',
      before: () => $q('.tab[data-tab="power"]')?.click(),
      title: 'Power',
      body: `<p>Drops, panels and distro runs on the plan — and a ready
        <b>electrical schedule</b> you can export for the venue.</p>`,
    },
    {
      page: 'index', target: '.tab[data-tab="drape"]',
      before: () => $q('.tab[data-tab="drape"]')?.click(),
      title: 'Drape',
      body: `<p>Every run of pipe-and-drape on the floor totalled up by colour and
        footage — the <b>drape order sheet</b> writes itself.</p>`,
    },
    {
      page: 'index', target: '.tab[data-tab="plan"]',
      before: () => $q('.tab[data-tab="plan"]')?.click(),
      title: 'Plan settings',
      body: `<p>Hall dimensions, dates, and the <b>freeze date</b> — the day the
        client's layout locks so the build matches what they approved.</p>`,
    },
    {
      page: 'index', target: () => $q('#btnUndo')?.closest('.btn-group'),
      title: 'Undo / Redo',
      body: `<p>Everything is undoable — <b>Ctrl+Z</b> back, <b>Ctrl+Shift+Z</b>
        forward. Experiment freely.</p>`,
    },
    {
      page: 'index', target: () => $q('#btnZoomIn')?.closest('.btn-group'),
      title: 'Zoom and fit',
      body: `<p>Zoom with these, the mouse wheel, or <b>+/−</b>. The frame button
        (or <b>F</b>) fits the whole plan to your screen. Hold <b>Space</b> and
        drag to pan.</p>`,
    },
    {
      page: 'index', target: () => $q('#btnGrid')?.closest('.btn-group'),
      title: 'Grid, snap, labels',
      body: `<p>Toggle the grid (<b>G</b>), snapping (<b>S</b>), and the item labels
        (<b>L</b>). Snap keeps booths on clean one-foot lines.</p>`,
    },
    {
      page: 'index', target: '#btnPlans',
      title: 'Switch plans',
      body: `<p>Jump to any other plan you can see — no need to go back to the
        dashboard.</p>`,
    },
    {
      page: 'index',
      target: () => (vis($q('#exportMenu')) ? $q('#exportMenu') : $q('#btnExport')),
      /* deferred: the click that pressed Next must finish bubbling first,
         or the app's own click-outside handler closes the menu again */
      before: () => setTimeout(() => {
        const m = $q('#exportMenu');
        if (m?.hidden) $q('#btnExport')?.click();
      }, 0),
      leave: () => { const m = $q('#exportMenu'); if (m && !m.hidden) m.hidden = true; },
      title: 'Export — everything the show needs',
      body: `<ul>
        <li><b>Print / PDF</b> — the full sheet: numbered plan, legend, booth manifest.</li>
        <li><b>PNG / SVG</b> for decks and emails.</li>
        <li><b>CSVs</b> — booth manifest, electrical schedule, drape order.</li>
        <li><b>Work orders</b> for the crew, booth by booth.</li>
        <li><b>Publish public directory</b> — a link exhibitors can browse.</li></ul>`,
    },
    {
      page: 'index', target: '#btn3D',
      tryIt: true, advance: true, delay: 900,
      title: 'Stand the plan up — click 3D',
      body: `<p>The whole floor rises into a walkthrough — drape, tables, signs.
        The tour follows you in.</p>`,
    },
    {
      page: 'index', target: '.v3d-nav',
      title: 'Moving around in 3D',
      body: `<p><b>+ / −</b> zoom (hold them to glide). <b>360°</b> circles the booth
        you've selected — the client-wow button. <b>Drag</b> slides, <b>right-drag</b>
        orbits, <b>double-click</b> flies you anywhere.</p>`,
    },
    {
      page: 'index', target: () => $q('.v3d-top'),
      title: 'Signs, selection, and the way back',
      body: `<p>Every booth wears a <b>hanging sign</b> with its exhibitor and number.
        Click any item to select it — a bar appears to <b>delete</b> it right in 3D.
        <b>Fit floor</b> reframes everything; <b>Back to plan</b> returns to 2D.</p>`,
    },
    {
      page: 'index', target: '#v3dClose',
      tryIt: true, advance: true, delay: 500,
      title: 'Back to the plan',
      body: `<p>Click it — one more thing to show you.</p>`,
    },
    {
      page: 'index', target: null,
      title: 'Handing the plan to a client',
      body: `<p>From <b>Admin</b> on the dashboard: add the client company, assign
        their plan, set their password — they get <b>one permanent link</b>. They
        arrange their own furniture; the structure stays yours; the freeze date
        locks it for the build.</p>
        <p>That's the whole loop: <b>photo in, show floor out.</b> The <b>?</b> button
        holds every keyboard shortcut and restarts this tour. Enjoy.</p>`,
    },
  ];

  const clientSteps = () => [
    homeIntro('Welcome to your event workspace',
      `<p>Source One built this space for your show. This short tour points at the
       real buttons — when something glows, <b>click it</b>, or press <b>Next</b> and
       it happens for you. Skip any time.</p>`),
    {
      page: 'home', target: () => $q('.plan-card .btn[data-open]'),
      tryIt: true, nav: true,
      title: 'Open your plan',
      body: `<p>Your event is this card. Click <b>Open plan</b> — the tour continues
        inside.</p>`,
    },
    {
      page: 'index', target: null,
      title: 'Your floor plan, live',
      body: `<p>Everything you change <b>saves itself instantly</b>, and the Source One
        team sees it live. There is nothing to break — every move can be undone.</p>`,
    },
    {
      page: 'index', target: '.search-wrap', before: openPanel,
      title: 'Real rental furniture',
      body: `<p>The catalog on the left is Source One's actual inventory at true
        sizes — tables, seating, displays, <b>carpet and turf in the real colours</b>.
        Click an item, then click your space to place it.</p>`,
    },
    {
      page: 'index', target: '#canvas',
      tryIt: true, click: false,
      title: 'Arrange your space',
      body: `<p>Drag your items to move them; click one for <b>Duplicate / Delete</b>.
        Walls, booths and safety items are managed by Source One — you can see
        them, but not move them. Your furniture is all yours.</p>`,
    },
    {
      page: 'index', target: () => $q('#btnZoomIn')?.closest('.btn-group'),
      title: 'Zoom and fit',
      body: `<p>Zoom with these or the mouse wheel; the frame button fits your whole
        plan to the screen.</p>`,
    },
    {
      page: 'index', target: '#btn3D',
      tryIt: true, advance: true, delay: 900,
      title: 'Walk it in 3D — click here',
      body: `<p>Stand inside your event before it exists. The tour follows you in.</p>`,
    },
    {
      page: 'index', target: '.v3d-nav',
      title: 'Moving around',
      body: `<p><b>+ / −</b> zoom (hold to glide), <b>360°</b> circles your selected
        booth. <b>Drag</b> slides, <b>right-drag</b> orbits, <b>double-click</b> flies
        you anywhere.</p>`,
    },
    {
      page: 'index', target: '#v3dClose',
      tryIt: true, advance: true, delay: 500,
      title: 'Back to the plan',
      body: `<p>Click it to return to 2D.</p>`,
    },
    {
      page: 'index', target: null,
      title: 'The freeze date',
      body: `<p>Up to the freeze date you can rearrange freely. After it, the layout
        locks so what gets built matches what you approved — need a change after
        that, call your Source One planner.</p>
        <p><b>Help</b> on the dashboard reopens this tour any time. Enjoy the show.</p>`,
    },
  ];

  /* ============================================================
     Engine
     ============================================================ */
  let steps = [];
  let i = -1;
  let opened = false;
  let ui = null;
  let raf = 0;
  let target = null;

  const el = (t) => {
    const e = typeof t === 'function' ? t() : t ? $q(t) : null;
    return e || null;
  };
  const pass = (st) => {
    if (st.when && !st.when()) return false;
    if (st.target) {
      const e = el(st.target);
      if (!e) return false;
      /* a `before` hook can reveal a hidden target (slide-over panel,
         menu) — only require existence then; otherwise require visible */
      if (!st.before && !vis(e)) return false;
    }
    return true;
  };

  const CSS = `
  #fpTour { position: fixed; inset: 0; z-index: 2147480000; pointer-events: none;
    font: 14px/1.55 "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  #fpTour .ftm { position: fixed; background: rgba(10, 14, 24, .55);
    pointer-events: auto; }
  #fpTour .ft-guard { position: fixed; pointer-events: auto; }
  #fpTour .ft-ring { position: fixed; pointer-events: none; border: 2.5px solid #7c5cfc;
    border-radius: 12px; box-shadow: 0 0 0 5px rgba(124, 92, 252, .28);
    transition: box-shadow .3s; }
  #fpTour .ft-ring.pulse { animation: ftPulse 1.4s ease-in-out infinite; }
  @keyframes ftPulse {
    0%, 100% { box-shadow: 0 0 0 5px rgba(124, 92, 252, .28); }
    50% { box-shadow: 0 0 0 12px rgba(124, 92, 252, .12); } }
  #fpTour .ft-card { position: fixed; pointer-events: auto;
    width: min(400px, calc(100vw - 28px)); background: #fff; color: #131a26;
    border-radius: 14px; padding: 16px 20px 12px;
    box-shadow: 0 18px 60px rgba(10, 20, 50, .38); }
  #fpTour .ft-kick { display: flex; align-items: center; gap: 8px; font-size: 10.5px;
    font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #8a93a6; }
  #fpTour .ft-try { background: rgba(124, 92, 252, .14); color: #7c5cfc;
    border-radius: 99px; padding: 2.5px 8px; }
  #fpTour .ft-title { margin: 7px 0 5px; font-size: 16.5px; font-weight: 700;
    letter-spacing: -.015em; }
  #fpTour .ft-body { font-size: 13.5px; color: #3f4b5f; }
  #fpTour .ft-body p { margin: 0 0 8px; }
  #fpTour .ft-body ul { margin: 0 0 8px; padding-left: 17px; }
  #fpTour .ft-body li { margin: 0 0 5px; }
  #fpTour .ft-body b { color: #131a26; }
  #fpTour .ft-foot { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  #fpTour .ft-bar { flex: 1; height: 4px; border-radius: 99px; background: #e9ebf2;
    overflow: hidden; }
  #fpTour .ft-bar i { display: block; height: 100%; background: #7c5cfc;
    border-radius: 99px; transition: width .25s; }
  #fpTour .ft-btn { border: none; cursor: pointer; border-radius: 9px;
    font: 600 13px/1 "Inter", sans-serif; padding: 9px 14px; }
  #fpTour .ft-next { background: #7c5cfc; color: #fff; }
  #fpTour .ft-next:hover { background: #5a3fd6; }
  #fpTour .ft-back { background: transparent; color: #5a6779; padding: 9px 8px; }
  #fpTour .ft-back:hover { color: #131a26; }
  #fpTour .ft-skip { position: absolute; top: 10px; right: 12px; background: none;
    border: none; cursor: pointer; font: 600 11.5px/1 "Inter", sans-serif;
    color: #8a93a6; padding: 6px; }
  #fpTour .ft-skip:hover { color: #7c5cfc; }`;

  function ensureUi() {
    if (ui) return ui;
    const style = document.createElement('style');
    style.id = 'fpTourCss';
    style.textContent = CSS;
    document.head.appendChild(style);
    const rootEl = document.createElement('div');
    rootEl.id = 'fpTour';
    rootEl.innerHTML = `
      <div class="ftm" data-m="t"></div><div class="ftm" data-m="b"></div>
      <div class="ftm" data-m="l"></div><div class="ftm" data-m="r"></div>
      <div class="ft-guard"></div>
      <div class="ft-ring"></div>
      <div class="ft-card" role="dialog" aria-modal="true">
        <button class="ft-skip">Skip tour ✕</button>
        <div class="ft-kick"><span class="ft-count"></span><span class="ft-try" hidden>Try it</span></div>
        <h3 class="ft-title"></h3>
        <div class="ft-body"></div>
        <div class="ft-foot">
          <button class="ft-btn ft-back">Back</button>
          <div class="ft-bar"><i></i></div>
          <button class="ft-btn ft-next">Next</button>
        </div>
      </div>`;
    document.body.appendChild(rootEl);
    ui = {
      root: rootEl,
      masks: {
        t: rootEl.querySelector('[data-m="t"]'), b: rootEl.querySelector('[data-m="b"]'),
        l: rootEl.querySelector('[data-m="l"]'), r: rootEl.querySelector('[data-m="r"]'),
      },
      guard: rootEl.querySelector('.ft-guard'),
      ring: rootEl.querySelector('.ft-ring'),
      card: rootEl.querySelector('.ft-card'),
      count: rootEl.querySelector('.ft-count'),
      tryChip: rootEl.querySelector('.ft-try'),
      title: rootEl.querySelector('.ft-title'),
      body: rootEl.querySelector('.ft-body'),
      bar: rootEl.querySelector('.ft-bar i'),
      back: rootEl.querySelector('.ft-back'),
      next: rootEl.querySelector('.ft-next'),
      skip: rootEl.querySelector('.ft-skip'),
    };
    ui.skip.onclick = () => done();
    ui.back.onclick = () => back();
    ui.next.onclick = () => onNext();
    return ui;
  }

  /* geometry: 4 masks leave a hole over the target; the guard blocks
     clicks in the hole on look-don't-touch steps */
  function place() {
    const st = steps[i];
    if (!st) return;
    const vw = innerWidth, vh = innerHeight;
    const e = el(st.target);
    target = e && vis(e) ? e : null;
    const m = ui.masks;
    const set = (d, x, y, w, h) => {
      d.style.left = x + 'px'; d.style.top = y + 'px';
      d.style.width = Math.max(0, w) + 'px'; d.style.height = Math.max(0, h) + 'px';
    };

    if (!target) {
      set(m.t, 0, 0, vw, vh); set(m.b, 0, vh, vw, 0);
      set(m.l, 0, 0, 0, 0); set(m.r, vw, 0, 0, 0);
      ui.ring.style.display = 'none';
      ui.guard.style.display = 'none';
      const c = ui.card.getBoundingClientRect();
      ui.card.style.left = Math.round((vw - c.width) / 2) + 'px';
      ui.card.style.top = Math.round(Math.max(20, (vh - c.height) / 2)) + 'px';
      return;
    }

    const r = target.getBoundingClientRect();
    const pad = st.pad ?? 6;
    const hx = Math.max(0, r.left - pad), hy = Math.max(0, r.top - pad);
    const hx2 = Math.min(vw, r.right + pad), hy2 = Math.min(vh, r.bottom + pad);
    set(m.t, 0, 0, vw, hy);
    set(m.b, 0, hy2, vw, vh - hy2);
    set(m.l, 0, hy, hx, hy2 - hy);
    set(m.r, hx2, hy, vw - hx2, hy2 - hy);

    ui.ring.style.display = '';
    ui.ring.style.left = hx + 'px'; ui.ring.style.top = hy + 'px';
    ui.ring.style.width = (hx2 - hx) + 'px'; ui.ring.style.height = (hy2 - hy) + 'px';
    ui.ring.classList.toggle('pulse', !!st.tryIt);

    if (st.tryIt) { ui.guard.style.display = 'none'; }
    else {
      ui.guard.style.display = '';
      ui.guard.style.left = hx + 'px'; ui.guard.style.top = hy + 'px';
      ui.guard.style.width = (hx2 - hx) + 'px'; ui.guard.style.height = (hy2 - hy) + 'px';
    }

    /* card: below → above → beside → floating clear of the hole */
    const c = ui.card.getBoundingClientRect();
    const gap = 14;
    let cx, cy;
    if (vh - hy2 >= c.height + gap + 8) { cy = hy2 + gap; cx = hx; }
    else if (hy >= c.height + gap + 8) { cy = hy - c.height - gap; cx = hx; }
    else if (vw - hx2 >= c.width + gap + 8) { cx = hx2 + gap; cy = hy; }
    else if (hx >= c.width + gap + 8) { cx = hx - c.width - gap; cy = hy; }
    else { cx = (vw - c.width) / 2; cy = vh - c.height - 20; }
    ui.card.style.left = Math.round(Math.min(Math.max(10, cx), vw - c.width - 10)) + 'px';
    ui.card.style.top = Math.round(Math.min(Math.max(10, cy), vh - c.height - 10)) + 'px';
  }

  function tick() {
    if (!opened) return;
    place();
    raf = requestAnimationFrame(tick);
  }

  function show(j) {
    steps[i]?.leave?.();
    i = j;
    const st = steps[i];
    st.before?.();
    ui.count.textContent = `Step ${i + 1} of ${steps.length}`;
    ui.tryChip.hidden = !st.tryIt;
    ui.title.textContent = st.title;
    ui.body.innerHTML = st.body;
    ui.bar.style.width = `${Math.round(((i + 1) / steps.length) * 100)}%`;
    const last = !steps.slice(i + 1).some(pass);
    ui.next.textContent = last ? 'Finish — let’s go' :
      (st.tryIt && st.click !== false) ? 'Do it for me' : 'Next';
    const firstOnPage = !steps.slice(0, i).some((s) => s.page === page && pass(s));
    ui.back.style.visibility = firstOnPage ? 'hidden' : 'visible';
    const e = el(st.target);
    if (e && e.scrollIntoView) e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    place();
  }

  function next() {
    let j = i + 1;
    while (j < steps.length && !pass(steps[j])) j++;
    if (j >= steps.length) return done();
    if (steps[j].page !== page) return done(false); /* they'll resume by KEY */
    show(j);
  }
  function back() {
    let j = i - 1;
    while (j >= 0 && (steps[j].page !== page || !pass(steps[j]))) j--;
    if (j >= 0) show(j);
  }

  function onNext() {
    const st = steps[i];
    const last = !steps.slice(i + 1).some(pass);
    if (last) return done();
    if (st.nav) {
      localStorage.setItem(KEY, JSON.stringify({ i: i + 1 }));
      const e = el(st.target);
      if (e) { e.click(); return; }             /* navigation ends this page */
      localStorage.removeItem(KEY);
      return next();
    }
    if (st.tryIt && st.click !== false) {
      const e = el(st.target);
      if (e) {
        e.click();
        setTimeout(() => { if (opened && steps[i] === st) next(); }, st.delay ?? 450);
        return;
      }
    }
    next();
  }

  /* a real click on the glowing element advances the step too */
  function onDown(ev) {
    if (!opened) return;
    const st = steps[i];
    if (!st || !target) return;
    if (target !== ev.target && !target.contains(ev.target)) return;
    if (st.nav) localStorage.setItem(KEY, JSON.stringify({ i: i + 1 }));
    if (st.advance) setTimeout(() => { if (opened && steps[i] === st) next(); }, st.delay ?? 450);
  }
  function onKey(ev) {
    if (!opened) return;
    if (ev.key === 'Escape') { ev.stopPropagation(); done(); }
  }

  function done(mark = true) {
    if (mark) { FP.setPref?.('tourDone', 1); localStorage.removeItem(KEY); }
    steps[i]?.leave?.();
    opened = false;
    cancelAnimationFrame(raf);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (narrow()) $q('.panel.left')?.classList.remove('open');
    ui?.root?.remove();
    document.getElementById('fpTourCss')?.remove();
    ui = null;
  }

  function begin(at) {
    ensureUi();
    opened = true;
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    show(at);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  /* start fresh on this page */
  function open() {
    if (opened) return;
    localStorage.removeItem(KEY);
    steps = isClient() ? clientSteps() : staffSteps();
    const at = steps.findIndex((s) => s.page === page && pass(s));
    if (at >= 0) begin(at);
  }

  /* continue a tour that navigated here */
  function resume() {
    if (opened) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* - */ }
    if (!saved || typeof saved.i !== 'number') return;
    localStorage.removeItem(KEY);
    steps = isClient() ? clientSteps() : staffSteps();
    let j = saved.i;
    while (j < steps.length && (steps[j].page !== page || !pass(steps[j]))) j++;
    if (j < steps.length && steps[j].page === page) begin(j);
  }

  /* the Studio resumes once the plan is on screen */
  if (page === 'index') {
    let armed = false;
    const arm = () => {
      if (armed) return;
      armed = true;
      setTimeout(resume, 700);
    };
    FP.on?.('plan-loaded', arm);
    setTimeout(() => { if (FP.auth?.signedIn?.()) arm(); }, 3500);
  }

  FP.tour = { open, resume };
})(window);
