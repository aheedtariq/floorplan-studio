/* ============================================================
   tour.js — the first-login tutorial.

   A paged walkthrough of the whole app in plain language: one idea
   per page, a Skip button on every page, re-openable from Help.
   Staff and clients get different tours, because they see different
   apps. Shows once (FP.prefs.tourDone), then only on request.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const svg = (path) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

  /* icons reused from the catalog set, so the tour looks like the app */
  const I = () => FP.ICONS || {};

  const staffPages = () => [
    {
      icon: I().booth,
      title: 'Welcome to Floorplan Studio',
      body: `<p>This is where Source One builds every show floor — and where your
        clients watch it happen live.</p>
        <ul>
          <li><b>Draw the floor</b> from a photo, a scan, or a template.</li>
          <li><b>Share it</b> — each client gets a private link to their own plans.</li>
          <li><b>Walk it in 3D</b> before the first truck rolls.</li>
        </ul>`,
    },
    {
      icon: I().panel,
      title: 'Your dashboard',
      body: `<p>Every plan you can see is a card here.</p>
        <ul>
          <li><b>Open plan</b> takes you into the Studio to edit.</li>
          <li><b>Photos</b> holds every venue photo saved to that plan.</li>
          <li><b>Client link</b> is how a customer gets in — more on that soon.</li>
          <li>The dropdown on each card assigns the plan to a client company.</li>
        </ul>`,
    },
    {
      icon: I().zone,
      title: 'Start from a template',
      body: `<p>New customer order? Don't start from nothing.</p>
        <ul>
          <li>Click <b>New plan</b> and pick a layout — booth rows, tabletop expo,
            or island showcase. Booths arrive numbered and furnished.</li>
          <li>Perfected a layout? Press <b>Save as template</b> on its card and
            reuse it for the next order.</li>
        </ul>`,
    },
    {
      icon: I().dim,
      title: 'Photograph the venue',
      body: `<p>Every hall has a printed floor plan on the wall — that photo is
        your starting point.</p>
        <ul>
          <li>Face it <b>straight on</b>, whole sheet in frame, no glare.</li>
          <li>Note <b>one real measurement</b> — a double door is 6 ft wide.</li>
          <li>No placard? Shoot the floor from a balcony, high and centred.</li>
        </ul>`,
    },
    {
      icon: I().wall,
      title: 'Turn the photo into a plan',
      body: `<p>In the Studio, open <b>Import image</b> (left panel). Two ways:</p>
        <ul>
          <li><b>Convert with AI</b> — the app reads the photo and draws the
            walls, doors, and numbered booths for you. Type the hall width to
            lock the scale, then just fine-tune.</li>
          <li><b>Trace it</b> — the photo sits under the plan; you calibrate one
            known length and draw over it, then remove the photo.</li>
        </ul>`,
    },
    {
      icon: I().wifi,
      title: 'Or scan the room with an iPhone',
      body: `<p>Pro iPhones (12 Pro and newer) carry a <b>LiDAR scanner</b> — a
        laser that measures the room as you walk it.</p>
        <ul>
          <li>Scan with any RoomPlan scanner app and export the scan as
            <b>JSON</b>.</li>
          <li>Import it here: walls, doors, and furniture appear at their true,
            measured sizes. No tracing, no scaling.</li>
        </ul>`,
    },
    {
      icon: I().table,
      title: 'Build the floor',
      body: `<ul>
          <li><b>Quick booths</b> — click a size, click the floor. Every booth
            arrives with a 6 ft draped table and two chairs, facing its aisle.</li>
          <li><b>The catalog</b> is Source One's real rental inventory — tables,
            lounges, bars, staging, carpet and turf in the real colours.</li>
          <li>Every item carries its name on the plan, so the drawing reads
            like a drawing.</li>
        </ul>`,
    },
    {
      icon: I().reg,
      title: 'Booths and exhibitors',
      body: `<ul>
          <li>Click a booth to set its <b>number</b>, <b>exhibitor</b>, and
            status — the name shows on the plan and on the booth's sign in 3D.</li>
          <li>The <b>Booths</b> tab lists every space; search by number or
            company.</li>
          <li>Click anything to <b>duplicate or delete</b> it right there.</li>
        </ul>`,
    },
    {
      icon: I().fire,
      title: 'Safety and power',
      body: `<ul>
          <li>The <b>Safety</b> tab flags real problems — blocked fire exits,
            missing clearances, booths on egress paths — as you draw.</li>
          <li>The <b>Power</b> tab lays out drops, panels, and distro runs, and
            exports an electrical schedule.</li>
        </ul>`,
    },
    {
      icon: I().stage,
      title: 'Walk it in 3D',
      body: `<p>The <b>3D</b> button stands the whole plan up — drape, tables,
        signs, the lot.</p>
        <ul>
          <li><b>Drag</b> the floor to slide · <b>right-drag</b> to orbit ·
            <b>scroll or the + / − buttons</b> to zoom.</li>
          <li><b>360°</b> circles the booth you've selected — the client-wow
            button.</li>
          <li>Double-click flies you anywhere. You can move, rotate, and delete
            things in 3D too.</li>
        </ul>`,
    },
    {
      icon: I().door,
      title: 'Hand it to the client',
      body: `<p>Open <b>Admin</b> from the dashboard.</p>
        <ul>
          <li>Add the client company, assign their plan.</li>
          <li>Each client has <b>one permanent link</b> — set their password and
            send both. They sign in and see only their own plans.</li>
          <li>They arrange furniture; the structure stays yours. After the
            <b>freeze date</b>, their layout locks for the build.</li>
        </ul>`,
    },
    {
      icon: I().panel,
      title: 'Print and export',
      body: `<ul>
          <li><b>Export → Print / PDF</b> — the full sheet: numbered floor plan,
            legend, booth manifest, drape takeoff.</li>
          <li>PNG and SVG for decks and emails; CSVs and <b>work orders</b> for
            the crew.</li>
        </ul>
        <p style="margin-top:14px">That's the whole loop: photo in, show floor out.
        <b>Help</b> reopens this tour any time, and the full manual is one click away.</p>`,
    },
  ];

  const clientPages = () => [
    {
      icon: I().booth,
      title: 'Welcome to your event workspace',
      body: `<p>Source One built this space for your show. Here you can see your
        floor plan, arrange your own furniture, and walk the hall in 3D —
        everything you change saves automatically, and our team sees it live.</p>`,
    },
    {
      icon: I().panel,
      title: 'Open your plan',
      body: `<ul>
          <li>Your event is a card on this dashboard — click <b>Open plan</b>.</li>
          <li>There is no save button. Every change stores itself the moment
            you make it.</li>
        </ul>`,
    },
    {
      icon: I().table,
      title: 'Arrange your space',
      body: `<ul>
          <li>Drag tables, seating, and displays from the catalog on the left —
            it's Source One's real rental inventory at real sizes.</li>
          <li>Carpet and turf come in the real colours we stock.</li>
          <li>Walls, booths, and safety items are managed by Source One — you
            can see them, but not move them. Your furniture is all yours.</li>
        </ul>`,
    },
    {
      icon: I().stage,
      title: 'Walk it in 3D',
      body: `<ul>
          <li>Click <b>3D</b> in the top bar to stand inside your event.</li>
          <li><b>Drag</b> slides the view · <b>right-drag</b> orbits ·
            <b>+ / −</b> zoom · <b>360°</b> circles your booth.</li>
          <li>Double-click anywhere to fly there.</li>
        </ul>`,
    },
    {
      icon: I().door,
      title: 'The freeze date',
      body: `<p>Up to the freeze date you can rearrange freely. After it, the
        layout locks so what gets built matches what you approved. Need a change
        after the freeze? Call your Source One planner.</p>
        <p style="margin-top:14px"><b>Help</b> reopens this tour any time.</p>`,
    },
  ];

  function open() {
    const pages = FP.auth?.isClient?.() ? clientPages() : staffPages();
    let i = 0;
    const o = document.getElementById('overlay');
    if (!o) return;

    const done = () => {
      FP.setPref?.('tourDone', 1);
      o.hidden = true;
      o.innerHTML = '';
    };

    const paint = () => {
      const p = pages[i];
      o.className = 'veil';
      o.hidden = false;
      o.innerHTML = `<div class="sheet tour">
        <div class="tour-top">
          <span class="tour-count">${i + 1} / ${pages.length}</span>
          <button class="tour-skip" id="tSkip">Skip the tour</button>
        </div>
        <div class="tour-ico">${p.icon ? svg(p.icon) : ''}</div>
        <h2>${p.title}</h2>
        <div class="tour-body">${p.body}</div>
        <div class="tour-dots">${pages.map((_, d) =>
          `<i class="${d === i ? 'on' : ''}${d < i ? ' past' : ''}" data-dot="${d}"></i>`).join('')}</div>
        <div class="sheet-foot">
          <button class="btn ghost" id="tBack" ${i === 0 ? 'disabled' : ''}>Back</button>
          <div class="grow"></div>
          <button class="btn primary" id="tNext">${i === pages.length - 1 ? 'Finish — let’s go' : 'Next'}</button>
        </div>
      </div>`;
      o.onclick = null;                     /* no click-outside dismissal mid-tour */
      document.getElementById('tSkip').onclick = done;
      document.getElementById('tBack').onclick = () => { if (i > 0) { i--; paint(); } };
      document.getElementById('tNext').onclick = () => {
        if (i === pages.length - 1) return done();
        i++; paint();
      };
      o.querySelectorAll('[data-dot]').forEach((d) =>
        d.addEventListener('click', () => { i = Number(d.dataset.dot); paint(); }));
    };
    paint();
  }

  FP.tour = { open };
})(window);
