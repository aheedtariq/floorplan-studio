/* ============================================================
   cad.js — CAD floor plan import (.dwg / .dxf).

   The file Lexi sends IS the floor plan — this module reads it
   directly. The LibreDWG WebAssembly engine (10 MB, GPL) lazy-loads
   only when a staff member actually picks a CAD file; parsing happens
   entirely in the browser, so client drawings never leave the machine.

   Flow: parse → bucket entities by CAD layer → auto-map layers to app
   concepts (ExpoCAD-style names like Expo_BoothOutline are recognised)
   → staff confirms the mapping in a dialog → everything lands as real,
   editable elements in one undo step.

   Coordinate notes: CAD Y grows upward, the editor's grows downward,
   so Y flips around the imported extents. Booth blocks named like
   "Expo10x10" carry their size in FEET in the name — that also pins
   the drawing unit exactly.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  let engine = null;
  async function ensureEngine() {
    if (engine) return engine;
    FP.toast?.('Loading CAD engine — first time takes a moment…');
    const mod = await import('./vendor/libredwg/dist/libredwg-web.js');
    const inst = await mod.LibreDwg.create();
    engine = { mod, inst };
    return engine;
  }

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const EXPO_RE = /^expo\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i;

  /* AutoCAD colour index → hex; 256 = ByLayer, resolved by the caller */
  const ACI = {
    1: '#dc2626', 2: '#ca8a04', 3: '#16a34a', 4: '#0891b2', 5: '#2563eb',
    6: '#c026d3', 7: '#334155', 8: '#94a3b8', 9: '#cbd5e1', 30: '#ea580c',
    250: '#1e293b', 251: '#475569', 252: '#64748b', 253: '#94a3b8',
    254: '#cbd5e1', 255: '#e2e8f0',
  };

  /** Polyline vertices with bulges → sampled point list (arcs chorded). */
  function bulgePts(vs) {
    const out = [];
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], b = vs[i + 1];
      if (!isNum(a.x) || !isNum(a.y)) continue;
      out.push([a.x, a.y]);
      const g = a.bulge || 0;
      if (!b || !isNum(b.x) || Math.abs(g) < 0.02) continue;
      const th = 4 * Math.atan(g);
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) continue;
      const r = d / (2 * Math.sin(th / 2));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const m = r * Math.cos(th / 2);
      const cx = mx - (dy / d) * m, cy = my + (dx / d) * m;
      const a0 = Math.atan2(a.y - cy, a.x - cx);
      const n = Math.max(3, Math.ceil(Math.abs(th) / 0.3));
      for (let k = 1; k < n; k++) {
        const t = a0 + (th * k) / n;
        out.push([cx + Math.abs(r) * Math.cos(t), cy + Math.abs(r) * Math.sin(t)]);
      }
    }
    return out;
  }

  /* ---------------- parse + digest ---------------- */

  async function parse(file) {
    const { mod, inst } = await ensureEngine();
    const buf = await file.arrayBuffer();
    const type = /\.dxf$/i.test(file.name)
      ? mod.Dwg_File_Type.DXF : mod.Dwg_File_Type.DWG;
    const dwg = inst.dwg_read_data(buf, type);
    if (!dwg) throw new Error('Could not read that CAD file');
    const db = inst.convert(dwg);
    try { inst.dwg_free?.(dwg); } catch { /* engine owns it */ }
    if (!(db?.entities || []).length) throw new Error('No drawing entities found in that file');
    return digest(db);
  }

  /** Reduce raw entities to (a) per-layer buckets for mapping and
      (b) a flat "sheet" of draw records — EVERY visible stroke, fill,
      curve and symbol, blocks expanded — for the exact 1:1 backdrop. */
  function digest(db) {
    const layers = {};
    const L = (name) => (layers[name] ||= {
      name, count: 0, lines: [], polys: [], texts: [], inserts: [],
      boothRects: [], shapes: [],
    });

    const layerColor = {};
    for (const l of db.tables?.LAYER?.entries || []) {
      layerColor[l.name] = ACI[l.colorIndex] || '#475569';
    }
    const blocks = {};
    for (const b of db.tables?.BLOCK_RECORD?.entries || []) {
      blocks[b.name] = b.entities || [];
    }

    const sheet = [];   /* {t, layer, c, bb:[x1,y1,x2,y2], ...} drawing units */
    const bbOf = (pts) => {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const [x, y] of pts) {
        x1 = Math.min(x1, x); x2 = Math.max(x2, x);
        y1 = Math.min(y1, y); y2 = Math.max(y2, y);
      }
      return [x1, y1, x2, y2];
    };
    const colorOf = (e, layerName) =>
      (e.colorIndex == null || e.colorIndex === 256 || e.colorIndex === 0)
        ? (layerColor[layerName] || '#475569') : (ACI[e.colorIndex] || '#64748b');

    /* transforms for block expansion */
    const ID = { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
    const ap = (tf, px, py) => {
      const x = px * tf.sx, y = py * tf.sy;
      const c = Math.cos(tf.rot), s = Math.sin(tf.rot);
      return [tf.x + x * c - y * s, tf.y + x * s + y * c];
    };

    function emit(e, tf, depth, layerName) {
      const lname = depth === 0 ? String(e.layer ?? '0') : layerName;
      const lay = depth === 0 ? L(lname) : null;
      if (lay) lay.count++;
      const c = colorOf(e, lname);

      switch (e.type) {
        case 'LINE': {
          const a = e.startPoint, b = e.endPoint;
          if (!a || !b || !isNum(a.x)) break;
          const pts = [ap(tf, a.x, a.y), ap(tf, b.x, b.y)];
          sheet.push({ t: 'pl', layer: lname, c, pts, bb: bbOf(pts) });
          if (lay) lay.lines.push([a.x, a.y, b.x, b.y]);
          break;
        }
        case 'LWPOLYLINE':
        case 'POLYLINE2D': {
          const raw = bulgePts(e.vertices || []);
          if (raw.length < 2) break;
          const closed = !!(e.closed) || !!((e.flag ?? 0) & 1) ||
            (Math.hypot(raw[0][0] - raw[raw.length - 1][0], raw[0][1] - raw[raw.length - 1][1]) < 1e-6);
          const pts = raw.map(([x, y]) => ap(tf, x, y));
          sheet.push({ t: closed ? 'pg' : 'pl', layer: lname, c, pts, bb: bbOf(pts) });
          if (lay) {
            lay.polys.push({ pts: raw, closed });
            if (closed) {
              const [x1, y1, x2, y2] = bbOf(raw);
              lay.shapes.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
            }
          }
          break;
        }
        case 'CIRCLE': {
          const p = e.center;
          if (!p || !isNum(p.x)) break;
          const [cx, cy] = ap(tf, p.x, p.y);
          const r = (e.radius || 0) * (Math.abs(tf.sx) + Math.abs(tf.sy)) / 2;
          sheet.push({ t: 'c', layer: lname, c, cx, cy, r, bb: [cx - r, cy - r, cx + r, cy + r] });
          if (lay && r > 0) {
            lay.shapes.push({ x: p.x - e.radius, y: p.y - e.radius, w: e.radius * 2, h: e.radius * 2 });
          }
          break;
        }
        case 'ARC': {
          const p = e.center;
          if (!p || !isNum(p.x)) break;
          const r = e.radius || 0;
          const a0 = e.startAngle || 0, a1 = e.endAngle || 0;
          const sweep = ((a1 - a0) + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2;
          const n = Math.max(4, Math.ceil(sweep / 0.3));
          const pts = [];
          for (let k = 0; k <= n; k++) {
            const t = a0 + (sweep * k) / n;
            pts.push(ap(tf, p.x + r * Math.cos(t), p.y + r * Math.sin(t)));
          }
          sheet.push({ t: 'pl', layer: lname, c, pts, bb: bbOf(pts) });
          break;
        }
        case 'SPLINE': {
          const src = (e.fitPoints?.length ? e.fitPoints : e.controlPoints) || [];
          const pts = src.filter((v) => isNum(v.x)).map((v) => ap(tf, v.x, v.y));
          if (pts.length >= 2) sheet.push({ t: 'pl', layer: lname, c, pts, bb: bbOf(pts) });
          break;
        }
        case 'SOLID': {
          const cs = [e.corner1, e.corner2, e.corner4, e.corner3]
            .filter((p) => p && isNum(p.x)).map((p) => ap(tf, p.x, p.y));
          if (cs.length >= 3) sheet.push({ t: 'sd', layer: lname, c, pts: cs, bb: bbOf(cs) });
          break;
        }
        case 'HATCH': {
          const loops = [];
          for (const bp of e.boundaryPaths || []) {
            const vs = (bp.vertices || []).filter((v) => isNum(v.x));
            if (vs.length >= 3) loops.push(bulgePts(vs).map(([x, y]) => ap(tf, x, y)));
          }
          if (loops.length) {
            const bb = bbOf(loops.flat());
            sheet.push({ t: 'h', layer: lname, c, loops, solid: !!e.solidFill, bb });
          }
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const p = e.startPoint || e.insertionPoint || e.position;
          const s = String(e.text ?? '').replace(/\\[A-Za-z][^;]*;|[{}]/g, '').trim();
          if (!p || !isNum(p.x) || !s) break;
          const [x, y] = ap(tf, p.x, p.y);
          const h = (e.textHeight || e.height || 9) * Math.abs(tf.sy);
          sheet.push({ t: 'tx', layer: lname, c, x, y, h, text: s, bb: [x, y, x + s.length * h * 0.6, y + h] });
          if (lay) lay.texts.push({ x: p.x, y: p.y, text: s });
          break;
        }
        case 'INSERT': {
          const p = e.insertionPoint;
          if (!p || !isNum(p.x)) break;
          const local = {
            x: p.x, y: p.y, name: String(e.name || ''),
            sx: e.xScale ?? 1, sy: e.yScale ?? 1, rot: e.rotation ?? 0,
          };
          if (lay) {
            lay.inserts.push(local);
            const m = EXPO_RE.exec(local.name);
            if (m) lay.boothRects.push(expoRect(local, Number(m[1]), Number(m[2])));
          }
          /* expand the block's own geometry through the transform so the
             backdrop shows door glyphs, symbols, everything */
          if (depth < 3 && blocks[local.name]?.length) {
            const [ox, oy] = ap(tf, local.x, local.y);
            const child = {
              x: ox, y: oy, rot: tf.rot + local.rot,
              sx: tf.sx * local.sx, sy: tf.sy * local.sy,
            };
            for (const be of blocks[local.name]) emit(be, child, depth + 1, lname);
          }
          break;
        }
        default: break; /* dimensions, viewports, OLE — sheet furniture */
      }
    }

    for (const e of db.entities || []) emit(e, ID, 0, null);
    return { layers, sheet };
  }

  /** Booth rect (drawing units) for an ExpoWxD block insert. The block
      is drawn W×D feet from its insertion corner; rotation is normalised
      through the corner set so any 90° multiple lands correctly. */
  function expoRect(ins, wft, dft) {
    /* feet → drawing units, using the block's own scale (12 ⇒ inches) */
    const ux = 12 * (ins.sx || 1), uy = 12 * (ins.sy || 1);
    const w = wft * ux, d = dft * uy;
    const cos = Math.cos(ins.rot || 0), sin = Math.sin(ins.rot || 0);
    const corners = [[0, 0], [w, 0], [w, d], [0, d]].map(([px, py]) =>
      [ins.x + px * cos - py * sin, ins.y + px * sin + py * cos]);
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    return {
      x: Math.min(...xs), y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
      wft, dft,
    };
  }

  /* ---------------- layer auto-mapping ---------------- */

  const MAPPINGS = [
    { id: 'skip', name: 'Backdrop only' },
    { id: 'booths', name: 'Booths' },
    { id: 'numbers', name: 'Booth numbers' },
    { id: 'walls', name: 'Walls' },
    { id: 'furniture', name: 'Furniture (auto-detect)' },
    { id: 'doors', name: 'Doors' },
    { id: 'fire', name: 'Fire exits' },
    { id: 'text', name: 'Text labels' },
    { id: 'zones', name: 'Zones' },
  ];

  function autoMap(lay) {
    const n = lay.name;
    if (/defpoints|viewport|^pdf[_ ]|dim|legend|title/i.test(n)) return 'skip';
    if (lay.boothRects.length) return 'booths';
    if (/booth.*(num|no\b|text|id)/i.test(n)) return 'numbers';
    if (/wall/i.test(n)) return 'walls';
    if (/round|banquet|furn|seat|chair|\btable/i.test(n) && lay.shapes.length) return 'furniture';
    if (/fire/i.test(n) && lay.inserts.length) return 'fire';
    if (/booth|outline/i.test(n) && lay.polys.some((p) => p.closed)) return 'booths';
    return 'skip';
  }

  const summary = (lay) => {
    const bits = [];
    if (lay.boothRects.length) bits.push(`${lay.boothRects.length} booth blocks`);
    else if (lay.inserts.length) bits.push(`${lay.inserts.length} symbols`);
    if (lay.polys.length) bits.push(`${lay.polys.length} shapes`);
    if (lay.lines.length) bits.push(`${lay.lines.length} lines`);
    if (lay.texts.length) bits.push(`${lay.texts.length} texts`);
    return bits.join(' · ') || `${lay.count} entities`;
  };

  /** A closed shape's footprint (feet) → the rental catalog item it is. */
  function classifyFurniture(w, h) {
    const ar = w / Math.max(h, 0.1);
    if (w >= 3.6 && w <= 7 && ar > 0.8 && ar < 1.25) return { kind: 'table-round-60', w: 5, h: 5 };
    if (w >= 5.3 && w <= 6.7 && h >= 1.7 && h <= 3.3) return { kind: 'table-6ft', w: 6, h: 2.5 };
    if (w >= 7.3 && w <= 8.7 && h >= 1.7 && h <= 3.3) return { kind: 'table-8ft', w: 8, h: 2.5 };
    if (h >= 5.3 && h <= 6.7 && w >= 1.7 && w <= 3.3) return { kind: 'table-6ft', w: 2.5, h: 6 };
    if (h >= 7.3 && h <= 8.7 && w >= 1.7 && w <= 3.3) return { kind: 'table-8ft', w: 2.5, h: 8 };
    if (w >= 1.1 && w <= 2.3 && h >= 1.1 && h <= 2.3) return { kind: 'chair', w: 1.6, h: 1.6 };
    return null;
  }

  /** Render the whole drawing as one aligned SVG — the exact backdrop.
      `exclude` layers (booths, numbers) become live elements instead,
      so they aren't double-drawn under themselves. */
  function sheetSvg(sheet, tr, exclude, clip) {
    const { X, Y, exW, exH } = tr;
    const f = (v) => v.toFixed(2);
    const P = (pts) => pts.map(([x, y]) => `${f(X(x))},${f(Y(y))}`).join(' ');
    const out = [];
    for (const r of sheet) {
      if (exclude.has(r.layer)) continue;
      if (r.bb[2] < clip[0] || r.bb[0] > clip[2] || r.bb[3] < clip[1] || r.bb[1] > clip[3]) continue;
      if (r.t === 'pl') out.push(`<polyline points="${P(r.pts)}" fill="none" stroke="${r.c}" stroke-width=".09"/>`);
      else if (r.t === 'pg') out.push(`<polygon points="${P(r.pts)}" fill="none" stroke="${r.c}" stroke-width=".09"/>`);
      else if (r.t === 'sd') out.push(`<polygon points="${P(r.pts)}" fill="${r.c}" fill-opacity=".85"/>`);
      else if (r.t === 'c') out.push(`<circle cx="${f(X(r.cx))}" cy="${f(Y(r.cy))}" r="${f(r.r * tr.u)}" fill="none" stroke="${r.c}" stroke-width=".09"/>`);
      else if (r.t === 'h') {
        const d = r.loops.map((lp) => `M${lp.map(([x, y]) => `${f(X(x))} ${f(Y(y))}`).join('L')}Z`).join('');
        out.push(`<path d="${d}" fill="${r.c}" fill-opacity="${r.solid ? '.8' : '.12'}" fill-rule="evenodd"/>`);
      } else if (r.t === 'tx') {
        const fs = Math.max(r.h * tr.u, 0.6);
        out.push(`<text x="${f(X(r.x))}" y="${f(Y(r.y))}" font-size="${f(fs)}" fill="${r.c}" font-family="Arial,sans-serif">${
          String(r.text).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</text>`);
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(exW)} ${f(exH)}">${out.join('')}</svg>`;
  }

  /* ---------------- build elements ---------------- */

  function build(layers, sheet, mapping, unitsPerFt, includeSheet) {
    const u = 1 / unitsPerFt;                 /* drawing units → feet */
    const snap = (v) => Math.round(v * 4) / 4;

    const booths = [], numbers = [], walls = [], doors = [], fires = [],
      texts = [], zones = [], furnShapes = [];

    for (const lay of Object.values(layers)) {
      const map = mapping[lay.name] || 'skip';
      if (map === 'skip') continue;
      if (map === 'booths') {
        booths.push(...lay.boothRects);
        for (const p of lay.polys) {
          if (!p.closed) continue;
          const xs = p.pts.map((v) => v[0]), ys = p.pts.map((v) => v[1]);
          booths.push({
            x: Math.min(...xs), y: Math.min(...ys),
            w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
          });
        }
      }
      if (map === 'numbers') numbers.push(...lay.texts);
      if (map === 'walls') {
        walls.push(...lay.lines);
        for (const p of lay.polys) {
          for (let i = 0; i < p.pts.length - 1; i++) {
            walls.push([p.pts[i][0], p.pts[i][1], p.pts[i + 1][0], p.pts[i + 1][1]]);
          }
          if (p.closed && p.pts.length > 2) {
            const a = p.pts[p.pts.length - 1], b = p.pts[0];
            walls.push([a[0], a[1], b[0], b[1]]);
          }
        }
      }
      if (map === 'doors') {
        for (const i of lay.inserts) doors.push({ x: i.x, y: i.y });
        for (const p of lay.polys) {
          if (!p.closed) continue;
          const xs = p.pts.map((v) => v[0]), ys = p.pts.map((v) => v[1]);
          doors.push({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
        }
      }
      if (map === 'fire') for (const i of lay.inserts) fires.push({ x: i.x, y: i.y });
      if (map === 'furniture') furnShapes.push(...lay.shapes);
      if (map === 'text') texts.push(...lay.texts);
      if (map === 'zones') {
        for (const p of lay.polys) {
          if (!p.closed) continue;
          const xs = p.pts.map((v) => v[0]), ys = p.pts.map((v) => v[1]);
          zones.push({
            x: Math.min(...xs), y: Math.min(...ys),
            w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
          });
        }
      }
    }

    if (!booths.length && !walls.length && !texts.length && !zones.length) {
      return { error: 'Nothing selected to import — map at least one layer' };
    }

    /* extents of everything that will actually be imported */
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const feed = (x, y) => {
      if (!isNum(x) || !isNum(y)) return;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    };
    booths.forEach((b) => { feed(b.x, b.y); feed(b.x + b.w, b.y + b.h); });
    walls.forEach((l) => { feed(l[0], l[1]); feed(l[2], l[3]); });
    zones.forEach((z) => { feed(z.x, z.y); feed(z.x + z.w, z.y + z.h); });
    texts.forEach((t) => feed(t.x, t.y));
    doors.forEach((d) => feed(d.x, d.y));
    fires.forEach((f) => feed(f.x, f.y));
    furnShapes.forEach((s) => { feed(s.x, s.y); feed(s.x + s.w, s.y + s.h); });
    if (!isFinite(minX)) return { error: 'The mapped layers contain no usable geometry' };

    /* CAD Y is up; the editor's is down — flip around the extents */
    const X = (x) => snap((x - minX) * u);
    const Y = (y) => snap((maxY - y) * u);

    const specs = [];

    for (const b of booths) {
      const w = snap(b.w * u), h = snap(b.h * u);
      if (w < 3 || h < 3 || w > 200 || h > 200) continue;
      specs.push({
        kind: 'space',
        geometry: { x: X(b.x), y: Y(b.y + b.h), w, h },
        props: { spaceType: 'inline' },
        _rect: { x: X(b.x), y: Y(b.y + b.h), w, h },
      });
    }
    /* match numbers to the booth whose footprint contains them */
    const pool = numbers.map((t) => ({ x: X(t.x), y: Y(t.y), text: t.text }));
    for (const s of specs) {
      if (!s._rect) continue;
      const r = s._rect;
      let hit = null, dBest = Infinity;
      for (const t of pool) {
        if (t.used) continue;
        const inside = t.x >= r.x - 1 && t.x <= r.x + r.w + 1 &&
                       t.y >= r.y - 1 && t.y <= r.y + r.h + 1;
        if (!inside) continue;
        const d = Math.hypot(t.x - (r.x + r.w / 2), t.y - (r.y + r.h / 2));
        if (d < dBest) { dBest = d; hit = t; }
      }
      if (hit) { hit.used = true; s.props.number = hit.text; }
    }
    specs.forEach((s) => delete s._rect);

    for (const l of walls) {
      const x1 = X(l[0]), y1 = Y(l[1]), x2 = X(l[2]), y2 = Y(l[3]);
      if (Math.hypot(x2 - x1, y2 - y1) < 0.9) continue;   /* glyph specks */
      specs.push({ kind: 'wall', geometry: { x1, y1, x2, y2, thickness: 0.75 }, props: {} });
    }
    for (const d of doors) {
      specs.push({ kind: 'door', geometry: { x: X(d.x) - 3, y: Y(d.y) - 0.5, w: 6, h: 1 }, props: { label: 'Entrance' } });
    }
    for (const f of fires) {
      specs.push({ kind: 'fire-exit', geometry: { x: X(f.x) - 1.5, y: Y(f.y) - 0.5, w: 3, h: 1 }, props: { label: 'Fire exit' } });
    }
    for (const z of zones) {
      const w = snap(z.w * u), h = snap(z.h * u);
      if (w < 2 || h < 2) continue;
      specs.push({ kind: 'zone', geometry: { x: X(z.x), y: Y(z.y + z.h), w, h }, props: { label: '' } });
    }
    for (const t of texts) {
      specs.push({ kind: 'text', geometry: { x: X(t.x), y: Y(t.y) }, props: { text: t.text, fontSize: 2.5 } });
    }

    /* furniture: drawn shapes become the real rental catalog items —
       nearest-size match, deduped so a table's inner linework doesn't
       become a second table */
    const placedFurn = [];
    for (const s of furnShapes) {
      const it = classifyFurniture(s.w * u, s.h * u);
      if (!it) continue;
      const cx = X(s.x + s.w / 2), cy = Y(s.y + s.h / 2);
      if (placedFurn.some((p) => Math.hypot(p.x - cx, p.y - cy) < Math.max(it.w, it.h) * 0.6)) continue;
      placedFurn.push({ x: cx, y: cy });
      specs.push({
        kind: it.kind,
        geometry: { x: snap(cx - it.w / 2), y: snap(cy - it.h / 2), w: it.w, h: it.h },
        props: {},
      });
    }

    /* grow the hall to hold the import — never shrink */
    FP.snapshot();
    const needW = Math.ceil(((maxX - minX) * u + 4) / 5) * 5;
    const needH = Math.ceil(((maxY - minY) * u + 4) / 5) * 5;
    if (needW > FP.plan.width) FP.plan.width = needW;
    if (needH > FP.plan.height) FP.plan.height = needH;

    /* the exact 1:1 backdrop: the whole drawing as an aligned SVG
       underlay — every stroke, fill, curve and symbol, in its colours */
    if (includeSheet && sheet?.length) {
      const exclude = new Set(Object.entries(mapping)
        .filter(([, m]) => m === 'booths' || m === 'numbers')
        .map(([name]) => name));
      const exW = (maxX - minX) * u, exH = (maxY - minY) * u;
      const tr = {
        X: (x) => (x - minX) * u,
        Y: (y) => (maxY - y) * u,
        u, exW, exH,
      };
      const pad = Math.max((maxX - minX), (maxY - minY)) * 0.03;
      const clip = [minX - pad, minY - pad, maxX + pad, maxY + pad];
      const svg = sheetSvg(sheet, tr, exclude, clip);
      if (svg.length < 4.5e6) {
        let b64 = null;
        try { b64 = btoa(unescape(encodeURIComponent(svg))); } catch { /* huge/odd chars */ }
        if (b64) {
          FP.setUnderlay({
            src: `data:image/svg+xml;base64,${b64}`,
            x: 0, y: 0, w: snap(exW), h: snap(exH), opacity: 0.95, locked: true,
          });
        }
      }
    }

    const real = specs.map((s) => {
      const el = FP.makeElement(s.kind, s.geometry);
      Object.assign(el.props, s.props);
      return el;
    });
    /* house standard: every booth arrives with its 6-ft draped table
       and two chairs, same as booths placed by hand */
    FP.addElements(real, { snapshot: false, select: false, furnish: true });
    /* …but the 2D sheet stays exactly as drawn — furniture lives on the
       contents layer, hidden here so only the 3D walkthrough shows it.
       One click in the Layers panel brings it back. */
    if (specs.some((s) => s.kind === 'space') && FP.plan.layers?.contents) {
      FP.plan.layers.contents.visible = false;
    }

    return {
      booths: specs.filter((s) => s.kind === 'space').length,
      numbered: specs.filter((s) => s.kind === 'space' && s.props.number).length,
      walls: specs.filter((s) => s.kind === 'wall').length,
      texts: specs.filter((s) => s.kind === 'text').length,
      zones: specs.filter((s) => s.kind === 'zone').length,
      furniture: specs.filter((s) => ['table-round-60', 'table-6ft', 'table-8ft', 'chair'].includes(s.kind)).length,
      doors: specs.filter((s) => s.kind === 'door').length + specs.filter((s) => s.kind === 'fire-exit').length,
    };
  }

  /** Guess drawing units per foot: booth blocks pin it exactly;
      otherwise closed-rect sizes separate inches from feet. */
  function guessUnits(layers) {
    for (const lay of Object.values(layers)) {
      const b = lay.boothRects[0];
      if (b && b.wft) return Math.round((b.w / b.wft) * 100) / 100 || 12;
    }
    const sides = [];
    for (const lay of Object.values(layers)) {
      for (const p of lay.polys) {
        if (!p.closed) continue;
        const xs = p.pts.map((v) => v[0]), ys = p.pts.map((v) => v[1]);
        sides.push(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      }
    }
    sides.sort((a, b) => a - b);
    const med = sides[Math.floor(sides.length / 2)] || 10;
    if (med > 2000) return 304.8;   /* millimetres */
    if (med > 45) return 12;        /* inches */
    return 1;                       /* feet */
  }

  /* ---------------- dialog ---------------- */

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function importFile(file) {
    let layers, sheet;
    try {
      FP.toast?.('Reading the CAD file…');
      ({ layers, sheet } = await parse(file));
    } catch (e) {
      FP.toast?.(e?.message || 'Could not read that CAD file', true);
      return;
    }
    const rows = Object.values(layers).sort((a, b) => b.count - a.count);
    const units = guessUnits(layers);

    FP.modal({
      title: `Import ${esc(file.name)}`,
      wide: true,
      body: `
        <p style="margin:0 0 10px;color:var(--tx-2);font-size:13px">
          Every CAD layer below can become part of this plan. The usual ones are
          matched automatically — adjust anything, then import. Nothing is final:
          it's all one undo step.</p>
        <div class="row2" style="margin-bottom:10px;max-width:280px">
          <div><label style="font-size:11.5px;font-weight:650;color:var(--tx-3)">Drawing units</label>
          <select class="inp" id="cadUnits">
            <option value="12"${units === 12 ? ' selected' : ''}>Inches</option>
            <option value="1"${units === 1 ? ' selected' : ''}>Feet</option>
            <option value="304.8"${units === 304.8 ? ' selected' : ''}>Millimetres</option>
          </select></div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin:0 0 12px;font-size:13px;
          font-weight:600;color:var(--tx-2);cursor:pointer">
          <input type="checkbox" id="cadSheet" checked style="accent-color:var(--accent);width:14px;height:14px"/>
          Show the original drawing underneath — exact 1:1 backdrop
        </label>
        <div style="max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:10px">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px">
          <thead><tr>
            <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);color:var(--tx-3);font-size:10.5px;text-transform:uppercase;letter-spacing:.05em">CAD layer</th>
            <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);color:var(--tx-3);font-size:10.5px;text-transform:uppercase;letter-spacing:.05em">Contains</th>
            <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);color:var(--tx-3);font-size:10.5px;text-transform:uppercase;letter-spacing:.05em">Import as</th>
          </tr></thead>
          <tbody>
          ${rows.map((lay) => `<tr>
            <td style="padding:7px 10px;border-bottom:1px solid var(--line);font-weight:600">${esc(lay.name)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid var(--line);color:var(--tx-3)">${esc(summary(lay))}</td>
            <td style="padding:7px 10px;border-bottom:1px solid var(--line)">
              <select class="inp cad-map" data-layer="${esc(lay.name)}" style="padding:6px 8px;font-size:12.5px">
                ${MAPPINGS.map((m) => `<option value="${m.id}"${autoMap(lay) === m.id ? ' selected' : ''}>${m.name}</option>`).join('')}
              </select></td>
          </tr>`).join('')}
          </tbody>
        </table></div>`,
      foot: `<button class="btn ghost" data-close>Cancel</button>
             <div class="grow"></div>
             <button class="btn primary" id="cadGo">Import floor plan</button>`,
      onMount: (body, foot) => {
        foot.querySelector('[data-close]').onclick = FP.closeModal;
        foot.querySelector('#cadGo').onclick = () => {
          const mapping = {};
          body.querySelectorAll('.cad-map').forEach((sel) => {
            mapping[sel.dataset.layer] = sel.value;
          });
          const unitsPerFt = Number(body.querySelector('#cadUnits').value) || 12;
          const includeSheet = !!body.querySelector('#cadSheet')?.checked;
          const res = build(layers, sheet, mapping, unitsPerFt, includeSheet);
          FP.closeModal();
          if (res.error) return FP.toast?.(res.error, true);
          FP.render.fit();
          FP.toast?.(`Imported ${res.booths} booths (${res.numbered} numbered), ${res.walls} walls, ${res.furniture} furniture pieces`);
        };
      },
    });
  }

  FP.cad = { importFile };
})(window);
