/* ============================================================
   interactions.js — pointer and keyboard editing.

   All pointer state lives in FP.state.drag; the renderer reads
   FP.state.draft for in-progress shapes. Nothing here writes SVG.

   Geometry is edited in the element's own local frame, so a rotated
   rect resizes along its own axes and keeps the opposite corner pinned.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});
  const G = FP.geo;
  const C = FP.config;
  const S = FP.state;

  let svg = null;
  let spaceHeld = false;

  const R = () => FP.render;

  /* ---------------- snapping ---------------- */
  const step = () => FP.plan.grid || 1;
  const snapV = (v, force) => ((S.snap && !force) ? G.snap(v, step()) : G.round(v, 2));
  const snapPt = (p, force) => ({ x: snapV(p.x, force), y: snapV(p.y, force) });

  /* ---------------- helpers ---------------- */
  function armedKindId() {
    return S.armedKind || 'space';
  }

  function parentForNew() {
    return S.scope.type === 'booth' ? S.scope.spaceId : null;
  }

  /** Elements the pointer may grab, topmost first. */
  function pickable() {
    return FP.inScope().filter((e) => FP.isVisible(e) && !FP.isLocked(e));
  }

  /* Big open zones (aisles, fire lanes, rigging areas, dead space) are
     drawn as large translucent rectangles that often sit over the booths
     inside them. Treat them as background so a click lands on the
     specific thing the user meant, not the container. */
  const isBackdrop = (el) =>
    C.flag(el.kind, 'aisle') || C.flag(el.kind, 'zone') ||
    C.flag(el.kind, 'keepClear') || C.flag(el.kind, 'riggingZone') ||
    C.flag(el.kind, 'unsellable');

  /**
   * Resolve a click to one element. Preference order:
   *   1. foreground before backdrop
   *   2. smaller area before larger  (the most specific thing under the cursor)
   *   3. higher layer before lower   (tie-break)
   */
  function hitAt(x, y) {
    const slop = 6 / S.view.zoom;
    const hits = [];
    pickable().forEach((el, i) => {
      if (!G.hitTest(x, y, el, el.shape === 'line' ? slop : 0)) return;
      hits.push({ el, i, back: isBackdrop(el) ? 1 : 0, area: G.area(el) || Infinity });
    });
    if (!hits.length) return null;

    hits.sort((a, b) =>
      a.back - b.back ||
      a.area - b.area ||
      C.layerOrder(b.el.layer) - C.layerOrder(a.el.layer) ||
      b.i - a.i);
    return hits[0].el;
  }

  function setTool(tool, kindId = null) {
    S.tool = tool;
    S.armedKind = kindId;
    S.draft = null;
    if (tool !== 'select') S.armedSize = S.armedSize && kindId ? S.armedSize : null;
    updateCursor();
    FP.emit('tool');
    R().draw();
  }
  FP.setTool = setTool;

  function updateCursor() {
    if (!svg) return;
    svg.classList.toggle('tool-draw', ['draw', 'poly', 'line', 'marker', 'text'].includes(S.tool));
    svg.classList.toggle('tool-measure', S.tool === 'measure' || S.tool === 'calibrate');
    svg.classList.toggle('tool-pan', S.tool === 'pan' || spaceHeld);
  }

  /* ============================================================
     Geometry transforms
     ============================================================ */

  /** Resize a rect from `handle`, keeping the opposite edge/corner pinned. */
  function resizeRect(el, orig, handle, world, opts) {
    const rot = orig.rot || 0;
    const c0 = { x: orig.x + orig.w / 2, y: orig.y + orig.h / 2 };
    const p = G.rotate(world.x, world.y, c0.x, c0.y, -rot);

    let { x, y, w, h } = orig;
    const right = x + w, bottom = y + h;

    if (handle.includes('w')) { x = snapV(p.x, opts.free); w = right - x; }
    if (handle.includes('e')) { w = snapV(p.x, opts.free) - x; }
    if (handle.includes('n')) { y = snapV(p.y, opts.free); h = bottom - y; }
    if (handle.includes('s')) { h = snapV(p.y, opts.free) - y; }

    /* Shift keeps the original aspect ratio on corner handles. */
    if (opts.ratio && handle.length === 2 && orig.w && orig.h) {
      const ar = orig.w / orig.h;
      if (Math.abs(w) / ar > Math.abs(h)) h = Math.sign(h || 1) * Math.abs(w) / ar;
      else w = Math.sign(w || 1) * Math.abs(h) * ar;
      if (handle.includes('w')) x = right - w;
      if (handle.includes('n')) y = bottom - h;
    }

    const min = 0.25;
    const norm = G.normalizeRect({ x, y, w, h });
    norm.w = Math.max(norm.w, min);
    norm.h = Math.max(norm.h, min);

    /* The new rect was computed in the ORIGINAL local frame; rotate its
       centre back so the pinned edge stays put on screen. */
    const c1 = { x: norm.x + norm.w / 2, y: norm.y + norm.h / 2 };
    const world1 = G.rotate(c1.x, c1.y, c0.x, c0.y, rot);

    return {
      ...el.geometry,
      x: G.round(world1.x - norm.w / 2, 3),
      y: G.round(world1.y - norm.h / 2, 3),
      w: G.round(norm.w, 3),
      h: G.round(norm.h, 3),
      rot,
    };
  }

  /** Uniformly scale any element about an anchor — used for multi-select. */
  function scaleGeometry(el, orig, ax, ay, sx, sy) {
    const q = { ...orig };
    const fx = (v) => ax + (v - ax) * sx;
    const fy = (v) => ay + (v - ay) * sy;
    switch (el.shape) {
      case 'rect':
        q.x = fx(orig.x); q.y = fy(orig.y);
        q.w = Math.max(orig.w * sx, 0.25); q.h = Math.max(orig.h * sy, 0.25);
        break;
      case 'poly':
        q.pts = orig.pts.map(([x, y]) => [fx(x), fy(y)]);
        break;
      case 'line':
        q.x1 = fx(orig.x1); q.y1 = fy(orig.y1);
        q.x2 = fx(orig.x2); q.y2 = fy(orig.y2);
        break;
      default:
        q.x = fx(orig.x); q.y = fy(orig.y);
        if (orig.r) q.r = Math.max(orig.r * Math.min(sx, sy), 0.2);
    }
    return q;
  }

  /* ============================================================
     Pointer down
     ============================================================ */
  function onPointerDown(ev) {
    if (ev.button === 1 || S.tool === 'pan' || spaceHeld) return beginPan(ev);
    if (ev.button !== 0) return;

    svg.setPointerCapture(ev.pointerId);
    const w = R().eventWorld(ev);

    /* --- resize / rotate / vertex handles --- */
    const handleEl = ev.target.closest('[data-handle]');
    if (handleEl && S.tool === 'select') {
      const code = handleEl.getAttribute('data-handle');
      const id = handleEl.getAttribute('data-el');
      return beginHandle(ev, code, id, w);
    }

    /* --- drawing tools --- */
    if (S.tool === 'draw')    return beginDrawRect(ev, w);
    if (S.tool === 'line')    return beginDrawLine(ev, w);
    if (S.tool === 'poly')    return polyClick(w, ev);
    if (S.tool === 'marker')  return placeMarker(w);
    if (S.tool === 'text')    return placeText(w);
    if (S.tool === 'measure') return beginMeasure(ev, w);
    if (S.tool === 'calibrate') return beginCalibrate(ev, w);

    /* --- select / move ---
       Resolve through hitAt rather than the DOM target: the topmost SVG
       node is not always the element the user meant to grab. */
    const el = hitAt(w.x, w.y);

    if (!el) {
      if (!ev.shiftKey) FP.select([]);
      S.drag = { kind: 'marquee', x1: w.x, y1: w.y, additive: ev.shiftKey };
      S.draft = { type: 'marquee', rect: { x: w.x, y: w.y, w: 0, h: 0 } };
      return;
    }

    if (ev.shiftKey) {
      FP.select([el.id], true);
      return;
    }
    if (!FP.isSelected(el.id)) FP.select([el.id]);

    beginMove(ev, w, el);
  }

  /* ---------------- pan ---------------- */
  function beginPan(ev) {
    svg.setPointerCapture(ev.pointerId);
    svg.classList.add('panning');
    S.drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, vx: S.view.x, vy: S.view.y };
  }

  /* ---------------- move ---------------- */
  function beginMove(ev, w, el) {
    const sel = FP.selected().filter((e) => !FP.isLocked(e));
    if (!sel.length) return;
    S.drag = {
      kind: 'move',
      x0: w.x, y0: w.y,
      moved: false,
      alt: ev.altKey,
      items: sel.map((e) => ({ el: e, geom: FP.clone(e.geometry) })),
      /* contents ride along with their footprint */
      riders: sel.flatMap((e) =>
        C.flag(e.kind, 'sellable')
          ? FP.childrenOf(e.id).map((ch) => ({ el: ch, geom: FP.clone(ch.geometry) }))
          : []),
      anchor: G.bbox(el),
    };
  }

  /* ---------------- handles ---------------- */
  function beginHandle(ev, code, id, w) {
    const el = FP.get(id) || FP.selected()[0];
    if (!el) return;
    const sel = FP.selected().filter((e) => !FP.isLocked(e));

    if (code === 'rot') {
      const c = G.center(el);
      S.drag = {
        kind: 'rotate', el, c,
        start: Math.atan2(w.y - c.y, w.x - c.x),
        rot0: el.geometry.rot || 0,
      };
      return;
    }
    if (code.startsWith('pt') || code === 'p1' || code === 'p2') {
      const index = code === 'p1' ? 0 : code === 'p2' ? 1 : Number(code.slice(2));
      S.drag = { kind: 'vertex', el, index, geom: FP.clone(el.geometry) };
      return;
    }

    /* multi-select scales the whole bounding box */
    if (sel.length > 1) {
      const box = G.bboxOfMany(sel);
      S.drag = {
        kind: 'scale', code, box,
        items: sel.map((e) => ({ el: e, geom: FP.clone(e.geometry) })),
      };
      return;
    }
    S.drag = { kind: 'resize', el, code, geom: FP.clone(el.geometry) };
  }

  /* ---------------- draw ---------------- */
  function beginDrawRect(ev, w) {
    const p = snapPt(w);
    S.drag = { kind: 'draw', shape: 'rect', x1: p.x, y1: p.y };
    S.draft = { type: 'rect', rect: { x: p.x, y: p.y, w: 0, h: 0 } };
  }

  function beginDrawLine(ev, w) {
    const p = snapPt(w);
    S.drag = { kind: 'draw', shape: 'line', x1: p.x, y1: p.y };
    S.draft = { type: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  }

  function beginMeasure(ev, w) {
    const p = snapPt(w);
    S.drag = { kind: 'measure', x1: p.x, y1: p.y };
    S.draft = { type: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  }

  /* Calibration traces a distance across the imported drawing whose real
     length you know. Never snapped — you are measuring the image, not
     the grid, and the whole point is that the grid is not yet right. */
  function beginCalibrate(ev, w) {
    S.drag = { kind: 'calibrate', x1: w.x, y1: w.y };
    S.draft = { type: 'line', x1: w.x, y1: w.y, x2: w.x, y2: w.y, calibrate: true };
  }

  function polyClick(w, ev) {
    const p = snapPt(w);
    if (!S.draft || S.draft.type !== 'poly') {
      S.draft = { type: 'poly', pts: [[p.x, p.y]], cursor: [p.x, p.y] };
    } else {
      const first = S.draft.pts[0];
      const near = Math.hypot(p.x - first[0], p.y - first[1]) < 8 / S.view.zoom;
      if (near && S.draft.pts.length >= 3) return finishPoly();
      S.draft.pts.push([p.x, p.y]);
    }
    R().draw();
  }

  function finishPoly() {
    const d = S.draft;
    S.draft = null;
    if (!d || d.type !== 'poly' || d.pts.length < 3) { R().draw(); return; }
    const el = FP.makeElement(armedKindId(), { pts: d.pts }, parentForNew());
    FP.addElements(el);
    afterCreate();
  }

  function placeMarker(w) {
    const p = snapPt(w);
    const el = FP.makeElement(armedKindId(), { x: p.x, y: p.y }, parentForNew());
    FP.addElements(el);
    afterCreate();
  }

  function placeText(w) {
    const p = snapPt(w);
    const el = FP.makeElement('text', { x: p.x, y: p.y }, parentForNew());
    FP.addElements(el);
    afterCreate();
    FP.emit('edit-text', el.id);
  }

  /** Drawing tools stay armed while Alt is held, otherwise drop to select. */
  function afterCreate(keep = false) {
    if (!keep) setTool('select');
    else R().draw();
  }

  /* ============================================================
     Pointer move
     ============================================================ */
  function onPointerMove(ev) {
    const w = R().eventWorld(ev);
    FP.emit('cursor', w);

    const d = S.drag;
    if (!d) {
      if (S.draft && S.draft.type === 'poly') {
        const p = snapPt(w);
        S.draft.cursor = [p.x, p.y];
        R().draw();
      }
      return;
    }

    switch (d.kind) {
      case 'pan': {
        S.view.x = d.vx - (ev.clientX - d.sx) / S.view.zoom;
        S.view.y = d.vy - (ev.clientY - d.sy) / S.view.zoom;
        S.viewTouched = true;
        break;
      }

      case 'marquee': {
        d.x2 = w.x; d.y2 = w.y;
        S.draft = { type: 'marquee', rect: { x: d.x1, y: d.y1, w: w.x - d.x1, h: w.y - d.y1 } };
        break;
      }

      case 'move': {
        let dx = w.x - d.x0;
        let dy = w.y - d.y0;
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        if (S.snap) {
          /* snap the dragged element's own edge to the grid, not the cursor */
          dx = G.snap(d.anchor.x + dx, step()) - d.anchor.x;
          dy = G.snap(d.anchor.y + dy, step()) - d.anchor.y;
        }
        if (!d.moved && (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6)) {
          FP.snapshot();
          d.moved = true;
        }
        [...d.items, ...d.riders].forEach(({ el, geom }) => {
          el.geometry = G.translate(geom, el.shape, dx, dy);
        });
        break;
      }

      case 'resize': {
        if (!d.started) { FP.snapshot(); d.started = true; }
        d.el.geometry = resizeRect(d.el, d.geom, d.code, w,
          { free: ev.altKey, ratio: ev.shiftKey });
        break;
      }

      case 'scale': {
        if (!d.started) { FP.snapshot(); d.started = true; }
        const b = d.box;
        const ax = d.code.includes('w') ? b.x + b.w : b.x;
        const ay = d.code.includes('n') ? b.y + b.h : b.y;
        let sx = d.code.includes('w') || d.code.includes('e')
          ? (snapV(w.x, ev.altKey) - ax) / ((d.code.includes('w') ? b.x : b.x + b.w) - ax) : 1;
        let sy = d.code.includes('n') || d.code.includes('s')
          ? (snapV(w.y, ev.altKey) - ay) / ((d.code.includes('n') ? b.y : b.y + b.h) - ay) : 1;
        if (!isFinite(sx) || sx === 0) sx = 1;
        if (!isFinite(sy) || sy === 0) sy = 1;
        if (ev.shiftKey) { const s = Math.min(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx) * s; sy = Math.sign(sy) * s; }
        d.items.forEach(({ el, geom }) => { el.geometry = scaleGeometry(el, geom, ax, ay, sx, sy); });
        break;
      }

      case 'rotate': {
        if (!d.started) { FP.snapshot(); d.started = true; }
        const a = Math.atan2(w.y - d.c.y, w.x - d.c.x);
        let deg = d.rot0 + ((a - d.start) * 180) / Math.PI;
        deg = ev.shiftKey ? Math.round(deg / 45) * 45 : Math.round(deg);
        d.el.geometry.rot = ((deg % 360) + 360) % 360;
        break;
      }

      case 'vertex': {
        if (!d.started) { FP.snapshot(); d.started = true; }
        const p = snapPt(w, ev.altKey);
        if (d.el.shape === 'poly') {
          const pts = d.geom.pts.map((pt, i) => (i === d.index ? [p.x, p.y] : pt));
          d.el.geometry = { ...d.geom, pts };
        } else {
          d.el.geometry = d.index === 0
            ? { ...d.geom, x1: p.x, y1: p.y }
            : { ...d.geom, x2: p.x, y2: p.y };
        }
        break;
      }

      case 'draw': {
        const p = snapPt(w);
        if (d.shape === 'rect') {
          let dw = p.x - d.x1, dh = p.y - d.y1;
          if (ev.shiftKey) { const s = Math.max(Math.abs(dw), Math.abs(dh)); dw = Math.sign(dw || 1) * s; dh = Math.sign(dh || 1) * s; }
          S.draft = { type: 'rect', kind: armedKindId(), rect: { x: d.x1, y: d.y1, w: dw, h: dh } };
        } else {
          let { x, y } = p;
          if (ev.shiftKey) ({ x, y } = axisLock(d.x1, d.y1, x, y));
          S.draft = { type: 'line', kind: armedKindId(), x1: d.x1, y1: d.y1, x2: x, y2: y };
        }
        break;
      }

      case 'measure': {
        const p = snapPt(w);
        S.draft = { type: 'line', x1: d.x1, y1: d.y1, x2: p.x, y2: p.y };
        break;
      }

      case 'calibrate': {
        const p = ev.shiftKey ? axisLock(d.x1, d.y1, w.x, w.y) : w;
        S.draft = { type: 'line', x1: d.x1, y1: d.y1, x2: p.x, y2: p.y, calibrate: true };
        break;
      }
    }

    R().draw();
  }

  /** Constrain a segment to 0/45/90 degrees. */
  function axisLock(x1, y1, x, y) {
    const dx = x - x1, dy = y - y1;
    const a = Math.atan2(dy, dx);
    const snapped = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return { x: x1 + Math.cos(snapped) * len, y: y1 + Math.sin(snapped) * len };
  }

  /* ============================================================
     Pointer up
     ============================================================ */
  function onPointerUp(ev) {
    const d = S.drag;
    svg.classList.remove('panning');
    if (!d) return;
    S.drag = null;

    switch (d.kind) {
      case 'marquee': {
        const r = G.normalizeRect({ x: d.x1, y: d.y1, w: (d.x2 ?? d.x1) - d.x1, h: (d.y2 ?? d.y1) - d.y1 });
        S.draft = null;
        if (r.w > 0.2 || r.h > 0.2) {
          const hits = pickable().filter((e) => G.rectsIntersect(r, G.bbox(e))).map((e) => e.id);
          FP.select(hits, d.additive);
        }
        break;
      }

      case 'move': {
        if (d.moved) FP.changed();
        else FP.emit('change');
        break;
      }

      case 'resize':
      case 'scale':
      case 'rotate':
      case 'vertex':
        if (d.started) FP.changed();
        break;

      case 'draw': {
        S.draft = null;
        const kindId = armedKindId();
        const k = C.kind(kindId);

        if (d.shape === 'rect') {
          const w = R().eventWorld(ev);
          const p = snapPt(w);
          let r = G.normalizeRect({ x: d.x1, y: d.y1, w: p.x - d.x1, h: p.y - d.y1 });
          /* a click rather than a drag places the default footprint */
          if (r.w < 0.5 || r.h < 0.5) {
            const size = S.armedSize || k.size || [10, 10];
            r = { x: d.x1, y: d.y1, w: size[0], h: size[1] };
          }
          const el = FP.makeElement(kindId, { x: r.x, y: r.y, w: r.w, h: r.h }, parentForNew());
          if (S.armedSize && k.fields?.some((f) => f.key === 'spaceType') && S.armedSpaceType) {
            el.props.spaceType = S.armedSpaceType;
          }
          FP.addElements(el);
        } else {
          const w = R().eventWorld(ev);
          let p = snapPt(w);
          if (ev.shiftKey) p = axisLock(d.x1, d.y1, p.x, p.y);
          if (Math.hypot(p.x - d.x1, p.y - d.y1) < 0.4) break;
          const el = FP.makeElement(kindId,
            { x1: d.x1, y1: d.y1, x2: p.x, y2: p.y }, parentForNew());
          FP.addElements(el);
        }
        afterCreate(ev.altKey);
        return;
      }

      case 'measure':
        /* leave the draft on screen until the next action */
        break;

      case 'calibrate': {
        const line = S.draft;
        S.draft = null;
        const len = line ? Math.hypot(line.x2 - line.x1, line.y2 - line.y1) : 0;
        if (len < 0.5) { FP.toast?.('Drag across a known dimension', true); break; }
        /* The UI asks for the real length and applies the scale. */
        FP.emit('calibrate-line', { x: line.x1, y: line.y1, drawn: len });
        break;
      }
    }

    R().draw();
  }

  /* ============================================================
     Wheel / double click
     ============================================================ */
  function onWheel(ev) {
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;

    if (ev.ctrlKey || ev.metaKey || !ev.shiftKey) {
      const factor = Math.pow(0.998, ev.deltaY);
      R().zoomAt(factor, px, py);
    } else {
      S.view.x += ev.deltaX / S.view.zoom;
      S.view.y += ev.deltaY / S.view.zoom;
      R().draw();
    }
  }

  function onDoubleClick(ev) {
    const w = R().eventWorld(ev);
    const target = ev.target.closest('[data-id]');
    const el = target ? FP.get(target.getAttribute('data-id')) : hitAt(w.x, w.y);
    if (!el) {
      if (S.scope.type === 'booth') FP.exitScope();
      return;
    }
    if (el.shape === 'text') return FP.emit('edit-text', el.id);
    if (C.flag(el.kind, 'sellable') && S.scope.type === 'hall') {
      FP.enterScope(el.id);
      R().fit();
    }
  }

  /* ============================================================
     Keyboard
     ============================================================ */
  const TOOL_KEYS = {
    v: () => setTool('select'),
    b: () => setTool('draw', 'space'),
    w: () => setTool('line', 'wall'),
    d: () => setTool('draw', 'dead-space'),
    x: () => setTool('draw', 'fire-exit'),
    a: () => setTool('draw', 'aisle'),
    t: () => setTool('text', 'text'),
    p: () => setTool('poly', 'dead-space-poly'),
    m: () => setTool('measure'),
    h: () => setTool('pan'),
  };

  function onKeyDown(ev) {
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || ev.target.isContentEditable) {
      if (ev.key === 'Escape') ev.target.blur();
      return;
    }

    const mod = ev.metaKey || ev.ctrlKey;
    const key = ev.key;

    if (key === ' ' && !spaceHeld) { spaceHeld = true; updateCursor(); return; }

    if (mod) {
      switch (key.toLowerCase()) {
        case 'z': ev.preventDefault(); ev.shiftKey ? FP.redo() : FP.undo(); R().draw(); return;
        case 'y': ev.preventDefault(); FP.redo(); R().draw(); return;
        case 'c': ev.preventDefault(); FP.copy(); FP.toast?.('Copied'); return;
        case 'x': ev.preventDefault(); FP.cut(); R().draw(); return;
        case 'v': ev.preventDefault(); FP.paste(); R().draw(); return;
        case 'd': ev.preventDefault(); FP.duplicateSelected(); R().draw(); return;
        case 'a': ev.preventDefault(); FP.selectAll(); R().draw(); return;
        case 's': ev.preventDefault(); FP.save(); FP.toast?.('Saved'); return;
        case '=': case '+': ev.preventDefault(); R().zoomAt(1.2, ...center()); return;
        case '-': ev.preventDefault(); R().zoomAt(1 / 1.2, ...center()); return;
        case '0': ev.preventDefault(); R().fit(); return;
        case ']': ev.preventDefault(); FP.setZ('front'); R().draw(); return;
        case '[': ev.preventDefault(); FP.setZ('back'); R().draw(); return;
      }
      return;
    }

    switch (key) {
      case 'Escape':
        if (S.draft) { S.draft = null; R().draw(); }
        else if (S.tool !== 'select') setTool('select');
        else if (S.scope.type === 'booth') FP.exitScope();
        else FP.select([]);
        return;

      case 'Enter':
        if (S.draft?.type === 'poly') { ev.preventDefault(); finishPoly(); }
        else if (FP.selected().length === 1) {
          const el = FP.selected()[0];
          if (C.flag(el.kind, 'sellable') && S.scope.type === 'hall') { FP.enterScope(el.id); R().fit(); }
        }
        return;

      case 'Backspace':
        if (S.draft?.type === 'poly' && S.draft.pts.length) {
          ev.preventDefault();
          S.draft.pts.pop();
          if (!S.draft.pts.length) S.draft = null;
          R().draw();
          return;
        }
      /* falls through to delete */
      case 'Delete': {
        ev.preventDefault();
        const n = FP.removeSelected();
        if (n) FP.toast?.(`Deleted ${n} element${n === 1 ? '' : 's'}`);
        R().draw();
        return;
      }

      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
        const sel = FP.selected().filter((e) => !FP.isLocked(e));
        if (!sel.length) return;
        ev.preventDefault();
        const base = S.snap ? step() : 1;
        const amt = ev.shiftKey ? base * 5 : base;
        const dx = key === 'ArrowLeft' ? -amt : key === 'ArrowRight' ? amt : 0;
        const dy = key === 'ArrowUp' ? -amt : key === 'ArrowDown' ? amt : 0;
        FP.snapshot();
        sel.forEach((el) => FP.moveElementDeep(el, dx, dy));
        FP.changed();
        R().draw();
        return;
      }

      case 'g': S.showGrid = !S.showGrid; FP.emit('tool'); R().draw(); return;
      case 's': S.snap = !S.snap; FP.emit('tool'); return;
      case 'l': S.showLabels = !S.showLabels; FP.emit('tool'); R().draw(); return;
      case 'f': R().fit(); return;
      case '?': FP.emit('show-help'); return;
    }

    const fn = TOOL_KEYS[key.toLowerCase()];
    if (fn) fn();
  }

  function center() {
    const { w, h } = R().size();
    return [w / 2, h / 2];
  }

  function onKeyUp(ev) {
    if (ev.key === ' ') { spaceHeld = false; updateCursor(); }
  }

  /* ============================================================
     Init
     ============================================================ */
  /* ============================================================
     Authoring operations exposed to the UI layer.
     ============================================================ */
  const I = (FP.interact = {});

  I.setTool = setTool;

  /** Arm a kind for placement, choosing the tool from its shape. */
  I.armKind = (kindId, size = null, spaceType = null) => {
    const k = C.kind(kindId);
    const tool = { rect: 'draw', poly: 'poly', line: 'line',
                   marker: 'marker', text: 'text' }[k.shape] || 'draw';
    setTool(tool, kindId);
    S.armedSize = size;
    S.armedSpaceType = spaceType;
    FP.emit('tool');
  };

  I.align = (mode) => {
    const sel = FP.selected().filter((e) => !FP.isLocked(e));
    if (sel.length < 2) return;
    const box = G.bboxOfMany(sel);
    FP.snapshot();
    for (const el of sel) {
      const b = G.bbox(el);
      let dx = 0, dy = 0;
      switch (mode) {
        case 'left':    dx = box.x - b.x; break;
        case 'right':   dx = box.x + box.w - (b.x + b.w); break;
        case 'top':     dy = box.y - b.y; break;
        case 'bottom':  dy = box.y + box.h - (b.y + b.h); break;
        case 'hcenter': dx = box.x + box.w / 2 - (b.x + b.w / 2); break;
        case 'vcenter': dy = box.y + box.h / 2 - (b.y + b.h / 2); break;
      }
      if (dx || dy) FP.moveElementDeep(el, dx, dy);
    }
    FP.changed();
    R().draw();
  };

  I.distribute = (axis) => {
    const sel = FP.selected().filter((e) => !FP.isLocked(e));
    if (sel.length < 3) return;
    const key = axis === 'h' ? 'x' : 'y';
    const dim = axis === 'h' ? 'w' : 'h';
    const items = sel.map((el) => ({ el, b: G.bbox(el) })).sort((a, b) => a.b[key] - b.b[key]);
    const first = items[0].b, last = items[items.length - 1].b;
    const span = (last[key] + last[dim]) - first[key];
    const used = items.reduce((s, o) => s + o.b[dim], 0);
    const gap = (span - used) / (items.length - 1);

    FP.snapshot();
    let cursor = first[key];
    for (const o of items) {
      const delta = cursor - o.b[key];
      if (delta) FP.moveElementDeep(o.el, axis === 'h' ? delta : 0, axis === 'h' ? 0 : delta);
      cursor += o.b[dim] + gap;
    }
    FP.changed();
    R().draw();
  };

  /**
   * Lay out a block of spaces. Rows are placed back-to-back in pairs with
   * an aisle between each pair, which is how show floors are actually
   * built — this is the most-used authoring action, so it is first-class
   * rather than repeated copy-paste.
   */
  I.generateBlock = ({ cols, rows, w, h, aisle = 10, gap = 0,
                       startX = 0, startY = 0, spaceType = 'inline', prefix = '' }) => {
    const els = [];
    for (let r = 0; r < rows; r++) {
      const pair = Math.floor(r / 2);
      const y = startY + pair * (h * 2 + aisle) + (r % 2) * h;
      for (let c = 0; c < cols; c++) {
        const el = FP.makeElement('space', {
          x: startX + c * (w + gap), y, w, h, rot: 0,
        }, null);
        el.props.spaceType = spaceType;
        if (prefix) el.props.number = `${prefix}${el.props.number}`;
        els.push(el);
      }
    }
    if (els.length) FP.addElements(els);
    return els;
  };

  /**
   * Aisle numbering — the convention actually used on the floor.
   *
   * On a real plan the number encodes WHERE the booth is, not the order it
   * was drawn: the hundreds digit is the aisle, and the last two digits
   * run along it, odd down one side and even down the other. So 600, 602,
   * 604 face 501, 503, 505 across a 10 ft aisle, and a crew member reading
   * "607" knows the aisle and the side before they look up.
   *
   * Booths are grouped into rows by their back edge, rows are paired into
   * aisles, and each pair gets one hundred-block.
   *
   * @param {object} opts
   *   startAisle  first hundred-block (1 -> 100s)
   *   step        gap between consecutive booths on a side
   *   evenSide    'north' | 'south' — which side takes the even numbers
   */
  I.aisleNumber = ({ startAisle = 1, step = 2, evenSide = 'far' } = {}) => {
    const spaces = FP.spaces();
    if (!spaces.length) return 0;

    /* Group booths into rows by their leading edge. */
    const tol = 2;
    const rows = [];
    spaces
      .map((el) => ({ el, b: G.bbox(el) }))
      .sort((a, b) => a.b.y - b.b.y)
      .forEach((item) => {
        const row = rows.find((r) => Math.abs(r.y - item.b.y) <= tol);
        if (row) { row.items.push(item); row.bottom = Math.max(row.bottom, item.b.y + item.b.h); }
        else rows.push({ y: item.b.y, bottom: item.b.y + item.b.h, items: [item] });
      });
    rows.sort((a, b) => a.y - b.y);

    /* Two rows share a hundred-block when they FACE EACH OTHER across an
       aisle. Rows that touch are back-to-back: they face opposite ways, so
       they belong to different aisles and must not be paired. */
    FP.snapshot();
    let aisle = startAisle;
    const used = new Set();

    for (let i = 0; i < rows.length; i += 1) {
      if (used.has(i)) continue;
      const a = rows[i];
      const b = rows[i + 1];
      const gap = b ? b.y - a.bottom : Infinity;
      const facing = b && gap > tol;      /* a real aisle between them */

      const hundreds = aisle * 100;
      const assign = (row, odd) => {
        if (!row) return;
        row.items.sort((p, q) => p.b.x - q.b.x).forEach((it, n) => {
          it.el.props.number = String(hundreds + (odd ? 1 : 0) + n * step);
        });
      };

      if (facing) {
        /* The far side of the aisle takes the even numbers by default. */
        const nearIsOdd = evenSide === 'far';
        assign(a, nearIsOdd);
        assign(b, !nearIsOdd);
        used.add(i + 1);
      } else {
        /* An edge row with no facing partner still gets its own aisle. */
        assign(a, false);
      }
      aisle += 1;
    }

    FP.plan.nextSpaceNo = aisle * 100;
    FP.changed();
    R().draw();
    return spaces.length;
  };

  /** Renumber every space in reading order so the manifest matches the floor. */
  I.autoNumber = (start = 101, stepBy = 1, prefix = '') => {
    const rowTol = 2;
    const spaces = FP.spaces()
      .map((el) => ({ el, b: G.bbox(el) }))
      .sort((a, b) => (Math.abs(a.b.y - b.b.y) <= rowTol ? a.b.x - b.b.x : a.b.y - b.b.y));
    if (!spaces.length) return 0;

    FP.snapshot();
    let no = start;
    for (const { el } of spaces) {
      el.props.number = `${prefix}${no}`;
      no += stepBy;
    }
    FP.plan.nextSpaceNo = no;
    FP.changed();
    R().draw();
    return spaces.length;
  };

  /* ============================================================
     Electrical buses.

     Floor power runs on buses spaced at the module the whole floor is
     built on: 10 ft booth + 10 ft aisle + 10 ft booth = 30 ft. Put the
     buses on that pitch and every booth backs onto one, so no drop has to
     cross an aisle — which is the thing you cannot do, because a cable
     across an aisle is a trip hazard and a fire-marshal conversation.

     Generating them from the module rather than by eye means the spacing
     is right by construction, and re-running it after the floor changes
     is one click instead of redrawing by hand.
     ============================================================ */
  I.BUS_MODULE = 30;

  /**
   * Lay bus runs across the hall on the 30 ft module.
   * @param {object} opts
   *   axis     'h' | 'v'  direction the buses run
   *   spacing  centre-to-centre, defaults to the 30 ft module
   *   offset   distance from the hall edge to the first bus
   *   panelId  board the runs are fed from
   *   gauge, amps
   */
  I.generateBuses = ({ axis = 'h', spacing = I.BUS_MODULE, offset = 15,
                       panelId = 'MDP-1', gauge = '2', amps = 100 } = {}) => {
    const p = FP.plan;
    const span = axis === 'h' ? p.height : p.width;
    const across = axis === 'h' ? p.width : p.height;
    const els = [];

    let n = 1;
    for (let d = offset; d <= span - 1; d += spacing) {
      const geom = axis === 'h'
        ? { x1: 0, y1: d, x2: across, y2: d }
        : { x1: d, y1: 0, x2: d, y2: across };
      const el = FP.makeElement('electrical-run', geom, null);
      Object.assign(el.props, {
        circuitId: `BUS-${n}`, panelId, gauge, amps,
        voltage: '208', method: 'floor',
        label: `Bus ${n} — ${spacing} ft module`,
      });
      els.push(el);
      n += 1;
    }
    if (els.length) FP.addElements(els);
    return els;
  };

  /**
   * Distance from each space to the nearest bus. Anything beyond half the
   * module is, by definition, on the wrong side of an aisle.
   */
  I.busReach = () => {
    const buses = FP.plan.elements.filter(
      (e) => C.flag(e.kind, 'cableRun') && !e.parentId);
    if (!buses.length) return [];
    return FP.spaces().map((sp) => {
      let best = Infinity;
      for (const bus of buses) best = Math.min(best, G.gapBetween(sp, bus));
      return { space: sp, distance: best };
    });
  };

  FP.initInteractions = (el) => {
    svg = el;
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);
    svg.addEventListener('dblclick', onDoubleClick);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    updateCursor();
  };
})(window);
