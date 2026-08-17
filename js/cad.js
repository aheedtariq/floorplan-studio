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

  /** Reduce raw entities to simple shapes, bucketed per CAD layer. */
  function digest(db) {
    const layers = {};
    const L = (name) => (layers[name] ||= {
      name, count: 0, lines: [], polys: [], texts: [], inserts: [], boothRects: [],
    });

    for (const e of db.entities || []) {
      const lay = L(String(e.layer ?? '0'));
      lay.count++;
      switch (e.type) {
        case 'LINE': {
          const a = e.startPoint, b = e.endPoint;
          if (a && b && isNum(a.x)) lay.lines.push([a.x, a.y, b.x, b.y]);
          break;
        }
        case 'LWPOLYLINE':
        case 'POLYLINE2D': {
          const vs = (e.vertices || [])
            .map((v) => [v.x, v.y]).filter((v) => isNum(v[0]) && isNum(v[1]));
          if (vs.length < 2) break;
          const closed = !!(e.closed) || !!((e.flag ?? 0) & 1) ||
            (Math.hypot(vs[0][0] - vs[vs.length - 1][0], vs[0][1] - vs[vs.length - 1][1]) < 1e-6);
          lay.polys.push({ pts: vs, closed });
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const p = e.startPoint || e.insertionPoint || e.position;
          const s = String(e.text ?? '').replace(/\\[A-Za-z][^;]*;|[{}]/g, '').trim();
          if (p && isNum(p.x) && s) lay.texts.push({ x: p.x, y: p.y, text: s });
          break;
        }
        case 'INSERT': {
          const p = e.insertionPoint;
          if (!p || !isNum(p.x)) break;
          const ins = {
            x: p.x, y: p.y, name: String(e.name || ''),
            sx: e.xScale ?? 1, sy: e.yScale ?? 1, rot: e.rotation ?? 0,
          };
          lay.inserts.push(ins);
          /* ExpoCAD booth blocks: the name is the booth size in feet */
          const m = EXPO_RE.exec(ins.name);
          if (m) lay.boothRects.push(expoRect(ins, Number(m[1]), Number(m[2])));
          break;
        }
        default: break; /* hatches, splines, dims: presentation only */
      }
    }
    return layers;
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
    { id: 'skip', name: 'Skip' },
    { id: 'booths', name: 'Booths' },
    { id: 'numbers', name: 'Booth numbers' },
    { id: 'walls', name: 'Walls' },
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

  /* ---------------- build elements ---------------- */

  function build(layers, mapping, unitsPerFt) {
    const u = 1 / unitsPerFt;                 /* drawing units → feet */
    const snap = (v) => Math.round(v * 4) / 4;

    const booths = [], numbers = [], walls = [], doors = [], fires = [],
      texts = [], zones = [];

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

    /* grow the hall to hold the import — never shrink */
    FP.snapshot();
    const needW = Math.ceil(((maxX - minX) * u + 4) / 5) * 5;
    const needH = Math.ceil(((maxY - minY) * u + 4) / 5) * 5;
    if (needW > FP.plan.width) FP.plan.width = needW;
    if (needH > FP.plan.height) FP.plan.height = needH;

    const real = specs.map((s) => {
      const el = FP.makeElement(s.kind, s.geometry);
      Object.assign(el.props, s.props);
      return el;
    });
    /* faithful import: the CAD file already says what each booth holds,
       so no auto-furnishing — staff can furnish afterwards */
    FP.addElements(real, { snapshot: false, select: false, furnish: false });

    return {
      booths: specs.filter((s) => s.kind === 'space').length,
      numbered: specs.filter((s) => s.kind === 'space' && s.props.number).length,
      walls: specs.filter((s) => s.kind === 'wall').length,
      texts: specs.filter((s) => s.kind === 'text').length,
      zones: specs.filter((s) => s.kind === 'zone').length,
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
    let layers;
    try {
      FP.toast?.('Reading the CAD file…');
      layers = await parse(file);
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
        <div class="row2" style="margin-bottom:12px;max-width:280px">
          <div><label style="font-size:11.5px;font-weight:650;color:var(--tx-3)">Drawing units</label>
          <select class="inp" id="cadUnits">
            <option value="12"${units === 12 ? ' selected' : ''}>Inches</option>
            <option value="1"${units === 1 ? ' selected' : ''}>Feet</option>
            <option value="304.8"${units === 304.8 ? ' selected' : ''}>Millimetres</option>
          </select></div>
        </div>
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
          const res = build(layers, mapping, unitsPerFt);
          FP.closeModal();
          if (res.error) return FP.toast?.(res.error, true);
          FP.render.fit();
          FP.toast?.(`Imported ${res.booths} booths (${res.numbered} numbered), ${res.walls} walls, ${res.texts} labels`);
        };
      },
    });
  }

  FP.cad = { importFile };
})(window);
