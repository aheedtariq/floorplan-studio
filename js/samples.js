/* ============================================================
   samples.js — a worked example show.

   Laid out to real trade-show geometry: back-to-back inline rows, 12 ft
   cross aisles, islands at the back, fire exits on three walls with
   their clearance respected, and one booth with a submitted interior so
   the booth-scope editor has something to open. One column is placed
   inside a booth on purpose — that is the warning the rules engine is
   supposed to catch before an exhibitor discovers it on site.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const EXHIBITORS = [
    ['Northwind Medical', 'sold'], ['Cascade Robotics', 'sold'],
    ['Halberd Systems', 'approved'], ['Lumen Diagnostics', 'submitted'],
    ['Terrafirma Group', 'sold'], ['Vector Labs', 'held'],
    ['Ironline Tooling', 'approved'], ['Brightpath Software', 'sold'],
    ['Meridian Freight', 'held'], ['Solstice Energy', 'submitted'],
    ['Kestrel Aerospace', 'sold'], ['Anvil Manufacturing', 'changes'],
    ['Copperline Utilities', 'sold'], ['Redwood Analytics', 'approved'],
    ['Pinnacle Safety', 'awaiting'], ['Orchard Foods', 'sold'],
    ['Delta Composites', 'held'], ['Sable Instruments', 'sold'],
  ];

  FP.samplePlan = () => {
    const plan = FP.blankPlan('Pacific Trade Expo 2026');
    plan.venue = 'Riverside Convention Center';
    plan.hall = 'Hall B';
    plan.width = 200;
    plan.height = 120;
    plan.grid = 5;
    plan.dates = {
      loadIn: '2026-09-14', open: '2026-09-16',
      teardown: '2026-09-19', deadline: '2026-08-21', freeze: '',
    };

    /* makeElement reads FP.plan for numbering, so build against the new plan */
    const prev = FP.plan;
    FP.plan = plan;

    const add = (kind, geometry, props = {}, parentId = null) => {
      const el = FP.makeElement(kind, geometry, parentId);
      Object.assign(el.props, props);
      plan.elements.push(el);
      return el;
    };

    /* ---------------- shell ---------------- */
    add('loading-dock', { x: 150, y: 0, w: 14, h: 10 }, { label: 'Dock 1', dockId: 'D1' });
    add('loading-dock', { x: 168, y: 0, w: 14, h: 10 }, { label: 'Dock 2', dockId: 'D2' });

    /* fire exits — two per long wall, two on the top wall */
    add('fire-exit', { x: 0, y: 30, w: 2, h: 8 }, { label: 'Exit A' });
    add('fire-exit', { x: 0, y: 80, w: 2, h: 8 }, { label: 'Exit B' });
    add('fire-exit', { x: 198, y: 30, w: 2, h: 8 }, { label: 'Exit C' });
    add('fire-exit', { x: 198, y: 80, w: 2, h: 8 }, { label: 'Exit D' });
    add('fire-exit', { x: 60, y: 0, w: 8, h: 2 }, { label: 'Exit E' });
    add('fire-exit', { x: 132, y: 0, w: 8, h: 2 }, { label: 'Exit F' });

    /* main entrance doors on the front wall */
    add('door', { x: 80, y: 118.5, w: 8, h: 1.5 }, { label: 'Main entrance' });
    add('door', { x: 112, y: 118.5, w: 8, h: 1.5 }, { label: 'Entrance 2' });

    /* ---------------- unsellable floor ---------------- */
    add('dead-space', { x: 6, y: 6, w: 14, h: 14 }, { label: 'Switchgear', notes: 'No access — house electrical.' });
    add('dead-space', { x: 176, y: 70, w: 20, h: 18 }, { label: 'Low ceiling', notes: 'Ceiling drops to 9 ft under the mezzanine.' });
    add('dead-space-poly', {
      pts: [[6, 58], [24, 58], [24, 70], [15, 77], [6, 77]],
    }, { label: 'Ramp', notes: 'Sloped floor, not sellable.' });

    /* ---------------- circulation ---------------- */
    /* Aisles stop short of the café so the keep-clear rule stays satisfied. */
    add('aisle', { x: 20, y: 45, w: 155, h: 12 }, { label: 'Aisle 100' });
    add('aisle', { x: 20, y: 77, w: 155, h: 11 }, { label: 'Aisle 200' });
    add('aisle', { x: 95, y: 20, w: 12, h: 60 }, { label: 'Cross aisle' });

    add('egress-path', { x1: 101, y1: 51, x2: 22, y2: 51 }, { label: 'To Exit A' });
    add('egress-path', { x1: 101, y1: 82.5, x2: 172, y2: 82.5 }, { label: 'To Exit D' });

    /* ---------------- amenities ---------------- */
    add('stage', { x: 20, y: 6, w: 30, h: 14 }, { label: 'Keynote stage' });
    add('restroom', { x: 176, y: 8, w: 14, h: 12 }, { label: 'Restrooms' });
    add('food', { x: 176, y: 52, w: 20, h: 16 }, { label: 'Café' });
    add('lounge', { x: 176, y: 100, w: 20, h: 8 }, { label: 'Lounge' });
    add('registration', { x: 20, y: 109, w: 24, h: 8 }, { label: 'Registration' });
    add('storage', { x: 48, y: 109, w: 12, h: 8 }, { label: 'Storage' });
    add('first-aid', { x: 132, y: 109, w: 12, h: 8 }, { label: 'First aid' });

    /* ---------------- columns ---------------- */
    add('column', { x: 98, y: 30, w: 2.5, h: 2.5 }, { label: 'C1' });
    add('column', { x: 98, y: 68, w: 2.5, h: 2.5 }, { label: 'C2' });
    /* deliberately inside a booth — the rules engine should flag it */
    add('column', { x: 61, y: 61, w: 2.5, h: 2.5 }, { label: 'C3' });

    /* ---------------- inline booth rows ---------------- */
    const leftCols = [25, 35, 45, 55, 65, 75, 85];
    const rightCols = [107, 117, 127, 137, 147, 157];
    const cols = [...leftCols, ...rightCols];
    const spaces = [];
    let ex = 0;

    for (const y of [25, 35, 57, 67]) {
      for (const x of cols) {
        const el = add('space', { x, y, w: 10, h: 10 }, { spaceType: 'inline' });
        spaces.push(el);
      }
    }

    /* corner spaces at the end of each row sell at a premium */
    spaces.forEach((s) => {
      const { x } = s.geometry;
      if (x === 25 || x === 85 || x === 107 || x === 157) {
        s.props.spaceType = 'corner';
        s.props.tier = 'premium';
      }
    });

    /* ---------------- islands ---------------- */
    for (const x of [30, 70, 110, 150]) {
      spaces.push(add('space', { x, y: 88, w: 20, h: 20 },
        { spaceType: 'island', tier: 'premium' }));
    }

    /* ---------------- assign exhibitors ---------------- */
    spaces.forEach((s, i) => {
      if (i % 3 === 2) return;                    /* leave a third available */
      const [name, status] = EXHIBITORS[ex++ % EXHIBITORS.length];
      s.props.exhibitor = name;
      s.props.status = status;
    });

    /* ---------------- electrical distribution ----------------
       House power lands at the switchgear in the top-left corner, feeds
       four distros at the aisle ends and a fifth between the islands.
       The MDP → D-3 feeder is deliberately undersized so the
       voltage-drop rule has something to find. */
    add('electrical-panel', { x: 22, y: 1.5, w: 5, h: 2.5 }, {
      panelId: 'MDP-1', voltage: '480', phase: '3', mainAmps: 800, clearance: 3,
      label: 'Main distribution', notes: 'House service — tie-in at the switchgear vault.',
    });
    add('disconnect', { x: 29, y: 2.75, r: 1 }, { label: 'Service disconnect', panelId: 'MDP-1' });

    /* temporary power staged at the dock for the outdoor exhibits */
    add('generator', { x: 184, y: 0, w: 16, h: 8 }, {
      panelId: 'GEN-1', voltage: '208', phase: '3', mainAmps: 600,
      label: 'Temp generator', notes: 'Load-in only — removed before doors.',
    });

    const DISTROS = [
      ['D-1', 21, 47], ['D-2', 21, 79],
      ['D-3', 168, 47], ['D-4', 168, 79],
      ['D-5', 95, 90],
    ];
    DISTROS.forEach(([id, x, y]) => {
      add('distro-box', { x, y, w: 2.5, h: 2 }, {
        distroId: id, panelId: 'MDP-1', voltage: '208', phase: '3', mainAmps: 100,
        label: id,
      });
    });

    /* feeders — the gauge on the D-3 run is one size light on purpose */
    const feeder = (circuit, x1, y1, x2, y2, gauge) =>
      add('electrical-run', { x1, y1, x2, y2 }, {
        circuitId: circuit, panelId: 'MDP-1', voltage: '208',
        gauge, amps: 100, method: 'overhead',
      });
    feeder('F-1', 24.5, 4,  22.2, 47, '2');
    feeder('F-2', 22.2, 49, 22.2, 79, '2');
    feeder('F-3', 24.5, 4,  169,  47, '4');   /* ~150 ft on 4 AWG → >3% drop */
    feeder('F-4', 169,  49, 169,  79, '2');
    feeder('F-5', 96.2, 49, 96.2, 90, '2');

    /* one drop per contracted booth, fed from the nearest distro */
    const feedFor = (x, y) => {
      if (y >= 85) return 'D-5';
      const left = x < 95;
      return y < 50 ? (left ? 'D-1' : 'D-3') : (left ? 'D-2' : 'D-4');
    };
    const AMPS = [5, 10, 20, 5, 15, 10, 5, 20, 10, 5];
    const CONN = ['edison', 'l5-20', 'l6-30', 'edison', 'l5-20'];

    spaces.forEach((s, i) => {
      if (!s.props.exhibitor) return;            /* uncontracted booths draw nothing */
      const { x, y } = s.geometry;
      const board = feedFor(x, y);
      add('power-drop', { x: x + 0.8, y: y + 0.8, r: 0.7 }, {
        label: `${s.props.number}-P`,
        amps: AMPS[i % AMPS.length],
        voltage: '120', phase: '1',
        panelId: board,
        circuitId: `${board}-${(i % 12) + 1}`,
        connector: CONN[i % CONN.length],
        hours: i % 7 === 0 ? '24hr' : 'show',
        capacity: 20,
      }, s.id);
    });

    /* ---------------- utilities ---------------- */
    add('water-drop', { x: 174, y: 60, r: 1 }, { label: 'W1' });
    add('network-drop', { x: 101, y: 84, r: 1 }, { label: 'N1' });
    add('rigging-zone', { x: 25, y: 85, w: 150, h: 26 }, { label: 'Rigging permitted' });
    /* Kept off the island centres so a click there grabs the space itself. */
    add('rigging-point', { x: 34, y: 92, r: 1 }, { label: 'R1', loadLbs: 500 });
    add('rigging-point', { x: 114, y: 92, r: 1 }, { label: 'R2', loadLbs: 500 });

    /* ---------------- annotation ---------------- */
    add('text', { x: 100, y: 15 }, { text: 'HALL B', fontSize: 7, color: '#8b96a8' });
    add('text', { x: 84, y: 114 }, { text: 'MAIN ENTRANCE', fontSize: 3.4, color: '#22c55e' });
    add('dimension', { x1: 0, y1: -6, x2: 200, y2: -6 });
    add('dimension', { x1: -6, y1: 0, x2: -6, y2: 120 });

    /* ---------------- one submitted booth interior ---------------- */
    const demo = spaces[0];
    demo.props.exhibitor = 'Northwind Medical';
    demo.props.status = 'submitted';
    const id = demo.id;
    add('display', { x: 25.5, y: 25.4, w: 9, h: 1 }, { label: 'Back wall graphic', height: 8 }, id);
    add('table',   { x: 26,   y: 28,   w: 6, h: 2.5 }, { label: 'Demo table' }, id);
    add('chair',   { x: 27,   y: 31.2, w: 1.6, h: 1.6 }, {}, id);
    add('chair',   { x: 29.5, y: 31.2, w: 1.6, h: 1.6 }, {}, id);
    add('counter', { x: 25.6, y: 33,   w: 4, h: 2 }, { label: 'Reception' }, id);
    add('power-drop', { x: 33.6, y: 33.6, r: 0.8 }, { label: 'Booth power', amps: 15, capacity: 20 }, id);

    FP.plan = prev;
    return plan;
  };
})(window);
