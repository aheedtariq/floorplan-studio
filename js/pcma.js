/* ============================================================
   pcma.js — PCMA Convening Leaders, worked as a real plan.

   Convening Leaders is not a conventional exhibit hall, and laying it out
   like one would misrepresent the show. It is a single large floor built
   around a central stage, with learning theatres, Braindate tables and
   sponsor activations arranged as an experience rather than numbered rows.

   Layout logic (320 × 200 ft):

     · Main Stage block holds the centre, theatre seating below it
     · two full-height circulation aisles either side of that block
     · learning lounges north, Braindate and hospitality south
     · sponsor activations sold as islands and peninsulas, never 10×10
       inline booths — PCMA does not sell those, and drawing them that
       way would misrepresent the offer to a sponsor reading the plan
     · perimeter concourse kept clear on both long walls

   Three problems are planted on purpose so the rules engine has real
   work to show: one activation on low-ceiling dead space, one long
   feeder run under-gauged, and one distro carrying too much load.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const SPONSORS = [
    ['Encore Global', 'sold', 'premium'],
    ['Freeman', 'sold', 'premium'],
    ['Maritz Global Events', 'approved', 'premium'],
    ['Cvent', 'sold', 'premium'],
    ['Visit Denver', 'sold', 'standard'],
    ['Hilton Worldwide', 'approved', 'standard'],
    ['Tourism Toronto', 'submitted', 'standard'],
    ['Las Vegas CVA', 'sold', 'standard'],
    ['Choose Chicago', 'held', 'standard'],
    ['Experience Columbus', 'awaiting', 'standard'],
  ];

  FP.pcmaPlan = () => {
    const plan = FP.blankPlan('PCMA Convening Leaders 2027');
    plan.venue = 'Colorado Convention Center';
    plan.hall = 'Exhibit Hall F';
    plan.width = 320;
    plan.height = 200;
    plan.grid = 5;
    plan.unit = 'ft';

    const today = new Date();
    const iso = (d) => {
      const x = new Date(today);
      x.setDate(x.getDate() + d);
      return x.toISOString().slice(0, 10);
    };
    plan.dates = {
      loadIn: iso(74), open: iso(78), teardown: iso(81),
      deadline: iso(45), freeze: iso(66),
    };

    const els = [];
    const add = (kind, geometry, props = {}, parentId = null) => {
      const el = FP.makeElement(kind, geometry, parentId);
      Object.assign(el.props, props);
      els.push(el);
      return el;
    };

    /* ================= structure ================= */
    add('loading-dock', { x: 0, y: 84, w: 24, h: 32 }, { label: 'Dock 1', dockId: 'D1' });
    add('loading-dock', { x: 296, y: 84, w: 24, h: 32 }, { label: 'Dock 2', dockId: 'D2' });

    /* Structural grid, clear of every sold footprint. */
    [80, 160, 240].forEach((x) => {
      [56, 144].forEach((y) =>
        add('column', { x: x - 1.5, y: y - 1.5, w: 3, h: 3 }, { label: 'Column' }));
    });

    add('door', { x: 130, y: 198, w: 26, h: 2 }, { label: 'Main entrance', clearance: 14 });
    add('door', { x: 168, y: 198, w: 26, h: 2 }, { label: 'Main entrance', clearance: 14 });
    add('door', { x: 0, y: 30, w: 2, h: 18 }, { label: 'Concourse entry', clearance: 10 });

    /* ================= life safety ================= */
    [[0, 12], [0, 170], [318, 0], [318, 168]].forEach(([x, y], i) =>
      add('fire-exit', { x, y, w: 2, h: 12 }, { label: `Exit ${i + 1}`, clearance: 12 }));
    add('fire-exit', { x: 20, y: 0, w: 12, h: 2 }, { label: 'Exit 5', clearance: 12 });
    add('fire-exit', { x: 288, y: 0, w: 12, h: 2 }, { label: 'Exit 6', clearance: 12 });

    add('fire-lane', { x: 0, y: 0, w: 320, h: 14 }, { label: 'North concourse' });
    add('fire-lane', { x: 0, y: 186, w: 320, h: 14 }, { label: 'South concourse' });

    add('extinguisher', { x: 6, y: 70, r: 1.2 }, { label: 'Extinguisher' });
    add('extinguisher', { x: 314, y: 70, r: 1.2 }, { label: 'Extinguisher' });
    add('first-aid', { x: 280, y: 166, w: 14, h: 10 }, { label: 'First aid' });

    /* ================= circulation =================
       Two full-height aisles flanking the stage block. Nothing is placed
       inside them, which is the point — the rules engine treats an aisle
       as keep-clear. */
    add('aisle', { x: 100, y: 16, w: 10, h: 168 }, { label: 'West aisle' });
    add('aisle', { x: 210, y: 16, w: 10, h: 168 }, { label: 'East aisle' });

    /* ================= the centre: Main Stage ================= */
    add('zone', { x: 112, y: 56, w: 96, h: 90 }, { label: 'Main Stage', color: '#a855f7' });
    add('stage', { x: 130, y: 62, w: 60, h: 26 }, { label: 'Main Stage' });
    add('zone', { x: 116, y: 96, w: 88, h: 44 },
      { label: 'Theatre seating — 900', color: '#8b5cf6' });
    add('av-booth', { x: 190, y: 128, w: 14, h: 10 }, { label: 'FOH / AV control' });

    /* ================= learning spaces ================= */
    add('zone', { x: 18, y: 20, w: 80, h: 58 }, { label: 'Learning Lounge West', color: '#14b8a6' });
    add('lounge', { x: 24, y: 32, w: 32, h: 22 }, { label: 'Campfire A' });
    add('lounge', { x: 62, y: 32, w: 32, h: 22 }, { label: 'Campfire B' });

    add('zone', { x: 222, y: 20, w: 80, h: 58 }, { label: 'Learning Lounge East', color: '#14b8a6' });
    add('lounge', { x: 228, y: 32, w: 32, h: 22 }, { label: 'Campfire C' });
    add('lounge', { x: 266, y: 32, w: 32, h: 22 }, { label: 'Innovation Lab' });

    /* Braindate — the busiest non-session space on the floor. */
    add('zone', { x: 18, y: 120, w: 80, h: 60 }, { label: 'Braindate Hub', color: '#06b6d4' });
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        add('table', { x: 24 + c * 15, y: 132 + r * 16, w: 8, h: 3 },
          { label: `BD-${r * 5 + c + 1}` });
      }
    }

    /* ================= hospitality ================= */
    add('zone', { x: 222, y: 120, w: 80, h: 60 }, { label: 'Coffee & Community', color: '#f97316' });
    add('food', { x: 228, y: 132, w: 32, h: 24 }, { label: 'Coffee bar' });
    add('food', { x: 266, y: 132, w: 30, h: 24 }, { label: 'Grab & Go' });

    add('registration', { x: 124, y: 156, w: 72, h: 12 }, { label: 'Registration' });
    add('restroom', { x: 0, y: 120, w: 14, h: 22 }, { label: 'Restrooms' });
    add('restroom', { x: 306, y: 30, w: 14, h: 22 }, { label: 'Restrooms' });
    add('storage', { x: 300, y: 60, w: 16, h: 14 }, { label: 'Show storage' });

    /* ================= dead space ================= */
    add('dead-space', { x: 66, y: 86, w: 32, h: 26 },
      { label: 'Low ceiling', notes: 'Soffit drops to 11 ft — no hanging signs, no double-deck build.' });
    add('dead-space', { x: 298, y: 118, w: 20, h: 20 },
      { label: 'Dock turning circle', notes: 'Must stay clear for forklift access throughout load-in.' });

    /* ================= rigging ================= */
    add('rigging-zone', { x: 112, y: 56, w: 96, h: 90 }, { label: 'Rigging permitted — centre bay' });
    add('rigging-point', { x: 140, y: 74, r: 1 }, { label: 'Stage truss west', loadLbs: 1800 });
    add('rigging-point', { x: 180, y: 74, r: 1 }, { label: 'Stage truss east', loadLbs: 1800 });

    /* ================= sponsor activations =================
       Islands across the centre band, peninsulas against the side walls.
       A-104 sits on the low-ceiling dead space on purpose. */
    /* Islands carry a full 10 ft aisle between them — the show minimum,
       and the reason these are priced as islands in the first place. */
    const ACTIVATIONS = [
      /* north centre band, between the concourse and the stage block */
      { x: 112, y: 20, w: 25, h: 30, type: 'island' },
      { x: 147, y: 20, w: 25, h: 30, type: 'island' },
      { x: 182, y: 20, w: 25, h: 30, type: 'island' },
      /* west band — A105 lands on the low ceiling, on purpose */
      { x: 28, y: 86, w: 30, h: 26, type: 'peninsula' },
      { x: 68, y: 86, w: 30, h: 26, type: 'peninsula' },
      /* east band */
      { x: 226, y: 86, w: 30, h: 26, type: 'peninsula' },
      { x: 266, y: 86, w: 30, h: 26, type: 'peninsula' },
    ];

    ACTIVATIONS.forEach((a, i) => {
      const [name, status, tier] = SPONSORS[i % SPONSORS.length];
      add('space', { x: a.x, y: a.y, w: a.w, h: a.h, rot: 0 }, {
        number: `A${101 + i}`,
        exhibitor: name,
        contact: `events@${name.toLowerCase().replace(/[^a-z]+/g, '')}.com`,
        status,
        spaceType: a.type,
        tier,
      });
    });

    plan.elements = els;

    /* ================= electrical =================
       Feeders run orthogonally the way overhead cable actually gets
       pulled — never diagonally across a show floor. */
    const elec = (kind, geometry, props, parentId = null) => {
      const el = FP.makeElement(kind, geometry, parentId);
      Object.assign(el.props, props);
      plan.elements.push(el);
      return el;
    };

    elec('electrical-panel', { x: 3, y: 156, w: 5, h: 2.5 }, {
      panelId: 'MDP-1', voltage: '480', phase: '3', mainAmps: 1200, clearance: 3,
      label: 'Main distribution', notes: 'House service — Hall F switchgear.',
    });

    const BOARDS = [
      ['D-1', 104, 156, 200],   /* west aisle, south */
      ['D-2', 104, 30, 200],    /* west aisle, north */
      ['D-3', 214, 30, 200],    /* east aisle, north */
      ['D-4', 214, 156, 100],   /* east aisle, south — undersized on purpose */
    ];
    BOARDS.forEach(([id, x, y, amps]) =>
      elec('distro-box', { x, y, w: 2.5, h: 2 }, {
        distroId: id, panelId: 'MDP-1', voltage: '208', phase: '3',
        mainAmps: amps, label: id,
      }));

    const feeder = (circuit, x1, y1, x2, y2, gauge, amps = 150) =>
      elec('electrical-run', { x1, y1, x2, y2 }, {
        circuitId: circuit, panelId: 'MDP-1', voltage: '208',
        gauge, amps, method: 'overhead',
      });

    /* MDP sits south-west; everything routes along the wall then across. */
    feeder('F-1', 8, 157, 104, 157, '1/0');
    feeder('F-2a', 8, 157, 8, 31, '1/0');
    feeder('F-2b', 8, 31, 104, 31, '1/0');
    feeder('F-3', 104, 31, 214, 31, '1/0');
    /* Long southern run on 2 AWG — over the 3% limit, on purpose. */
    feeder('F-4', 104, 157, 214, 157, '2');

    /* House loads. A show floor draws far more from hospitality and
       production than from the sponsor booths, and the crew needs those
       circuits on the same schedule.

       D-4 is deliberately a 100 A board carrying the whole food-service
       run — it lands over capacity, which is exactly the kind of thing
       that is cheap to fix on a plan and expensive to fix on site. */
    const houseDrop = (label, x, y, amps, board, connector, hours = 'show') =>
      elec('power-drop', { x, y, r: 0.9 }, {
        label, amps, voltage: '208', phase: '1',
        panelId: board, circuitId: `${board}-H${amps}`,
        connector, hours, capacity: 100,
      });

    houseDrop('Braindate Hub', 58, 150, 30, 'D-1', 'l5-20');
    houseDrop('Registration', 130, 162, 20, 'D-1', 'l5-20', '24hr');
    houseDrop('Coffee bar', 232, 138, 60, 'D-4', 'cam', '24hr');
    houseDrop('Grab & Go', 270, 138, 45, 'D-4', 'cam');
    houseDrop('FOH / AV control', 194, 132, 20, 'D-4', 'l6-30', '24hr');
    houseDrop('Main Stage production', 134, 66, 60, 'D-3', 'cam');

    /* One drop per activation, fed from the nearest board. */
    const nearest = (x, y) => {
      let best = BOARDS[0], bd = Infinity;
      for (const b of BOARDS) {
        const d = Math.hypot(b[1] - x, b[2] - y);
        if (d < bd) { bd = d; best = b; }
      }
      return best[0];
    };

    plan.elements
      .filter((e) => e.kind === 'space')
      .forEach((s, i) => {
        const board = nearest(s.geometry.x, s.geometry.y);
        elec('power-drop', { x: s.geometry.x + 2, y: s.geometry.y + 2, r: 0.9 }, {
          label: `${s.props.number}-P`,
          amps: [30, 60, 30, 60, 20][i % 5],
          voltage: '208', phase: '1',
          panelId: board,
          circuitId: `${board}-${(i % 8) + 1}`,
          connector: ['l6-30', 'cam', 'l6-30', 'cam', 'l5-20'][i % 5],
          hours: i % 4 === 0 ? '24hr' : 'show',
          capacity: 60,
        }, s.id);
      });

    plan.nextSpaceNo = 101 + ACTIVATIONS.length;
    plan.revision = 2;
    return plan;
  };
})(window);
