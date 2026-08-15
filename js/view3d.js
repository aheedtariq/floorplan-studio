/* ============================================================
   view3d.js — the walkthrough view.

   Extrudes the live 2D plan into a 3D model the client can orbit:
   drape runs rise to their real heights, booths read as colored
   tiles, rented furniture stands at true size. Nothing here is a
   second source of truth — every frame is derived from the same
   elements the 2D editor edits, so the 3D view is always current.

   Three.js is loaded on first open (dynamic import from CDN), so
   sessions that never touch 3D never pay for it.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  let THREE = null;
  let Orbit = null;

  let overlay = null;      /* DOM shell */
  let renderer, scene, camera, controls, raf = 0;
  let opened = false;

  /* ---------------- real-world heights, in plan units (ft) ----------------
     Anything not listed falls back by shape: rect -> low tile, line -> wall,
     marker -> stub. Heights are what a fitter would build, not guesses. */
  const HEIGHTS = {
    wall: 12, column: 24, stairs: 3, 'loading-dock': 0.4,
    space: 0.06, 'dead-space': 0.06, aisle: 0, zone: 0.03,
    registration: 0.05, stage: 2, food: 0.05, lounge: 0.05,
    restroom: 0.05, storage: 0.05, 'av-booth': 0.05,
    table: 2.5, chair: 1.5, stool: 2.5, display: 8, monitor: 6,
    shelf: 5, counter: 3.5,
    'table-8ft': 2.5, 'table-round-60': 2.5, 'cocktail-table': 3.5,
    'charging-table': 2.5, sofa: 2.4, 'lounge-chair': 2.4, 'cube-seat': 1.5,
    'coffee-table': 1.3, bar: 3.5, 'registration-counter': 3.5, podium: 4,
    'display-case': 3.2, kiosk: 7, tower: 12, 'banner-stand': 8,
    'led-poster': 6.5, 'poster-board': 6, 'grid-wall': 6,
    'entrance-unit': 12, carpet: 0.02, 'custom-room': 8,
    'fire-exit': 0.15, 'first-aid': 0.05, 'fire-lane': 0.02,
    'electrical-panel': 6, 'distro-box': 2.5, generator: 7,
    /* floor markings and annotations are not walls — keep them flat or
       out of the model entirely, or the walkthrough reads as a maze */
    'egress-path': 0, 'electrical-run': 0, arrow: 0, dimension: 0,
    text: 0, 'rigging-zone': 0, 'hanging-sign': 14, 'water-drop': 0,
    'network-drop': 0, 'power-drop': 0, 'rigging-point': 0, disconnect: 0,
  };

  /* Kinds drawn as cylinders — seats and round tables. */
  const ROUND = new Set(['chair', 'stool', 'cocktail-table', 'table-round-60',
                         'cube-seat']);

  /* ============================================================
     Parametric furniture.

     Ready-made 3D kits were considered and rejected: none carry
     trade-show inventory (drape, stage decks, kiosks, banquet
     throws), and a fixed model scaled to an arbitrary footprint
     distorts. Everything here is built from real proportions at
     the element's exact size instead — a 7 ft sofa gets 7 ft of
     sofa, not a stretched prop.

     Every builder returns a Group centred on x/z with y = floor,
     sized from the element's true footprint (w along x, d along z).
     ============================================================ */
  let RBox = null;                     /* RoundedBoxGeometry, loaded with THREE */

  const THROW_COLORS = { black: 0x22242b, blue: 0x1d3f8f, white: 0xf5f5f2,
                         red: 0x9c1f2e, custom: 0x7c5cfc };

  const matCache = new Map();
  function mat(color, { rough = .85, metal = 0, opacity = 1, emissive = 0 } = {}) {
    const key = `${color}|${rough}|${metal}|${opacity}|${emissive}`;
    if (!matCache.has(key)) {
      matCache.set(key, new THREE.MeshStandardMaterial({
        color, roughness: rough, metalness: metal,
        transparent: opacity < 1, opacity,
        emissive, emissiveIntensity: emissive ? 1 : 0,
      }));
    }
    return matCache.get(key);
  }
  const glassMat = () => mat(0xdfe9f2, { rough: .12, metal: 0, opacity: .28 });
  const chromeMat = () => mat(0xb9bfc9, { rough: .3, metal: .9 });

  const box = (w, h, d, m, r = 0) =>
    new THREE.Mesh(r > 0 && RBox ? new RBox(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d), m);
  const cyl = (rTop, rBot, h, m, seg = 24) =>
    new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m);

  /* four legs inside the footprint corners */
  function legs(g, w, d, h, m, r = 0.09) {
    const ix = w / 2 - 0.25, iz = d / 2 - 0.25;
    for (const [x, z] of [[-ix, -iz], [ix, -iz], [-ix, iz], [ix, iz]]) {
      const leg = cyl(r, r, h, m, 10);
      leg.position.set(x, h / 2, z);
      g.add(leg);
    }
  }

  function softSeat(el, g0) {
    /* sofa and lounge chair share anatomy: feet, base, back along the
       long edge, arms, seat cushions. Reads as a sofa at a glance. */
    const w = g0.w, d = g0.h, grp = new THREE.Group();
    const fabric = mat(new THREE.Color(el.props?.color || '#0d9488').getHex(), { rough: .95 });
    const feetH = 0.28;

    const ix = w / 2 - 0.3, iz = d / 2 - 0.3;
    for (const [x, z] of [[-ix, -iz], [ix, -iz], [-ix, iz], [ix, iz]]) {
      const foot = cyl(0.1, 0.08, feetH, mat(0x3d3f45, { rough: .5 }), 10);
      foot.position.set(x, feetH / 2, z);
      grp.add(foot);
    }

    const base = box(w, 0.9, d, fabric, 0.16);
    base.position.y = feetH + 0.45;
    grp.add(base);

    const backT = Math.min(d * 0.28, 0.85);
    const back = box(w, 1.5, backT, fabric, 0.18);
    back.position.set(0, feetH + 0.9 + 0.55, -d / 2 + backT / 2);
    grp.add(back);

    const armW = Math.min(w * 0.14, 0.6);
    for (const s of [-1, 1]) {
      const arm = box(armW, 0.75, d - backT * 0.4, fabric, 0.14);
      arm.position.set(s * (w / 2 - armW / 2), feetH + 0.9 + 0.3, backT * 0.15);
      grp.add(arm);
    }

    /* seat cushions: one per ~2.4 ft of clear width */
    const clearW = w - armW * 2 - 0.1;
    const n = Math.max(1, Math.round(clearW / 2.4));
    const cw = clearW / n - 0.08;
    for (let i = 0; i < n; i++) {
      const c = box(cw, 0.42, d - backT - 0.5, fabric, 0.14);
      c.position.set(-clearW / 2 + (i + 0.5) * (clearW / n), feetH + 0.9 + 0.21, backT * 0.3);
      grp.add(c);
    }
    return grp;
  }

  function tableTop(el, w, d, h, round) {
    /* a table is a top on legs — unless it wears a throw, in which case
       the cloth falls to the floor the way it does on the show floor */
    const grp = new THREE.Group();
    const thr = el.props?.throw;
    if (thr && thr !== 'none' && THROW_COLORS[thr] !== undefined) {
      const cloth = mat(THROW_COLORS[thr], { rough: .92 });
      if (round) {
        const r = Math.min(w, d) / 2;
        const top = cyl(r, r, 0.12, cloth, 36);
        top.position.y = h - 0.06;
        grp.add(top);
        const skirt = cyl(r, r * 1.06, h - 0.1, cloth, 36);
        skirt.position.y = (h - 0.1) / 2;
        grp.add(skirt);
      } else {
        const top = box(w + 0.15, 0.12, d + 0.15, cloth, 0.05);
        top.position.y = h - 0.06;
        grp.add(top);
        const skirt = box(w + 0.05, h - 0.1, d + 0.05, cloth, 0.06);
        skirt.position.y = (h - 0.1) / 2;
        grp.add(skirt);
      }
      return grp;
    }
    const wood = mat(0xcfc4b0, { rough: .6 });
    if (round) {
      const r = Math.min(w, d) / 2;
      const top = cyl(r, r, 0.15, wood, 36);
      top.position.y = h - 0.075;
      grp.add(top);
      const stem = cyl(0.14, 0.14, h - 0.3, chromeMat(), 14);
      stem.position.y = (h - 0.3) / 2 + 0.1;
      grp.add(stem);
      const foot = cyl(r * 0.45, r * 0.5, 0.1, chromeMat(), 24);
      foot.position.y = 0.05;
      grp.add(foot);
    } else {
      const top = box(w, 0.15, d, wood, 0.03);
      top.position.y = h - 0.075;
      grp.add(top);
      legs(grp, w, d, h - 0.15, chromeMat());
    }
    return grp;
  }

  /* Painted floor text for the areas that ARE flat in real life — a
     loading dock or a fire lane is a region, not an object, so it gets
     its name on the slab the way venues stencil them. */
  function floorLabel(text, maxW, maxD) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const x = c.getContext('2d');
    let size = 150;
    x.font = `700 ${size}px Inter, sans-serif`;
    while (size > 40 && x.measureText(text).width > 940) {
      size -= 10;
      x.font = `700 ${size}px Inter, sans-serif`;
    }
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = 'rgba(19,26,38,.72)';
    x.fillText(text, 512, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    const aspect = 4;
    const w = Math.max(Math.min(maxW * 0.92, maxD * 0.92 * aspect), 3);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w / aspect),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    plane.rotation.x = -Math.PI / 2;
    return plane;
  }

  /* Area kinds that stay flat get stencilled names; an element's own
     label always wins over the stock wording. */
  const FLAT_LABELS = {
    registration: 'REGISTRATION', food: 'FOOD & BEVERAGE', lounge: 'LOUNGE',
    restroom: 'RESTROOMS', storage: 'STORAGE', 'av-booth': 'AV / PRODUCTION',
    'fire-lane': 'FIRE LANE · KEEP CLEAR', 'first-aid': 'FIRST AID',
    'dead-space': 'NO BUILD', 'dead-space-poly': 'NO BUILD',
    zone: 'ZONE', carpet: '', 'rigging-zone': 'RIGGING',
  };

  const BUILDERS = {
    stairs(el, g) {
      /* a staircase is steps, not a ramp-shaped box */
      const grp = new THREE.Group();
      const along = g.w >= g.h;
      const n = 6, rise = 3 / n;
      const stepMat = mat(0x9aa2ae, { rough: .8 });
      const runLen = along ? g.w : g.h;
      const depth = runLen / n;
      for (let i = 0; i < n; i++) {
        const s = box(along ? depth : g.w, rise * (i + 1), along ? g.h : depth, stepMat);
        const off = -runLen / 2 + depth * (i + 0.5);
        s.position.set(along ? off : 0, (rise * (i + 1)) / 2, along ? 0 : off);
        grp.add(s);
      }
      return grp;
    },

    'loading-dock'(el, g) {
      const grp = new THREE.Group();
      const plat = box(g.w, 0.45, g.h, mat(0x8f97a3, { rough: .9 }));
      plat.position.y = 0.225;
      grp.add(plat);
      /* rubber dock bumpers along the outer edge */
      const nB = Math.max(2, Math.floor(g.w / 4));
      for (let i = 0; i < nB; i++) {
        const b = box(1, 0.35, 0.35, mat(0x22242b, { rough: .95 }));
        b.position.set(-g.w / 2 + (g.w / nB) * (i + 0.5), 0.28, -g.h / 2 + 0.2);
        grp.add(b);
      }
      const lbl = floorLabel(String(el.props?.label || 'LOADING DOCK').toUpperCase(), g.w, g.h);
      lbl.position.y = 0.48;
      grp.add(lbl);
      return grp;
    },

    'fire-exit'(el, g) {
      const grp = new THREE.Group();
      const along = g.w >= g.h;
      const len = Math.max(g.w, g.h);
      const pad = box(g.w, 0.12, g.h, mat(0xd93a3a, { rough: .8 }));
      pad.position.y = 0.06;
      grp.add(pad);
      const lbl = floorLabel('FIRE EXIT', g.w, g.h);
      lbl.position.y = 0.15;
      if (!along) lbl.rotation.z = Math.PI / 2;
      grp.add(lbl);

      /* the actual door: steel double leaves with push bars, jambs,
         header, and the illuminated EXIT box above */
      const dgrp = new THREE.Group();
      const doorW = Math.min(len * 0.8, 8);
      const steel = mat(0x97a0ab, { rough: .55, metal: .3 });
      for (const s of [-1, 1]) {
        const leaf = box(doorW / 2 - 0.1, 7, 0.22, steel, 0.02);
        leaf.position.set(s * (doorW / 4), 3.5, 0);
        dgrp.add(leaf);
        const bar = box(doorW / 2 - 0.6, 0.16, 0.12,
          mat(0xd0d4da, { rough: .3, metal: .8 }));
        bar.position.set(s * (doorW / 4), 3.1, 0.2);
        dgrp.add(bar);
      }
      for (const s of [-1, 1]) {
        const jamb = box(0.3, 7.5, 0.4, mat(0x50565f, { rough: .6 }));
        jamb.position.set(s * (doorW / 2 + 0.15), 3.75, 0);
        dgrp.add(jamb);
      }
      const header = box(doorW + 0.9, 0.5, 0.4, mat(0x50565f, { rough: .6 }));
      header.position.y = 7.5;
      dgrp.add(header);
      const sign = box(Math.min(doorW * 0.5, 3), 0.8, 0.3,
        mat(0x0e5c2f, { emissive: 0x16a34a, rough: .4 }));
      sign.position.y = 8.3;
      dgrp.add(sign);
      if (!along) dgrp.rotation.y = Math.PI / 2;
      grp.add(dgrp);
      return grp;
    },

    door(el, g) {
      /* an entrance is glass double doors in a chrome frame */
      const grp = new THREE.Group();
      const along = g.w >= g.h;
      const len = Math.max(g.w, g.h);
      const dgrp = new THREE.Group();
      const doorW = Math.min(len * 0.92, 14);
      const nLeaves = Math.max(2, Math.round(doorW / 3.2));
      const lw = doorW / nLeaves;
      for (let i = 0; i < nLeaves; i++) {
        const cxOff = -doorW / 2 + lw * (i + 0.5);
        const glass = box(lw - 0.14, 7, 0.14, glassMat());
        glass.position.set(cxOff, 3.5, 0);
        dgrp.add(glass);
        const stile = box(0.12, 7, 0.2, chromeMat());
        stile.position.set(cxOff - lw / 2 + 0.07, 3.5, 0);
        dgrp.add(stile);
        const rail = box(lw - 0.2, 0.14, 0.18, chromeMat());
        rail.position.set(cxOff, 3.2, 0.1);
        dgrp.add(rail);
      }
      const endStile = box(0.12, 7, 0.2, chromeMat());
      endStile.position.set(doorW / 2 - 0.07, 3.5, 0);
      dgrp.add(endStile);
      const header = box(doorW + 0.6, 0.55, 0.4,
        mat(new THREE.Color(el.props?.color || '#16a34a').getHex(), { rough: .55 }));
      header.position.y = 7.55;
      dgrp.add(header);
      if (!along) dgrp.rotation.y = Math.PI / 2;
      grp.add(dgrp);

      const name = String(el.props?.label || '').trim();
      if (name) {
        const lbl = floorLabel(name.toUpperCase(), Math.max(g.w, 10), Math.max(g.h, 4));
        lbl.position.y = 0.1;
        if (!along) lbl.rotation.z = Math.PI / 2;
        grp.add(lbl);
      }
      return grp;
    },
    sofa: (el, g) => softSeat(el, g),
    'lounge-chair': (el, g) => softSeat(el, g),

    'cube-seat': (el, g) => {
      const grp = new THREE.Group();
      const s = Math.min(g.w, g.h);
      const c = box(s, s, s, mat(new THREE.Color(el.props?.color || '#0d9488').getHex(),
                                 { rough: .9 }), s * 0.12);
      c.position.y = s / 2;
      grp.add(c);
      return grp;
    },

    chair(el, g) {
      const grp = new THREE.Group();
      const w = Math.min(g.w, 1.7), d = Math.min(g.h, 1.7);
      legs(grp, w * 0.9, d * 0.9, 1.45, chromeMat(), 0.05);
      const seat = box(w * 0.92, 0.14, d * 0.92, mat(0x3c4654, { rough: .8 }), 0.05);
      seat.position.y = 1.5;
      grp.add(seat);
      const back = box(w * 0.88, 1.15, 0.12, mat(0x3c4654, { rough: .8 }), 0.04);
      back.position.set(0, 2.25, -d / 2 + 0.1);
      grp.add(back);
      return grp;
    },

    stool(el, g) {
      const grp = new THREE.Group();
      const r = Math.min(g.w, g.h) / 2;
      const seat = cyl(r * 0.8, r * 0.8, 0.18, mat(0x2e3540, { rough: .75 }), 22);
      seat.position.y = 2.4;
      grp.add(seat);
      const stem = cyl(0.08, 0.08, 2.2, chromeMat(), 10);
      stem.position.y = 1.2;
      grp.add(stem);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.55, 0.035, 8, 24), chromeMat());
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.85;
      grp.add(ring);
      const foot = cyl(r * 0.7, r * 0.75, 0.08, chromeMat(), 24);
      foot.position.y = 0.04;
      grp.add(foot);
      return grp;
    },

    table:            (el, g) => tableTop(el, g.w, g.h, 2.5, Math.abs(g.w - g.h) < Math.min(g.w, g.h) * 0.35),
    'table-8ft':      (el, g) => tableTop(el, g.w, g.h, 2.5, false),
    'coffee-table':   (el, g) => tableTop(el, g.w, g.h, 1.35, false),
    'table-round-60': (el, g) => tableTop(el, g.w, g.h, 2.5, true),
    'cocktail-table': (el, g) => tableTop(el, g.w, g.h, 3.5, true),

    'charging-table'(el, g) {
      const grp = tableTop(el, g.w, g.h, 2.5, false);
      const strip = box(Math.min(g.w * 0.5, 2.5), 0.18, 0.5, mat(0x22242b, { rough: .4 }), 0.04);
      strip.position.y = 2.6;
      grp.add(strip);
      const bolt = box(0.3, 0.02, 0.3, mat(0xfacc15, { rough: .4, emissive: 0x8a6d00 }));
      bolt.position.y = 2.7;
      grp.add(bolt);
      return grp;
    },

    bar:                    (el, g) => BUILDERS._counter(el, g, 0x5b3fd0, 3.6),
    'registration-counter': (el, g) => BUILDERS._counter(el, g, 0x0891b2, 3.4),
    counter:                (el, g) => BUILDERS._counter(el, g, 0x8a8377, 3.4),

    _counter(el, g, faceColor, h) {
      const grp = new THREE.Group();
      const w = g.w, d = g.h;
      const body = box(w, h - 0.15, d * 0.86, mat(0xe9e6e0, { rough: .7 }), 0.05);
      body.position.set(0, (h - 0.15) / 2 + 0.05, d * 0.05);
      grp.add(body);
      /* customer-facing graphic panel */
      const face = box(w * 0.96, h - 0.6, 0.1, mat(faceColor, { rough: .55 }), 0.03);
      face.position.set(0, (h - 0.6) / 2 + 0.15, -d / 2 + 0.1);
      grp.add(face);
      const top = box(w + 0.25, 0.15, d, mat(0x2e3540, { rough: .35 }), 0.04);
      top.position.y = h - 0.075;
      grp.add(top);
      return grp;
    },

    podium(el, g) {
      const grp = new THREE.Group();
      const w = g.w, d = g.h;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.3, 3.6, 4, 1),
                                  mat(0x6d655a, { rough: .6 }));
      body.rotation.y = Math.PI / 4;
      body.position.y = 1.8;
      body.scale.z = d / w;
      grp.add(body);
      const top = box(w, 0.12, d, mat(0x2e3540, { rough: .4 }), 0.03);
      top.position.y = 3.7;
      top.rotation.x = -0.16;
      grp.add(top);
      return grp;
    },

    'display-case'(el, g) {
      const grp = new THREE.Group();
      const w = g.w, d = g.h;
      const cab = box(w, 1.1, d, mat(0xf0efec, { rough: .6 }), 0.04);
      cab.position.y = 0.55;
      grp.add(cab);
      const glass = box(w - 0.1, 2, d - 0.1, glassMat());
      glass.position.y = 1.1 + 1;
      grp.add(glass);
      const lid = box(w, 0.08, d, chromeMat());
      lid.position.y = 3.15;
      grp.add(lid);
      return grp;
    },

    kiosk(el, g) {
      const grp = new THREE.Group();
      const w = g.w, d = g.h;
      const h = Number(el.props?.height) || 7;
      const base = box(w * 0.7, 1.4, d * 0.8, mat(0x2e3540, { rough: .5 }), 0.05);
      base.position.y = 0.7;
      grp.add(base);
      const stem = box(w * 0.25, h - 3.4, 0.35, mat(0x2e3540, { rough: .5 }), 0.04);
      stem.position.y = 1.4 + (h - 3.4) / 2;
      grp.add(stem);
      const screen = box(w, 2, 0.22, mat(0x101418, { rough: .3 }), 0.03);
      screen.position.y = h - 1;
      grp.add(screen);
      const glow = box(w * 0.9, 1.75, 0.03, mat(0x1a2436, { emissive: 0x3556c8, rough: .2 }));
      glow.position.set(0, h - 1, 0.13);
      grp.add(glow);
      return grp;
    },

    monitor(el, g) {
      const grp = new THREE.Group();
      const w = Math.max(g.w, g.h), hgt = Number(el.props?.height) || 6;
      const foot = box(w * 0.5, 0.1, 0.9, mat(0x22242b, { rough: .5 }), 0.02);
      foot.position.y = 0.05;
      grp.add(foot);
      const stem = box(0.18, hgt - 1.6, 0.18, mat(0x22242b, { rough: .5 }));
      stem.position.y = (hgt - 1.6) / 2 + 0.1;
      grp.add(stem);
      const screen = box(w, w * 0.56, 0.15, mat(0x101418, { rough: .3 }), 0.02);
      screen.position.y = hgt - (w * 0.56) / 2;
      grp.add(screen);
      const glow = box(w * 0.94, w * 0.5, 0.03, mat(0x1a2436, { emissive: 0x33549e, rough: .2 }));
      glow.position.set(0, hgt - (w * 0.56) / 2, 0.08);
      grp.add(glow);
      return grp;
    },

    'led-poster'(el, g) {
      const grp = new THREE.Group();
      const w = Math.max(g.w, g.h), h = 6.5;
      const frame = box(w, h, 0.3, mat(0x191c22, { rough: .4 }), 0.03);
      frame.position.y = h / 2;
      grp.add(frame);
      const face = box(w * 0.92, h * 0.94, 0.04, mat(0x25315a, { emissive: 0x4a68d8, rough: .15 }));
      face.position.set(0, h / 2, 0.16);
      grp.add(face);
      return grp;
    },

    'banner-stand'(el, g) {
      const grp = new THREE.Group();
      const w = Math.max(g.w, g.h), h = Number(el.props?.height) || 8;
      const base = box(w, 0.12, 1, mat(0x9aa0aa, { rough: .4, metal: .6 }), 0.03);
      base.position.y = 0.06;
      grp.add(base);
      const graphic = box(w * 0.96, h - 0.4, 0.08,
        mat(new THREE.Color(el.props?.color || '#6366f1').getHex(), { rough: .6 }), 0.02);
      graphic.position.y = (h - 0.4) / 2 + 0.2;
      grp.add(graphic);
      return grp;
    },

    'stage-deck'(el, g) {
      const grp = new THREE.Group();
      const h = (Number(el.props?.deckHeight) || 24) / 12;
      const skirt = box(g.w - 0.15, h - 0.15, g.h - 0.15, mat(0x22242b, { rough: .95 }));
      skirt.position.y = (h - 0.15) / 2;
      grp.add(skirt);
      const top = box(g.w, 0.15, g.h, mat(0x4a4038, { rough: .7 }), 0.02);
      top.position.y = h - 0.075;
      grp.add(top);
      return grp;
    },

    tower(el, g) {
      const grp = new THREE.Group();
      const h = Number(el.props?.height) || 12;
      const body = box(g.w, h, g.h, mat(0xf0efec, { rough: .7 }), 0.06);
      body.position.y = h / 2;
      grp.add(body);
      const band = box(g.w + 0.06, h * 0.22, g.h + 0.06,
        mat(new THREE.Color(el.props?.color || '#8b5cf6').getHex(), { rough: .5 }), 0.04);
      band.position.y = h * 0.82;
      grp.add(band);
      return grp;
    },

    'custom-room'(el, g) {
      /* a room is walls, not a solid block */
      const grp = new THREE.Group();
      const h = Number(el.props?.height) || 8, t = 0.3;
      const wallM = mat(0xf2f1ee, { rough: .8 });
      for (const [w2, d2, x, z] of [
        [g.w, t, 0, -g.h / 2 + t / 2], [g.w, t, 0, g.h / 2 - t / 2],
        [t, g.h - t * 2, -g.w / 2 + t / 2, 0]]) {
        const wall = box(w2, h, d2, wallM);
        wall.position.set(x, h / 2, z);
        grp.add(wall);
      }
      /* front wall with a door gap */
      const doorW = Math.min(3.5, g.w * 0.4);
      const seg = (g.w - doorW) / 2;
      for (const s of [-1, 1]) {
        const wall = box(seg, h, t, wallM);
        wall.position.set(s * (doorW / 2 + seg / 2), h / 2, g.h / 2 - t / 2);
        grp.add(wall);
      }
      const header = box(doorW, h - 6.7, t, wallM);
      header.position.set(0, 6.7 + (h - 6.7) / 2, g.h / 2 - t / 2);
      if (h > 6.8) grp.add(header);
      return grp;
    },

    display(el, g) {
      /* a booth graphic is a printed panel on feet, not a slab */
      const grp = new THREE.Group();
      const w = Math.max(g.w, g.h), h = Number(el.props?.height) || 8;
      const p = box(w, h - 0.2, 0.25,
        mat(new THREE.Color(el.props?.color || '#6366f1').getHex(), { rough: .6 }), 0.02);
      p.position.y = (h - 0.2) / 2 + 0.2;
      grp.add(p);
      for (const s of [-1, 1]) {
        const foot = box(0.8, 0.08, 1.4, chromeMat());
        foot.position.set(s * (w / 2 - 0.5), 0.04, 0);
        grp.add(foot);
      }
      return grp;
    },

    'poster-board'(el, g) {
      const grp = new THREE.Group();
      const w = Math.max(g.w, g.h), h = 6;
      const frame = box(w, h * 0.62, 0.2, mat(0x9aa0aa, { rough: .5, metal: .4 }), 0.02);
      frame.position.y = h - (h * 0.62) / 2;
      grp.add(frame);
      const face = box(w - 0.25, h * 0.62 - 0.25, 0.06, mat(0xf7f6f2, { rough: .8 }));
      face.position.set(0, h - (h * 0.62) / 2, 0.1);
      grp.add(face);
      for (const s of [-1, 1]) {
        const leg = box(0.15, h - h * 0.62, 0.15, mat(0x9aa0aa, { rough: .5, metal: .4 }));
        leg.position.set(s * (w / 2 - 0.3), (h - h * 0.62) / 2, 0);
        grp.add(leg);
      }
      return grp;
    },

    'grid-wall'(el, g) {
      const grp = new THREE.Group();
      const w = Math.max(g.w, g.h), h = 6;
      const m = chromeMat();
      for (const [bw, bh, x, y] of [
        [w, 0.1, 0, h - 0.05], [w, 0.1, 0, 0.6],
        [0.1, h - 0.55, -w / 2 + 0.05, (h + 0.55) / 2 - 0.28],
        [0.1, h - 0.55, w / 2 - 0.05, (h + 0.55) / 2 - 0.28]]) {
        const bar = box(bw, bh, 0.1, m);
        bar.position.set(x, y, 0);
        grp.add(bar);
      }
      const n = Math.max(2, Math.floor(w / 0.6));
      for (let i = 1; i < n; i++) {
        const bar = box(0.04, h - 0.7, 0.04, m);
        bar.position.set(-w / 2 + (w / n) * i, (h + 0.6) / 2 - 0.3, 0);
        grp.add(bar);
      }
      for (const s of [-1, 1]) {
        const foot = box(0.7, 0.08, 1.6, m);
        foot.position.set(s * (w / 2 - 0.4), 0.04, 0);
        grp.add(foot);
      }
      return grp;
    },

    shelf(el, g) {
      const grp = new THREE.Group();
      const w = Math.max(g.w, g.h), d = Math.max(Math.min(g.w, g.h), 0.8);
      const wood = mat(0xd9d2c4, { rough: .65 });
      for (const s of [-1, 1]) {
        const side = box(0.12, 5, d, mat(0x8d8579, { rough: .6 }));
        side.position.set(s * (w / 2 - 0.06), 2.5, 0);
        grp.add(side);
      }
      for (const y of [1.6, 3.1, 4.6]) {
        const board = box(w - 0.2, 0.12, d, wood);
        board.position.y = y;
        grp.add(board);
      }
      return grp;
    },

    stage: (el, g) => BUILDERS['stage-deck'](el, g),

    'entrance-unit'(el, g) {
      const grp = new THREE.Group();
      const h = Number(el.props?.height) || 12;
      const colM = mat(0xf0efec, { rough: .65 });
      for (const s of [-1, 1]) {
        const col = box(1.4, h - 2.5, Math.min(g.h, 2.5), colM, 0.08);
        col.position.set(s * (g.w / 2 - 0.7), (h - 2.5) / 2, 0);
        grp.add(col);
      }
      const header = box(g.w, 2.5, Math.min(g.h, 2.5),
        mat(new THREE.Color(el.props?.color || '#15803d').getHex(), { rough: .55 }), 0.08);
      header.position.y = h - 1.25;
      grp.add(header);
      return grp;
    },
  };

  const heightFor = (el, k) => {
    if (el.props?.deckHeight) return Number(el.props.deckHeight) / 12;
    if (el.kind === 'drape') return Number(el.props?.drapeHeight || 8);
    if (el.props?.height && HEIGHTS[el.kind] === undefined) return Number(el.props.height);
    if (HEIGHTS[el.kind] !== undefined) {
      /* explicit height prop wins for height-regulated kinds */
      if (el.props?.height && ['kiosk', 'tower', 'banner-stand', 'monitor',
                               'display', 'wall', 'entrance-unit', 'custom-room']
          .includes(el.kind)) return Number(el.props.height);
      return HEIGHTS[el.kind];
    }
    if (el.kind === 'stage-deck') return 2;
    if (el.shape === 'line') return 8;
    return 0.06;
  };

  const DRAPE_COLORS = { black: 0x24272e, blue: 0x27418f, white: 0xf2f2ef,
                         grey: 0x9aa0aa, red: 0x8f2733 };

  function colorFor(el, k) {
    if (el.kind === 'drape') return DRAPE_COLORS[el.props?.drapeColor] ?? 0x24272e;
    if (el.kind === 'space') {
      const st = FP.config.status(el.props?.status);
      return new THREE.Color(st?.color || k.fill || '#94a3b8').getHex();
    }
    return new THREE.Color(el.props?.color || k.fill || '#94a3b8').getHex();
  }

  /* ---------------- shell ---------------- */
  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'v3d';
    overlay.innerHTML = `
      <div class="v3d-top">
        <b>3D preview</b>
        <span class="v3d-hint">Scroll zooms to your cursor · double-click flies there ·
          click selects · drag an object moves it · R rotates · drag floor to orbit</span>
        <button class="btn ghost" id="v3dFit">Fit floor</button>
        <button class="btn ghost" id="v3dClose">Back to plan</button>
      </div>`;
    const stage = document.getElementById('stage')
               || document.getElementById('vStage') || document.body;
    stage.appendChild(overlay);
    overlay.querySelector('#v3dClose').onclick = close;
    overlay.querySelector('#v3dFit').onclick = () => flyFit();
  }

  /* Which edge is a booth's back? Booths stand back-to-back, so the
     edge that ABUTS another booth is the back — that's where the shared
     drape line runs, and the opposite side opens onto the aisle. Only
     when a booth touches nothing (a lone perimeter row) do we fall back
     to "back faces away from the hall centre". */
  function boothBack(g, spaceGeos, W, H) {
    const eps = 0.8;
    const abut = { n: false, s: false, e: false, w: false };
    for (const o of spaceGeos) {
      if (o === g) continue;
      const xOv = Math.min(g.x + g.w, o.x + o.w) - Math.max(g.x, o.x);
      const zOv = Math.min(g.y + g.h, o.y + o.h) - Math.max(g.y, o.y);
      if (xOv > Math.min(g.w, o.w) * 0.5) {
        if (Math.abs(o.y + o.h - g.y) < eps) abut.n = true;
        if (Math.abs(g.y + g.h - o.y) < eps) abut.s = true;
      }
      if (zOv > Math.min(g.h, o.h) * 0.5) {
        if (Math.abs(o.x + o.w - g.x) < eps) abut.w = true;
        if (Math.abs(g.x + g.w - o.x) < eps) abut.e = true;
      }
    }
    const cx = g.x + g.w / 2, cz = g.y + g.h / 2;
    const awayNS = cz - H / 2 >= 0 ? 's' : 'n';
    const awayEW = cx - W / 2 >= 0 ? 'e' : 'w';
    /* in an east-west row with a booth touching exactly one long edge,
       that touching edge is the back; same logic rotated for n-s rows */
    if ((abut.e || abut.w) && abut.n !== abut.s) return abut.n ? 'n' : 's';
    if ((abut.n || abut.s) && abut.e !== abut.w) return abut.e ? 'e' : 'w';
    const touching = ['n', 's', 'e', 'w'].filter((d) => abut[d]);
    if (touching.length === 1) return touching[0];
    return Math.abs(cz - H / 2) >= Math.abs(cx - W / 2) ? awayNS : awayEW;
  }
  FP._boothBack = boothBack;   /* shared with layout tooling */

  /* A run of pipe & drape: uprights every ~10 ft, chrome crossbar,
     cloth hanging shy of the floor. Centred on x, running along x. */
  function drapeRun(len, h, colorHex) {
    const grp = new THREE.Group();
    const n = Math.max(2, Math.round(len / 10) + 1);
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + (len / (n - 1)) * i;
      const post = cyl(0.06, 0.06, h, chromeMat(), 8);
      post.position.set(x, h / 2, 0);
      grp.add(post);
    }
    const bar = cyl(0.05, 0.05, len, chromeMat(), 8);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = h - 0.05;
    grp.add(bar);
    const cloth = box(len - 0.08, h - 0.3, 0.18, mat(colorHex, { rough: .96 }));
    cloth.position.y = (h - 0.3) / 2 + 0.22;
    grp.add(cloth);
    return grp;
  }

  /* ---------------- scene build ---------------- */
  function rebuild() {
    /* wipe previous model */
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const c = scene.children[i];
      if (c.userData.model) {
        scene.remove(c);
        c.traverse?.((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      }
    }

    const model = new THREE.Group();
    model.userData.model = true;

    const W = FP.plan.width, H = FP.plan.height;

    /* floor: paper-white slab with a soft grid, sitting on a larger
       ground so the hall reads as a building in a space, not a raft */
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 4, H * 4),
      new THREE.MeshStandardMaterial({ color: 0xe2e6ee, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, -0.06, H / 2);
    ground.receiveShadow = true;
    model.add(ground);

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(W, 0.1, H),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95 }));
    floor.position.set(W / 2, -0.05, H / 2);
    floor.receiveShadow = true;
    model.add(floor);

    const grid = new THREE.GridHelper(Math.max(W, H), Math.max(W, H) / (FP.plan.grid || 5),
                                      0xd5dae4, 0xe8ebf2);
    grid.position.set(W / 2, 0.012, H / 2);
    grid.scale.set(W / Math.max(W, H), 1, H / Math.max(W, H));
    model.add(grid);

    /* hall perimeter: a low curb so the boundary reads without caging
       the camera */
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x131a26, roughness: .6 });
    [[W / 2, -0.4, W, 0.8], [W / 2, H + 0.4, W, 0.8],
     [-0.4, H / 2, 0.8, H + 1.6], [W + 0.4, H / 2, 0.8, H + 1.6]].forEach(([cx, cz, sx, sz]) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(sx, 1.2, sz), curbMat);
      curb.position.set(cx, 0.6, cz);
      curb.castShadow = true;
      model.add(curb);
    });

    /* footage marks along every edge — a printed ruler (ticks every
       5 ft, numbers every 10) so an exhibitor can read exactly where
       their footprint starts against the wall */
    function rulerTexture(lenFt) {
      const px = Math.min(8192, Math.max(2048, Math.round(lenFt * 16)));
      const c = document.createElement('canvas');
      c.width = px; c.height = 96;
      const x = c.getContext('2d');
      const ppf = px / lenFt;
      x.strokeStyle = 'rgba(19,26,38,.5)';
      x.fillStyle = 'rgba(19,26,38,.62)';
      x.lineWidth = 2;
      x.font = '600 42px Inter, sans-serif';
      x.textAlign = 'center';
      for (let f = 0; f <= lenFt; f += 5) {
        const major = f % 10 === 0;
        x.beginPath();
        x.moveTo(f * ppf, 96);
        x.lineTo(f * ppf, 96 - (major ? 38 : 20));
        x.stroke();
        if (major && f > 0 && f < lenFt) x.fillText(String(f), f * ppf, 42);
      }
      const t = new THREE.CanvasTexture(c);
      t.anisotropy = 8;
      return t;
    }
    const rulerStrip = (lenFt) => new THREE.Mesh(
      new THREE.PlaneGeometry(lenFt, 2),
      new THREE.MeshBasicMaterial({ map: rulerTexture(lenFt), transparent: true, depthWrite: false }));
    /* the ruler lives OUTSIDE the wall line, like a site survey strip —
       the show floor itself stays clean. Every side is oriented so the
       numbers read upright from INSIDE the hall. */
    [[W, W / 2, -2.1, 0], [W, W / 2, H + 2.1, 0],
     [H, -2.1, H / 2, Math.PI / 2], [H, W + 2.1, H / 2, -Math.PI / 2]]
      .forEach(([len, px2, pz, rz]) => {
        const strip = rulerStrip(len);
        strip.rotation.set(-Math.PI / 2, 0, 0);
        strip.rotation.z = rz;
        strip.position.set(px2, 0.045, pz);
        model.add(strip);
      });

    /* Booth framing is inferred only when the plan carries no real
       drape elements — explicit drape (a traced plan like Schaumburg)
       always wins over the standard-build guess. */
    const hasRealDrape = (FP.plan.elements || []).some((e) => e.kind === 'drape');
    const spaceGeos = (FP.plan.elements || [])
      .filter((e) => e.kind === 'space' && e.shape === 'rect' && e.geometry?.w !== undefined)
      .map((e) => e.geometry);

    /* elements — children carry absolute coordinates, so one flat pass */
    for (const el of FP.plan.elements || []) {
      const k = FP.config.kind(el.kind);
      const h = heightFor(el, k);
      if (h <= 0) continue;

      if (el.shape === 'line') {
        const g = el.geometry;
        if (g?.x1 === undefined) continue;
        const dx = g.x2 - g.x1, dy = g.y2 - g.y1;
        const len = Math.hypot(dx, dy);
        if (len < 0.1) continue;

        if (el.kind === 'drape') {
          /* drape is hardware + cloth, not a slab: uprights with base
             plates every section, a chrome crossbar, and a hanging
             panel that stops shy of the floor like real drape does */
          const grp = new THREE.Group();
          const section = Math.max(Number(el.props?.sectionWidth) || 10, 3);
          const nPosts = Math.max(2, Math.round(len / section) + 1);
          for (let i = 0; i < nPosts; i++) {
            const x = -len / 2 + (len / (nPosts - 1)) * i;
            const post = cyl(0.07, 0.07, h, chromeMat(), 8);
            post.position.set(x, h / 2, 0);
            grp.add(post);
            const plate = box(1.2, 0.06, 1.2, mat(0x6e747e, { rough: .4, metal: .7 }));
            plate.position.set(x, 0.03, 0);
            grp.add(plate);
          }
          const bar = cyl(0.06, 0.06, len, chromeMat(), 8);
          bar.rotation.z = Math.PI / 2;
          bar.position.y = h - 0.06;
          grp.add(bar);
          const cloth = box(len - 0.1, h - 0.35, 0.22,
            mat(DRAPE_COLORS[el.props?.drapeColor] ?? 0x24272e, { rough: .96 }));
          cloth.position.y = (h - 0.35) / 2 + 0.25;
          grp.add(cloth);
          grp.position.set((g.x1 + g.x2) / 2, 0, (g.y1 + g.y2) / 2);
          grp.rotation.y = -Math.atan2(dy, dx);
          grp.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
          grp.userData.elId = el.id;
          model.add(grp);
          continue;
        }

        const t = Math.max(g.thickness || 0.5, 0.2);
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(len, h, t),
          el.kind === 'wall' ? mat(0xf2f1ee, { rough: .85 })
                             : new THREE.MeshStandardMaterial({ color: colorFor(el, k), roughness: .8 }));
        mesh.position.set((g.x1 + g.x2) / 2, h / 2, (g.y1 + g.y2) / 2);
        mesh.rotation.y = -Math.atan2(dy, dx);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.elId = el.id;
        model.add(mesh);
        continue;
      }

      if (el.shape === 'marker') {
        const g = el.geometry;

        if (el.kind === 'hanging-sign') {
          const grp = new THREE.Group();
          const label = String(el.props?.label || '').trim();

          if (label) {
            /* a NAMED hanging sign is an aisle sign: a rectangular
               panel with the name on both faces, hung on two cables */
            const c = document.createElement('canvas');
            c.width = 512; c.height = 160;
            const x = c.getContext('2d');
            x.fillStyle = '#131a26';
            x.fillRect(0, 0, 512, 160);
            let size = 86;
            x.font = `700 ${size}px Inter, sans-serif`;
            while (size > 30 && x.measureText(label.toUpperCase()).width > 460) {
              size -= 6;
              x.font = `700 ${size}px Inter, sans-serif`;
            }
            x.fillStyle = '#fff';
            x.textAlign = 'center';
            x.textBaseline = 'middle';
            x.fillText(label.toUpperCase(), 256, 82);
            const tex = new THREE.CanvasTexture(c);
            tex.anisotropy = 8;
            const w = 7, hh = w * 160 / 512;
            const face = new THREE.MeshBasicMaterial({ map: tex });
            const side = mat(0x131a26, { rough: .6 });
            const panel = new THREE.Mesh(new THREE.BoxGeometry(w, hh, 0.25),
              [side, side, side, side, face, face]);
            panel.position.y = h;
            grp.add(panel);
            for (const s of [-1, 1]) {
              const drop = 24 - h - hh / 2;
              const cable = cyl(0.02, 0.02, drop, mat(0x3a3d44, { rough: .5 }), 6);
              cable.position.set(s * (w / 2 - 0.6), h + hh / 2 + drop / 2, 0);
              grp.add(cable);
            }
          } else {
            /* unnamed: the SOE circle sign — ring at rigging height */
            const r = Math.max(g.r || 2, 1.5);
            const ring = new THREE.Mesh(
              new THREE.TorusGeometry(r, r * 0.22, 12, 40),
              mat(new THREE.Color(el.props?.color || '#ec4899').getHex(), { rough: .55 }));
            ring.rotation.x = Math.PI / 2;
            ring.position.y = h;
            grp.add(ring);
            for (const a of [0.5, 2.6, 4.7]) {
              const cable = cyl(0.025, 0.025, 24 - h, mat(0x3a3d44, { rough: .5 }), 6);
              cable.position.set(Math.cos(a) * r * 0.75, h + (24 - h) / 2, Math.sin(a) * r * 0.75);
              grp.add(cable);
            }
          }

          grp.position.set(g.x, 0, g.y);
          if (g.rot) grp.rotation.y = -(g.rot * Math.PI) / 180;
          grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
          grp.userData.elId = el.id;
          model.add(grp);
          continue;
        }

        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 0.5, 1.2, 16),
          new THREE.MeshStandardMaterial({ color: colorFor(el, k), roughness: .7 }));
        mesh.position.set(g.x, 0.6, g.y);
        mesh.castShadow = true;
        mesh.userData.elId = el.id;
        model.add(mesh);
        continue;
      }

      if (el.shape !== 'rect') continue;         /* poly zones: skip in v1 */
      const g = el.geometry;
      if (!g || g.w === undefined) continue;

      /* A booth is a built thing, not a coloured tile: status-coloured
         carpet plus the standard pipe-and-drape build — 8 ft back wall,
         3 ft side rails — with the back facing away from the hall
         centre, the way inline rows actually stand. Islands stay open. */
      if (el.kind === 'space') {
        const grp = new THREE.Group();
        const st = FP.config.status(el.props?.status);
        const col = new THREE.Color(st?.color || '#94a3b8').getHex();
        const tile = box(g.w, 0.07, g.h, mat(col, { rough: .92 }));
        tile.position.y = 0.045;
        grp.add(tile);

        if (!hasRealDrape && el.props?.spaceType !== 'island') {
          const drapeCol = 0x24272e, backH = 8, sideH = 3;
          const back = boothBack(g, spaceGeos, W, H);

          /* [len, height, offsetX, offsetZ, rotDeg] per run */
          const runs = {
            n: [[g.w, backH, 0, -g.h / 2, 0],
                [g.h, sideH, -g.w / 2, 0, 90], [g.h, sideH, g.w / 2, 0, 90]],
            s: [[g.w, backH, 0, g.h / 2, 0],
                [g.h, sideH, -g.w / 2, 0, 90], [g.h, sideH, g.w / 2, 0, 90]],
            w: [[g.h, backH, -g.w / 2, 0, 90],
                [g.w, sideH, 0, -g.h / 2, 0], [g.w, sideH, 0, g.h / 2, 0]],
            e: [[g.h, backH, g.w / 2, 0, 90],
                [g.w, sideH, 0, -g.h / 2, 0], [g.w, sideH, 0, g.h / 2, 0]],
          }[back];
          for (const [len, hh, ox, oz, deg] of runs) {
            const run = drapeRun(len, hh, drapeCol);
            run.position.set(ox, 0, oz);
            run.rotation.y = (deg * Math.PI) / 180;
            grp.add(run);
          }
        }

        grp.position.set(g.x + g.w / 2, 0, g.y + g.h / 2);
        if (g.rot) grp.rotation.y = -(g.rot * Math.PI) / 180;
        grp.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
        grp.userData.elId = el.id;
        model.add(grp);

        if (el.props?.number) {
          const spr = numberSprite(String(el.props.number));
          if (spr) {
            spr.position.set(g.x + g.w / 2, 9.2, g.y + g.h / 2);
            model.add(spr);
          }
        }
        continue;
      }

      /* built kinds get real furniture; everything else keeps the tile */
      const build = BUILDERS[el.kind];
      if (build && el.kind[0] !== '_') {
        const grp = build(el, g, k, h);
        grp.position.set(g.x + g.w / 2, 0, g.y + g.h / 2);
        if (g.rot) grp.rotation.y = -(g.rot * Math.PI) / 180;
        grp.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
        grp.userData.elId = el.id;
        model.add(grp);
        continue;
      }

      const flat = h <= 0.1;
      const col = colorFor(el, k);
      const tileMat = new THREE.MeshStandardMaterial({
        color: col, roughness: .85,
        transparent: flat, opacity: flat ? .55 : 1,
      });

      let mesh;
      if (ROUND.has(el.kind)) {
        const r = Math.min(g.w, g.h) / 2;
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, h, 28), tileMat);
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(g.w, h, g.h), tileMat);
      }
      mesh.position.set(g.x + g.w / 2, flat ? h / 2 + 0.011 : h / 2, g.y + g.h / 2);
      if (g.rot) mesh.rotation.y = -(g.rot * Math.PI) / 180;
      if (!flat) mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.elId = el.id;
      model.add(mesh);

      /* areas that stay flat carry their name on the slab */
      if (el.kind in FLAT_LABELS) {
        const text = String(el.props?.label || FLAT_LABELS[el.kind] || '')
          .trim().toUpperCase();
        if (text && Math.min(g.w, g.h) >= 3.5) {
          const vertical = g.h > g.w * 1.3;
          const lbl = floorLabel(text, vertical ? g.h : g.w, vertical ? g.w : g.h);
          if (vertical) lbl.rotation.z = Math.PI / 2;
          lbl.position.set(g.x + g.w / 2, h + 0.05, g.y + g.h / 2);
          model.add(lbl);
        }
      }

      /* booth number floats above sold/held tiles */
      if (el.kind === 'space' && el.props?.number) {
        const spr = numberSprite(String(el.props.number));
        if (spr) {
          spr.position.set(g.x + g.w / 2, 2.2, g.y + g.h / 2);
          model.add(spr);
        }
      }
    }

    scene.add(model);
  }

  function numberSprite(text) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const x = c.getContext('2d');
    if (!x) return null;
    x.fillStyle = 'rgba(19,26,38,.82)';
    const r = 14;
    x.beginPath();
    x.roundRect(8, 6, 112, 52, r);
    x.fill();
    x.fillStyle = '#fff';
    x.font = '600 30px Inter, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, 64, 33);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
    spr.scale.set(4, 2, 1);
    return spr;
  }

  /* ============================================================
     Editing in 3D.

     The 3D view is an editor, not a picture: click selects (and the
     Properties panel follows, since selection is shared with 2D),
     dragging an object slides it across the floor, R rotates it, and
     whatever is armed in the side catalog places on click. Dragging
     empty floor still orbits.
     ============================================================ */
  let selBox = null, drag = null;
  let ray, ptr, floorPlane;

  /* ---- smooth camera flights: double-click, Fit floor, frame() ---- */
  let fly = null;
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function flyTo(toTarget, toPos) {
    fly = {
      t: 0,
      fromT: controls.target.clone(),
      fromP: camera.position.clone(),
      toT: toTarget, toP: toPos,
    };
  }

  function flyPoint(x, z, dist) {
    flyTo(new THREE.Vector3(x, 2, z),
          new THREE.Vector3(x + dist * 0.45, dist * 0.5, z + dist * 0.9));
  }

  function flyFit() {
    const W = FP.plan.width, H = FP.plan.height, R = Math.max(W, H);
    flyTo(new THREE.Vector3(W / 2, 0, H / 2),
          new THREE.Vector3(W / 2 - R * 0.55, R * 0.62, H / 2 + R * 0.85));
  }

  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1,
            -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    for (const h of ray.intersectObjects(scene.children, true)) {
      if (h.object.isSprite || h.object.type === 'GridHelper') continue;
      let o = h.object;
      while (o && !o.userData.elId) o = o.parent;
      if (o) return { obj: o, point: h.point };
      break;    /* hit scenery (floor/curb) — treat as empty floor */
    }
    const pt = new THREE.Vector3();
    ray.ray.intersectPlane(floorPlane, pt);
    return { obj: null, point: pt };
  }

  function groupFor(id) {
    let found = null;
    scene.traverse((o) => { if (!found && o.userData.elId === id) found = o; });
    return found;
  }

  function highlight() {
    if (selBox) { scene.remove(selBox); selBox.dispose?.(); selBox = null; }
    const id = FP.state.selection?.[0];
    const obj = id && groupFor(id);
    if (obj) {
      selBox = new THREE.BoxHelper(obj, 0x7c5cfc);
      scene.add(selBox);
    }
  }

  const SNAP = 0.5;
  const snap = (v) => Math.round(v / SNAP) * SNAP;

  function translateEl(el, dx, dz) {
    const g = el.geometry;
    if (el.shape === 'line') { g.x1 += dx; g.y1 += dz; g.x2 += dx; g.y2 += dz; }
    else { g.x = (g.x ?? 0) + dx; g.y = (g.y ?? 0) + dz; }
  }

  function onDown(ev) {
    fly = null;                        /* user takes over from any flight */
    if (ev.button !== 0) return;
    const hit = pick(ev);

    /* armed catalog kind + empty floor = place it right here */
    const armed = FP.state.armedKind;
    if (!hit.obj && armed && ['draw', 'marker'].includes(FP.state.tool)) {
      const k = FP.config.kind(armed);
      if (k.shape === 'rect' || k.shape === 'marker') {
        const [w, h] = k.size || [4, 2];
        const geo = k.shape === 'marker'
          ? { x: snap(hit.point.x), y: snap(hit.point.z) }
          : { x: snap(hit.point.x - w / 2), y: snap(hit.point.z - h / 2), w, h };
        const el = FP.makeElement(armed, geo);
        FP.addElements([el]);           /* snapshots, selects, rebuilds */
        return;
      }
      FP.toast?.('Draw walls, drape and lines on the 2D plan');
      return;
    }

    if (!hit.obj) return;               /* empty floor: orbit as usual */

    const el = (FP.plan.elements || []).find((e) => e.id === hit.obj.userData.elId);
    if (!el) return;
    FP.state.selection = [el.id];
    FP.emit('select');
    highlight();
    if (FP.isLocked?.(el)) return;

    controls.enabled = false;
    drag = { el, obj: hit.obj, start: hit.point.clone(), moved: false,
             origin: hit.obj.position.clone() };
  }

  function onMove(ev) {
    if (!drag) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1,
            -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const pt = new THREE.Vector3();
    if (!ray.ray.intersectPlane(floorPlane, pt)) return;
    const dx = snap(pt.x - drag.start.x), dz = snap(pt.z - drag.start.z);
    if (dx || dz) drag.moved = true;
    drag.obj.position.set(drag.origin.x + dx, drag.origin.y, drag.origin.z + dz);
    selBox?.update();
  }

  function onUp() {
    if (!drag) return;
    const { el, obj, origin, moved } = drag;
    drag = null;
    controls.enabled = true;
    if (!moved) return;
    const dx = obj.position.x - origin.x, dz = obj.position.z - origin.z;
    FP.snapshot();
    translateEl(el, dx, dz);
    /* a booth takes its contents with it, same as in 2D */
    if (el.kind === 'space') {
      for (const c of FP.plan.elements) {
        if (c.parentId === el.id) translateEl(c, dx, dz);
      }
    }
    FP.changed();                       /* recheck + autosave + rebuild */
  }

  function onKey(ev) {
    if (!opened) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    if (ev.key === 'r' || ev.key === 'R') {
      const el = (FP.plan.elements || []).find((e) => e.id === FP.state.selection?.[0]);
      if (!el || el.shape !== 'rect') return;
      FP.snapshot();
      el.geometry.rot = ((el.geometry.rot || 0) + 45) % 360;
      FP.changed();
      ev.preventDefault();
    } else if (ev.key === 'Escape') {
      FP.state.selection = [];
      FP.emit('select');
      highlight();
    }
  }

  function initEditing() {
    ray = new THREE.Raycaster();
    ptr = new THREE.Vector2();
    floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const c = renderer.domElement;
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointerleave', onUp);
    c.addEventListener('dblclick', (ev) => {
      const hit = pick(ev);
      if (hit.point) flyPoint(hit.point.x, hit.point.z, hit.obj ? 22 : 45);
    });
    document.addEventListener('keydown', onKey);
    FP.on?.('select', () => { if (opened) highlight(); });
  }

  /* ---------------- lifecycle ---------------- */
  async function open() {
    if (opened) return;
    opened = true;

    if (!overlay) buildOverlay();
    overlay.classList.add('show');

    if (!THREE) {
      overlay.querySelector('.v3d-top b').textContent = 'Loading 3D…';
      try {
        /* OrbitControls imports the bare specifier 'three', resolved by
           the import map in the page's <head>. */
        THREE = await import('three');
        Orbit = (await import('three/addons/controls/OrbitControls.js')).OrbitControls;
        RBox = (await import('three/addons/geometries/RoundedBoxGeometry.js')).RoundedBoxGeometry;
      } catch (e) {
        opened = false;
        overlay.classList.remove('show');
        FP.toast?.('Could not load the 3D engine — check your connection', true);
        return;
      }
      overlay.querySelector('.v3d-top b').textContent = '3D preview';
    }

    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      overlay.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0xeceff4);

      camera = new THREE.PerspectiveCamera(46, 1, 0.5, 4000);

      const hemi = new THREE.HemisphereLight(0xffffff, 0xd8dde6, 0.75);
      scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xffffff, 1.35);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0004;
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0xdfe6f5, 0.45);
      fill.position.set(-1, 1, -0.5);
      scene.add(fill);
      scene.userData.sun = sun;

      /* studio environment: soft reflections make chrome read as chrome
         and glass as glass — the single biggest realism win per byte */
      try {
        const { RoomEnvironment } =
          await import('three/addons/environments/RoomEnvironment.js');
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environmentIntensity = 0.55;
      } catch { /* env is a bonus, never a blocker */ }

      controls = new Orbit(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI * 0.49;
      /* look-around ergonomics: the wheel zooms toward the cursor, the
         floor stays underfoot while panning, and you can get close */
      controls.zoomToCursor = true;
      controls.zoomSpeed = 1.3;
      controls.panSpeed = 1.2;
      controls.screenSpacePanning = false;
      controls.minDistance = 4;

      /* the model follows every edit, so 3D can stay open while the
         other side moves furniture */
      FP.on?.('change', () => { if (opened) { rebuild(); highlight(); } });
      initEditing();
    }

    const W = FP.plan.width, H = FP.plan.height;
    const R = Math.max(W, H);
    camera.position.set(W / 2 - R * 0.55, R * 0.62, H / 2 + R * 0.85);
    controls.target.set(W / 2, 0, H / 2);
    controls.maxDistance = R * 3;
    const sun = scene.userData.sun;
    sun.position.set(W / 2 - R * 0.4, R * 0.9, H / 2 - R * 0.3);
    sun.shadow.camera.left = -R; sun.shadow.camera.right = R;
    sun.shadow.camera.top = R; sun.shadow.camera.bottom = -R;
    sun.shadow.camera.far = R * 4;

    rebuild();
    resize();
    root.addEventListener('resize', resize);
    loop();
  }

  function resize() {
    if (!renderer || !overlay) return;
    const w = overlay.clientWidth, h = overlay.clientHeight - 44;
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function loop() {
    if (!opened) return;
    raf = requestAnimationFrame(loop);
    if (fly) {
      fly.t += 1 / 40;
      const k = ease(Math.min(fly.t, 1));
      controls.target.lerpVectors(fly.fromT, fly.toT, k);
      camera.position.lerpVectors(fly.fromP, fly.toP, k);
      if (fly.t >= 1) fly = null;
    }
    controls.update();
    renderer.render(scene, camera);
  }

  function close() {
    opened = false;
    cancelAnimationFrame(raf);
    root.removeEventListener('resize', resize);
    overlay?.classList.remove('show');
  }

  FP.view3d = {
    open, close,
    toggle: () => (opened ? close() : open()),
    /** Fly the camera to a plan point — used for zoom-to-selection. */
    frame(x, z, dist = 40) {
      if (!camera || !controls) return;
      flyPoint(x, z, dist);
    },
  };

  /* self-wire: the button exists on pages that include this file */
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn3D')?.addEventListener('click', FP.view3d.toggle);
  });
  document.getElementById('btn3D')?.addEventListener('click', FP.view3d.toggle);
})(window);
