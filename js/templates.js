/* ============================================================
   templates.js — built-in floor plan templates.

   A customer order rarely starts from nothing: it starts from "the
   usual" — booth rows with aisles, a tabletop expo, an island
   showcase. Each template here builds that skeleton into the OPEN
   (empty) plan using the same machinery as hand placement, so every
   booth arrives furnished, numbered, and correctly oriented, and one
   undo removes the whole build.

   The dashboard's New Plan flow passes ?template=<key>; main.js calls
   FP.templates[key].build() once, on a plan with no elements. Saved
   templates (real shows flagged is_template) are copied row-for-row by
   the dashboard instead and never pass through here.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const spec = (kind, geometry, props = {}) => ({ kind, geometry, props });

  /* Perimeter walls, entrances on the south wall, fire exits on the
     other three — the shell every template shares. */
  function shell(W, H) {
    const out = [
      spec('wall', { x1: 0, y1: 0, x2: W, y2: 0, thickness: 0.75 }),
      spec('wall', { x1: W, y1: 0, x2: W, y2: H, thickness: 0.75 }),
      spec('wall', { x1: W, y1: H, x2: 0, y2: H, thickness: 0.75 }),
      spec('wall', { x1: 0, y1: H, x2: 0, y2: 0, thickness: 0.75 }),
      spec('door', { x: W * 0.3 - 4, y: H - 1, w: 8, h: 2 }, { label: 'Main entrance' }),
      spec('door', { x: W * 0.7 - 4, y: H - 1, w: 8, h: 2 }, { label: 'Main entrance' }),
      spec('fire-exit', { x: W / 2 - 4, y: -1, w: 8, h: 2 }),
      spec('fire-exit', { x: -1, y: H / 2 - 4, w: 2, h: 8 }),
      spec('fire-exit', { x: W - 1, y: H / 2 - 4, w: 2, h: 8 }),
      spec('registration', { x: W * 0.3 + 8, y: H - 12, w: 24, h: 8 }, { label: 'Registration' }),
    ];
    return out;
  }

  /* Back-to-back booth pairs with aisles between, a cross aisle down
     the middle, and a named hanging sign over every aisle. */
  function boothRows(W, H, { bw, bd, aisle }) {
    const out = shell(W, H);
    const left = 20, right = W - 20;
    const concourse = 24;                       /* south band for entry */
    const crossHalf = bw;                        /* cross aisle ~2 booths */
    let y = 16, aisleNo = 100;

    while (y + bd * 2 <= H - concourse) {
      for (let x = left; x + bw <= right; x += bw) {
        if (x + bw > W / 2 - crossHalf && x < W / 2 + crossHalf) continue;
        out.push(spec('space', { x, y, w: bw, h: bd }));
        out.push(spec('space', { x, y: y + bd, w: bw, h: bd }));
      }
      const ay = y + bd * 2;
      if (ay + aisle <= H - concourse) {
        out.push(spec('aisle', { x: left, y: ay, w: right - left, h: aisle },
                      { label: `Aisle ${aisleNo}` }));
        for (const fx of [0.25, 0.5, 0.75]) {
          out.push(spec('hanging-sign', { x: left + (right - left) * fx, y: ay + aisle / 2 },
                        { label: `Aisle ${aisleNo}` }));
        }
        aisleNo += 100;
      }
      y += bd * 2 + aisle;
    }
    return out;
  }

  /* Freestanding islands on generous aisles — showcase format. */
  function islands(W, H) {
    const out = shell(W, H);
    const s = 20, gap = 15, concourse = 24;
    for (let y = 16; y + s <= H - concourse; y += s + gap) {
      for (let x = 20; x + s <= W - 20; x += s + gap) {
        out.push(spec('space', { x, y, w: s, h: s }, { spaceType: 'island' }));
      }
    }
    return out;
  }

  /* Build specs into the open plan through the normal placement path —
     numbering, furnishing, orientation all come from addElements. */
  function realise(specs) {
    const els = specs.map((sp) => {
      const el = FP.makeElement(sp.kind, sp.geometry);
      Object.assign(el.props, sp.props);
      return el;
    });
    FP.addElements(els, { select: false });
    return els.length;
  }

  FP.templates = {
    rows: {
      name: 'Classic booth rows',
      description: 'Back-to-back 10×10 rows, named aisles with hanging signs, entrances and registration.',
      build: () => realise(boothRows(FP.plan.width, FP.plan.height, { bw: 10, bd: 10, aisle: 10 })),
    },
    tabletop: {
      name: 'Tabletop expo',
      description: '8×10 tabletop spaces on tighter aisles — the compact association-show format.',
      build: () => realise(boothRows(FP.plan.width, FP.plan.height, { bw: 8, bd: 10, aisle: 8 })),
    },
    islands: {
      name: 'Island showcase',
      description: '20×20 islands on wide aisles — premium exhibitors, sponsor pavilions.',
      build: () => realise(islands(FP.plan.width, FP.plan.height)),
    },
  };
})(window);
