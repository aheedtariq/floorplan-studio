/* ============================================================
   render.js — SVG renderer.

   One pass rebuilds the whole scene into innerHTML. That keeps the draw
   path stateless and cheap to reason about; at a few hundred elements it
   costs a few milliseconds, and every redraw is rAF-coalesced.

   The same renderer draws the hall and a single booth interior — booth
   scope just changes which elements are in scope and clips to the
   footprint. World units are feet (or metres); view.zoom is px per unit.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});
  const G = FP.geo;
  const C = FP.config;
  const NS = 'http://www.w3.org/2000/svg';

  const R = (FP.render = {});
  let svg = null;
  let frame = null;

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const n = (v) => (Math.round(v * 1000) / 1000);

  /* ---------------- view maths ---------------- */

  R.size = () => ({
    w: svg?.clientWidth || 800,
    h: svg?.clientHeight || 600,
  });

  R.toWorld = (px, py) => {
    const v = FP.state.view;
    return { x: v.x + px / v.zoom, y: v.y + py / v.zoom };
  };

  R.toScreen = (wx, wy) => {
    const v = FP.state.view;
    return { x: (wx - v.x) * v.zoom, y: (wy - v.y) * v.zoom };
  };

  /** Pointer event -> world coordinates. */
  R.eventWorld = (ev) => {
    const r = svg.getBoundingClientRect();
    return R.toWorld(ev.clientX - r.left, ev.clientY - r.top);
  };

  R.zoomAt = (factor, px, py) => {
    const v = FP.state.view;
    const before = R.toWorld(px, py);
    v.zoom = G.clamp(v.zoom * factor, 0.35, 60);
    const after = R.toWorld(px, py);
    v.x += before.x - after.x;
    v.y += before.y - after.y;
    FP.state.viewTouched = true;
    R.draw();
  };

  R.setZoom = (z, aroundCenter = true) => {
    const { w, h } = R.size();
    const v = FP.state.view;
    R.zoomAt(G.clamp(z, 0.35, 60) / v.zoom, aroundCenter ? w / 2 : 0, aroundCenter ? h / 2 : 0);
  };

  /** Fit a world-space box (defaults to the hall, or the booth in scope). */
  R.fit = (box, pad = 40) => {
    const { w, h } = R.size();
    const v = FP.state.view;
    if (!box) {
      const sp = FP.scopeSpace();
      box = sp ? G.bbox(sp) : { x: 0, y: 0, w: FP.plan.width, h: FP.plan.height };
    }
    if (!box.w || !box.h) return;
    v.zoom = G.clamp(Math.min((w - pad * 2) / box.w, (h - pad * 2) / box.h), 0.35, 60);
    v.x = box.x + box.w / 2 - w / (2 * v.zoom);
    v.y = box.y + box.h / 2 - h / (2 * v.zoom);
    /* Fitting hands the view back to automatic sizing on resize. */
    FP.state.viewTouched = false;
    R.draw();
  };

  R.centerOn = (box) => {
    const { w, h } = R.size();
    const v = FP.state.view;
    v.x = box.x + box.w / 2 - w / (2 * v.zoom);
    v.y = box.y + box.h / 2 - h / (2 * v.zoom);
    FP.state.viewTouched = true;
    R.draw();
  };

  /* ---------------- init ---------------- */

  R.init = (el) => {
    svg = el;
    /* The pane is usually resized once just after load, before the first
       fit could measure it. Keep re-fitting until the user takes the view
       over by zooming or panning; Fit hands control back. */
    new ResizeObserver(() => (FP.state.viewTouched ? R.draw() : R.fit()))
      .observe(svg.parentElement || svg);
  };

  R.draw = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      paint();
    });
  };

  /* ---------------- defs ---------------- */

  function defs() {
    const grid = FP.plan.grid || 5;
    const major = grid * 5;
    return `<defs>
      <pattern id="pg-minor" width="${grid}" height="${grid}" patternUnits="userSpaceOnUse">
        <path d="M ${grid} 0 L 0 0 0 ${grid}" fill="none"
              stroke="var(--grid-minor)" stroke-width="1" vector-effect="non-scaling-stroke"/>
      </pattern>
      <pattern id="pg-major" width="${major}" height="${major}" patternUnits="userSpaceOnUse">
        <rect width="${major}" height="${major}" fill="url(#pg-minor)"/>
        <path d="M ${major} 0 L 0 0 0 ${major}" fill="none"
              stroke="var(--grid-major)" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
      </pattern>
      <pattern id="hatch-diag" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="2.4" stroke="#64748b" stroke-width="0.9" opacity=".55"/>
      </pattern>
      <pattern id="hatch-diag-red" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="2.4" stroke="#ef4444" stroke-width="0.9" opacity=".5"/>
      </pattern>
      <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/>
      </marker>
    </defs>`;
  }

  /* ---------------- element drawing ---------------- */

  function fillFor(el, k) {
    if (k.hatch) return `url(#hatch-${k.hatch})`;
    return el.props.color || k.fill;
  }

  /* Null when the element carries no status at all — the public document
     strips status deliberately, and those spaces colour from props.color
     instead of silently defaulting to the first workflow state. */
  /* How a space is coloured. Under the default 'status' mode this is the
     workflow colour; other modes derive it from the data — power ordered,
     tier, space type — which is what replaces highlighting booths by hand.
     Null means "no opinion", and the caller falls back to the kind. */
  function spaceColor(el, opts) {
    if (FP.state.colorBy && FP.state.colorBy !== 'status') {
      const hit = C.colorFor(el, FP.state.colorBy, opts?.amps?.[el.id] || 0);
      if (hit) return hit.color;
    }
    if (!el.props.status) return null;
    const s = C.status(el.props.status);
    return s ? s.color : null;
  }

  function drawElement(el, opts = {}) {
    const k = C.kind(el.kind);
    const q = el.geometry;
    const sel = FP.isSelected(el.id);
    const issue = opts.issues?.[el.id];
    const ghost = opts.ghost;

    const isSpace = C.flag(el.kind, 'sellable');
    const sc = isSpace ? spaceColor(el, opts) : null;
    const base = isSpace ? (sc || el.props.color || k.fill) : fillFor(el, k);
    const strokeCol = isSpace ? (sc || el.props.color || k.stroke) : (el.props.color || k.stroke);
    /* Ghosts were tuned against dark paper; on white they need more body. */
    const opacity = ghost ? 0.28 : (k.opacity ?? 0.9);

    const attrs = [
      `data-id="${el.id}"`,
      `class="el${sel ? ' sel' : ''}"`,
      ghost ? 'pointer-events="none"' : '',
    ].join(' ');

    const dash = k.dashed ? `stroke-dasharray="${n(2 / FP.state.view.zoom * 3)} ${n(2 / FP.state.view.zoom * 2)}"` : '';
    let out = '';

    switch (el.shape) {
      case 'rect': {
        const cx = q.x + q.w / 2, cy = q.y + q.h / 2;
        const rot = q.rot ? ` transform="rotate(${n(q.rot)} ${n(cx)} ${n(cy)})"` : '';
        out += `<g ${attrs}${rot}>`;

        /* Furniture draws its own outline — a round table is a circle, and
           a circle sitting inside a visible square reads as a wireframe,
           not a floor plan. Those kinds get an invisible rect purely so
           they stay clickable. */
        if (SELF_DRAWN.has(k.id)) {
          out += `<rect x="${n(q.x)}" y="${n(q.y)}" width="${n(q.w)}" height="${n(q.h)}"
                    fill="transparent" stroke="none"/>`;
        } else {
          out += `<rect x="${n(q.x)}" y="${n(q.y)}" width="${n(q.w)}" height="${n(q.h)}"
                    fill="${base}" fill-opacity="${opacity}" stroke="${strokeCol}"
                    stroke-width="1.6" vector-effect="non-scaling-stroke" ${dash}/>`;
        }

        out += symbolFor(el, k, q, opts);
        out += labelFor(el, k, q, opts);
        out += '</g>';
        break;
      }

      case 'poly': {
        if (!q.pts?.length) break;
        const pts = q.pts.map((p) => `${n(p[0])},${n(p[1])}`).join(' ');
        out += `<g ${attrs}>`;
        out += `<polygon points="${pts}" fill="${base}" fill-opacity="${opacity}"
                  stroke="${strokeCol}" stroke-width="1.6" vector-effect="non-scaling-stroke" ${dash}/>`;
        const b = G.polyBBox(q.pts);
        out += labelFor(el, k, b, opts);
        out += '</g>';
        break;
      }

      case 'line': {
        if (C.flag(el.kind, 'dimension')) { out += drawDimension(el, attrs, opts); break; }
        const arrow = C.flag(el.kind, 'arrow') ? ' marker-end="url(#arrowhead)"' : '';
        const t = Math.max(q.thickness || 0.5, 0.15);
        out += `<g ${attrs}>`;
        /* Invisible fat line keeps thin strokes clickable. */
        out += `<line x1="${n(q.x1)}" y1="${n(q.y1)}" x2="${n(q.x2)}" y2="${n(q.y2)}"
                  stroke="transparent" stroke-width="${n(Math.max(t, 8 / FP.state.view.zoom))}"/>`;
        out += `<line x1="${n(q.x1)}" y1="${n(q.y1)}" x2="${n(q.x2)}" y2="${n(q.y2)}"
                  stroke="${strokeCol}" stroke-opacity="${ghost ? 0.2 : (k.opacity ?? 1)}" stroke-width="${n(t)}"
                  stroke-linecap="round"${arrow} ${dash}/>`;
        out += '</g>';
        break;
      }

      case 'marker': {
        /* Markers are symbols, not footprints: hold them to a readable
           screen size instead of scaling all the way in and out. */
        const zm = FP.state.view.zoom;
        const r = G.clamp(q.r || 1.2, 3.5 / zm, 14 / zm);
        out += `<g ${attrs}>`;
        out += `<circle cx="${n(q.x)}" cy="${n(q.y)}" r="${n(r * 1.55)}" fill="${k.fill}" fill-opacity=".18"/>`;
        out += `<circle cx="${n(q.x)}" cy="${n(q.y)}" r="${n(r)}" fill="${k.fill}"
                  stroke="${k.stroke}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
        if (k.icon && r * FP.state.view.zoom > 9) {
          const s = (r * 1.5) / 24;
          out += `<g transform="translate(${n(q.x - r * 0.75)} ${n(q.y - r * 0.75)}) scale(${n(s)})"
                    fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"
                    stroke-linejoin="round" pointer-events="none">${k.icon}</g>`;
        }
        out += '</g>';
        break;
      }

      case 'text': {
        const fs = Number(el.props.fontSize) || 4;
        const rot = q.rot ? ` transform="rotate(${n(q.rot)} ${n(q.x)} ${n(q.y)})"` : '';
        out += `<g ${attrs}${rot}>`;
        out += `<text x="${n(q.x)}" y="${n(q.y)}" font-size="${n(fs)}"
                  fill="${el.props.color || 'var(--ink)'}" font-weight="600"
                  font-family="var(--font)" style="paint-order:stroke"
                  stroke="var(--paper)" stroke-width="${n(fs * 0.14)}"
                  >${esc(el.props.text || 'Label')}</text>`;
        out += '</g>';
        break;
      }
    }

    if (issue && !ghost) out += issueBadge(el, issue);
    return out;
  }

  /* Dimension lines get witness ticks and a measured length. */
  function drawDimension(el, attrs, opts) {
    const q = el.geometry;
    const col = el.props.color || C.kind(el.kind).stroke;
    const len = Math.hypot(q.x2 - q.x1, q.y2 - q.y1);
    const ang = Math.atan2(q.y2 - q.y1, q.x2 - q.x1);
    const tick = 4 / FP.state.view.zoom;
    const nx = -Math.sin(ang) * tick, ny = Math.cos(ang) * tick;
    const mx = (q.x1 + q.x2) / 2, my = (q.y1 + q.y2) / 2;
    const fs = G.clamp(12 / FP.state.view.zoom, 0.8, 6);
    let deg = (ang * 180) / Math.PI;
    if (deg > 90 || deg < -90) deg += 180;

    return `<g ${attrs}>
      <line x1="${n(q.x1)}" y1="${n(q.y1)}" x2="${n(q.x2)}" y2="${n(q.y2)}"
            stroke="transparent" stroke-width="${n(10 / FP.state.view.zoom)}"/>
      <line x1="${n(q.x1)}" y1="${n(q.y1)}" x2="${n(q.x2)}" y2="${n(q.y2)}"
            stroke="${col}" stroke-width="1.4" vector-effect="non-scaling-stroke"
            marker-start="url(#arrowhead)" marker-end="url(#arrowhead)"/>
      <line x1="${n(q.x1 + nx)}" y1="${n(q.y1 + ny)}" x2="${n(q.x1 - nx)}" y2="${n(q.y1 - ny)}"
            stroke="${col}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
      <line x1="${n(q.x2 + nx)}" y1="${n(q.y2 + ny)}" x2="${n(q.x2 - nx)}" y2="${n(q.y2 - ny)}"
            stroke="${col}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
      <text x="${n(mx)}" y="${n(my - fs * 0.4)}" font-size="${n(fs)}" fill="${col}"
            text-anchor="middle" font-weight="650" font-family="var(--font)"
            style="paint-order:stroke" stroke="var(--paper)" stroke-width="${n(fs * 0.28)}"
            transform="rotate(${n(deg)} ${n(mx)} ${n(my)})"
            pointer-events="none">${esc(G.fmtLen(len, opts.unit))}</text>
    </g>`;
  }

  /* ============================================================
     Element symbols

     A floor plan is read at a glance, so every element type gets its own
     mark rather than a coloured rectangle with a caption. Two tiers:

       1. Architectural symbols — doors draw their swing arc, stairs
          their treads, exits their egress arrow. These are real geometry
          in world units, oriented against the hall, the way a drafter
          would draw them.
       2. Pictograms — everything else centres its catalog glyph, scaled
          to the element and screen-clamped so it stays legible.

     Booths are deliberately excluded: their number and exhibitor are the
     content, and a glyph behind them is just noise.
     ============================================================ */

  const NO_SYMBOL = new Set(['text', 'dimension', 'arrow', 'wall',
                             'dead-space', 'dead-space-poly', 'zone']);

  const hasSymbol = (k) => !NO_SYMBOL.has(k.id) && !!k.icon;

  /** Which way is the middle of the hall from here? Drives door swings. */
  function inwardAxis(box) {
    const p = FP.plan;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const dx = p.width / 2 - cx, dy = p.height / 2 - cy;
    return Math.abs(dx) > Math.abs(dy)
      ? { ax: 'x', dir: Math.sign(dx) || 1 }
      : { ax: 'y', dir: Math.sign(dy) || 1 };
  }

  function symbolFor(el, k, box, opts) {
    if (opts.ghost || !hasSymbol(k)) return '';
    const zoom = FP.state.view.zoom;
    const wpx = box.w * zoom, hpx = box.h * zoom;

    const col = el.props.color || k.stroke;
    const custom = ARCH[k.id];

    /* Self-drawn kinds ARE the object, not decoration on top of one. The
       size gate below must never reach them: skipping a stool's circle
       would leave nothing on the plan at all, because the generic
       rectangle underneath was deliberately suppressed for it. */
    if (custom && SELF_DRAWN.has(k.id)) return custom(el, box, col, zoom);

    if (wpx < 22 || hpx < 14) return '';
    if (custom) return custom(el, box, col, zoom);

    /* Backdrop areas sit under the booths and are already named in their
       top-left corner. A glyph floating in the middle of one reads as a
       thing on the floor rather than a region of it. */
    if (C.flag(k.id, 'zone') || C.flag(k.id, 'keepClear') ||
        C.flag(k.id, 'riggingZone') || C.flag(k.id, 'unsellable')) return '';

    /* Pictogram: scale the 24×24 catalog glyph into the element. */
    let s = Math.min(box.w, box.h) * 0.44;
    const px = s * zoom;
    if (px < 11) return '';
    if (px > 46) s = 46 / zoom;

    const cx = box.x + box.w / 2;
    /* Sit above the caption when the box is tall enough to hold both. */
    const cy = box.y + box.h / 2 - (hpx > 46 ? s * 0.34 : 0);
    const scale = s / 24;

    return `<g transform="translate(${n(cx - s / 2)} ${n(cy - s / 2)}) scale(${n(scale)})"
        fill="none" stroke="${col}" stroke-opacity=".85" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round" pointer-events="none">${k.icon}</g>`;
  }

  /* ---------- architectural symbols, drawn to real geometry ---------- */
  /* Kinds whose ARCH entry paints the whole object, so the generic
     rectangle underneath is suppressed. */
  const SELF_DRAWN = new Set(['chair', 'stool', 'table', 'counter', 'display',
                              'monitor', 'shelf', 'column',
                              'electrical-panel', 'distro-box']);

  const ARCH = {
    /* ---- furniture, drawn the way a floor plan draws furniture ----

       Seating is a circle. A round table is a circle. A rectangular table
       has radiused corners. None of it is a hard-edged box, because on a
       real drawing a hard-edged box means built structure, and reading a
       stool as structure is exactly the confusion worth avoiding. */

    /* Stools and chairs: a plan circle, with a seat-back arc when the
       element is big enough for one to be legible. */
    chair(el, b, col, zoom) {
      const r = Math.min(b.w, b.h) / 2;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const showBack = r * zoom > 9;
      return `<g pointer-events="none">
        <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.86)}"
          fill="${col}" fill-opacity=".3" stroke="${col}" stroke-width="1.5"
          vector-effect="non-scaling-stroke"/>
        ${showBack ? `<path d="M ${n(cx - r * 0.6)} ${n(cy + r * 0.55)}
          A ${n(r * 0.75)} ${n(r * 0.75)} 0 0 0 ${n(cx + r * 0.6)} ${n(cy + r * 0.55)}"
          fill="none" stroke="${col}" stroke-width="1.6" stroke-linecap="round"
          vector-effect="non-scaling-stroke" opacity=".85"/>` : ''}
      </g>`;
    },

    /* A bar stool is a plain circle with a footring — no back, which is
       what distinguishes it from a chair at a glance. */
    stool(el, b, col, zoom) {
      const r = Math.min(b.w, b.h) / 2;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const ring = r * zoom > 7;
      return `<g pointer-events="none">
        <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.82)}"
          fill="${col}" fill-opacity=".32" stroke="${col}" stroke-width="1.5"
          vector-effect="non-scaling-stroke"/>
        ${ring ? `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.42)}"
          fill="none" stroke="${col}" stroke-width="1.2" opacity=".7"
          vector-effect="non-scaling-stroke"/>` : ''}
      </g>`;
    },

    /* A monitor is a screen on a stand: heavy face, short pedestal. */
    monitor(el, b, col) {
      const { ax, dir } = inwardAxis(b);
      const horiz = b.w >= b.h;
      const faceT = Math.min(b.w, b.h) * 0.42;
      /* the screen faces the aisle */
      let fx, fy, fw, fh;
      if (horiz) {
        fw = b.w; fh = faceT;
        fx = b.x; fy = (ax === 'y' && dir < 0) ? b.y + b.h - faceT : b.y;
      } else {
        fw = faceT; fh = b.h;
        fy = b.y; fx = (ax === 'x' && dir < 0) ? b.x + b.w - faceT : b.x;
      }
      return `<g pointer-events="none">
        <rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}"
          rx="${n(Math.min(b.w, b.h) * 0.12)}" fill="${col}" fill-opacity=".18"
          stroke="${col}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
        <rect x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}"
          fill="${col}" fill-opacity=".8"/>
      </g>`;
    },

    /* A shelf is wall-mounted: a double line, never a solid block, so it
       does not read as floor-occupying furniture. */
    shelf(el, b, col) {
      const horiz = b.w >= b.h;
      const lines = horiz
        ? [[b.x, b.y + b.h * 0.32, b.x + b.w, b.y + b.h * 0.32],
           [b.x, b.y + b.h * 0.72, b.x + b.w, b.y + b.h * 0.72]]
        : [[b.x + b.w * 0.32, b.y, b.x + b.w * 0.32, b.y + b.h],
           [b.x + b.w * 0.72, b.y, b.x + b.w * 0.72, b.y + b.h]];
      return `<g pointer-events="none" opacity=".85">
        ${lines.map(([x1, y1, x2, y2]) =>
          `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"
            stroke="${col}" stroke-width="2" stroke-linecap="round"
            vector-effect="non-scaling-stroke"/>`).join('')}
      </g>`;
    },

    /* Square-ish tables are round tables; long ones are radiused rects. */
    table(el, b, col) {
      const round = Math.abs(b.w - b.h) < Math.min(b.w, b.h) * 0.35;
      if (round) {
        const r = Math.min(b.w, b.h) / 2;
        return `<circle cx="${n(b.x + b.w / 2)}" cy="${n(b.y + b.h / 2)}" r="${n(r * 0.92)}"
          fill="${col}" fill-opacity=".26" stroke="${col}" stroke-width="1.6"
          vector-effect="non-scaling-stroke" pointer-events="none"/>`;
      }
      const rad = Math.min(b.w, b.h) * 0.22;
      return `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}"
        rx="${n(rad)}" fill="${col}" fill-opacity=".26" stroke="${col}"
        stroke-width="1.6" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
    },

    /* A counter is a service piece: radiused, with the customer-facing
       edge drawn heavy so the direction of service is readable. */
    counter(el, b, col) {
      const rad = Math.min(b.w, b.h) * 0.18;
      const horiz = b.w >= b.h;
      const { ax, dir } = inwardAxis(b);
      /* front faces the aisle, i.e. the middle of the hall */
      let fx1, fy1, fx2, fy2;
      if (ax === 'y') {
        const y = dir > 0 ? b.y + b.h : b.y;
        fx1 = b.x; fy1 = y; fx2 = b.x + b.w; fy2 = y;
      } else {
        const x = dir > 0 ? b.x + b.w : b.x;
        fx1 = x; fy1 = b.y; fx2 = x; fy2 = b.y + b.h;
      }
      void horiz;
      return `<g pointer-events="none">
        <rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}"
          rx="${n(rad)}" fill="${col}" fill-opacity=".3" stroke="${col}"
          stroke-width="1.5" vector-effect="non-scaling-stroke"/>
        <line x1="${n(fx1)}" y1="${n(fy1)}" x2="${n(fx2)}" y2="${n(fy2)}"
          stroke="${col}" stroke-width="3.4" stroke-linecap="round"
          vector-effect="non-scaling-stroke" opacity=".9"/>
      </g>`;
    },

    /* A graphic panel is a solid bar — it is a printed surface, not a
       volume, so it reads as a heavy line with support ticks. */
    display(el, b, col, zoom) {
      const thin = Math.min(b.w, b.h);
      const long = Math.max(b.w, b.h);
      const horiz = b.w >= b.h;
      const ticks = thin * zoom > 4 && long > 4;
      const t = Math.max(thin * 0.5, 0.08);
      return `<g pointer-events="none">
        <rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}"
          fill="${col}" fill-opacity=".62" stroke="${col}" stroke-width="1.2"
          vector-effect="non-scaling-stroke"/>
        ${ticks ? [0.16, 0.5, 0.84].map((f) => {
          const px = horiz ? b.x + b.w * f : b.x + b.w / 2;
          const py = horiz ? b.y + b.h / 2 : b.y + b.h * f;
          const dx = horiz ? 0 : t * 1.6, dy = horiz ? t * 1.6 : 0;
          return `<line x1="${n(px - dx)}" y1="${n(py - dy)}"
            x2="${n(px + dx)}" y2="${n(py + dy)}" stroke="${col}"
            stroke-width="1.4" vector-effect="non-scaling-stroke" opacity=".55"/>`;
        }).join('') : ''}
      </g>`;
    },

    /* ---- electrical boards ----
       A board is equipment, not furniture: solid body, and the breaker
       or outlet detail only once there is room for it to be legible. */
    'electrical-panel'(el, b, col, zoom) {
      const detail = Math.min(b.w, b.h) * zoom > 26;
      let out = `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}"
        fill="${col}" fill-opacity=".85" stroke="${col}" stroke-width="1.4"
        vector-effect="non-scaling-stroke"/>`;
      if (detail) {
        for (let i = 1; i <= 3; i++) {
          const y = b.y + (b.h * i) / 4;
          out += `<line x1="${n(b.x + b.w * 0.14)}" y1="${n(y)}"
            x2="${n(b.x + b.w * 0.86)}" y2="${n(y)}" stroke="#fff"
            stroke-width="1.3" opacity=".55" vector-effect="non-scaling-stroke"/>`;
        }
      }
      return `<g pointer-events="none">${out}</g>`;
    },

    'distro-box'(el, b, col, zoom) {
      const r = Math.min(b.w, b.h) * 0.14;
      const detail = Math.min(b.w, b.h) * zoom > 20;
      let out = `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}"
        rx="${n(Math.min(b.w, b.h) * 0.14)}" fill="${col}" fill-opacity=".9"
        stroke="${col}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
      if (detail) {
        for (let i = 0; i < 3; i++) {
          out += `<circle cx="${n(b.x + b.w * (0.26 + i * 0.24))}" cy="${n(b.y + b.h * 0.62)}"
            r="${n(r)}" fill="#fff" opacity=".7"/>`;
        }
      }
      return `<g pointer-events="none">${out}</g>`;
    },

    /* Booth spaces: draw the sides that are CLOSED.

       This is the difference an exhibitor pays for. An inline booth backs
       onto a wall with neighbours either side and sells one open face; a
       corner sells two; a peninsula three; an island stands free and sells
       all four. Drawing the solid sides heavy makes the space type — and
       therefore the price tier — readable straight off the plan, without
       anyone opening the properties panel. */
    space(el, b, col) {
      const type = el.props.spaceType || 'inline';
      if (type === 'island') {
        /* Open on every side: corner ticks only, so it still reads as a
           discrete footprint against a busy background. */
        const g = Math.min(b.w, b.h) * 0.18;
        const c = [[b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1],
                   [b.x + b.w, b.y + b.h, -1, -1], [b.x, b.y + b.h, 1, -1]];
        const d = c.map(([x, y, sx, sy]) =>
          `M ${n(x + g * sx)} ${n(y)} L ${n(x)} ${n(y)} L ${n(x)} ${n(y + g * sy)}`).join(' ');
        return `<path d="${d}" fill="none" stroke="${col}" stroke-width="2.4"
          vector-effect="non-scaling-stroke" opacity=".75" pointer-events="none"/>`;
      }

      /* The face onto the aisle is whichever side looks at the hall centre. */
      const { ax, dir } = inwardAxis(b);
      const edges = {
        n: [b.x, b.y, b.x + b.w, b.y],
        s: [b.x, b.y + b.h, b.x + b.w, b.y + b.h],
        w: [b.x, b.y, b.x, b.y + b.h],
        e: [b.x + b.w, b.y, b.x + b.w, b.y + b.h],
      };
      const open = ax === 'y' ? (dir > 0 ? 's' : 'n') : (dir > 0 ? 'e' : 'w');
      const back = { n: 's', s: 'n', e: 'w', w: 'e' }[open];
      const sides = ax === 'y' ? ['w', 'e'] : ['n', 's'];

      let closed = [back];
      if (type === 'inline') closed = closed.concat(sides);
      else if (type === 'corner') closed = closed.concat(sides[0]);
      /* peninsula: back wall only */

      const d = closed.map((id) => {
        const [x1, y1, x2, y2] = edges[id];
        return `M ${n(x1)} ${n(y1)} L ${n(x2)} ${n(y2)}`;
      }).join(' ');

      return `<path d="${d}" fill="none" stroke="${col}" stroke-width="3.4"
        stroke-linecap="square" vector-effect="non-scaling-stroke" opacity=".7"
        pointer-events="none"/>`;
    },

    /* Door leaf plus its 90° swing, opening into the hall. */
    door(el, b, col) {
      const { ax, dir } = inwardAxis(b);
      const span = ax === 'y' ? b.w : b.h;
      const leaf = Math.min(span, ax === 'y' ? b.w : b.h);
      let hx, hy, lx, ly, sweep;

      if (ax === 'y') {
        hx = b.x; hy = dir > 0 ? b.y + b.h : b.y;
        lx = hx; ly = hy + leaf * dir;
        sweep = dir > 0 ? 1 : 0;
      } else {
        hx = dir > 0 ? b.x + b.w : b.x; hy = b.y;
        lx = hx + leaf * dir; ly = hy;
        sweep = dir > 0 ? 0 : 1;
      }
      const ex = ax === 'y' ? hx + leaf : hx;
      const ey = ax === 'y' ? hy : hy + leaf;

      return `<g fill="none" stroke="${col}" stroke-width="1.5"
          vector-effect="non-scaling-stroke" pointer-events="none" opacity=".9">
        <line x1="${n(hx)}" y1="${n(hy)}" x2="${n(lx)}" y2="${n(ly)}"/>
        <path d="M ${n(lx)} ${n(ly)} A ${n(leaf)} ${n(leaf)} 0 0 ${sweep} ${n(ex)} ${n(ey)}"
              stroke-dasharray="2 1.5" opacity=".6"/>
      </g>`;
    },

    /* Egress arrow pointing out through the opening. */
    'fire-exit'(el, b, col) {
      const { ax, dir } = inwardAxis(b);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const len = Math.max(b.w, b.h) * 0.5;
      /* Outward is the opposite of inward. */
      const ox = ax === 'x' ? -dir : 0, oy = ax === 'y' ? -dir : 0;
      const tipX = cx + ox * len, tipY = cy + oy * len;
      const tailX = cx - ox * len * 0.5, tailY = cy - oy * len * 0.5;
      const hw = Math.min(b.w, b.h) * 0.42;
      const px = -oy * hw, py = ox * hw;

      return `<g pointer-events="none">
        <line x1="${n(tailX)}" y1="${n(tailY)}" x2="${n(tipX)}" y2="${n(tipY)}"
              stroke="#fff" stroke-width="2.2" vector-effect="non-scaling-stroke" opacity=".95"/>
        <polygon points="${n(tipX)},${n(tipY)} ${n(tipX - ox * hw + px)},${n(tipY - oy * hw + py)} ${n(tipX - ox * hw - px)},${n(tipY - oy * hw - py)}"
              fill="#fff" opacity=".95"/>
      </g>`;
    },

    /* Solid concrete column with an inset face. */
    column(el, b, col) {
      const i = Math.min(b.w, b.h) * 0.22;
      return `<g pointer-events="none">
        <rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="${col}" opacity=".85"/>
        <rect x="${n(b.x + i)}" y="${n(b.y + i)}" width="${n(b.w - i * 2)}" height="${n(b.h - i * 2)}"
              fill="none" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke" opacity=".5"/>
      </g>`;
    },

    /* Treads across the short axis, with a direction-of-travel arrow. */
    stairs(el, b, col) {
      const horiz = b.w >= b.h;
      const n_ = Math.max(3, Math.round((horiz ? b.w : b.h) / 1.6));
      let d = '';
      for (let i = 1; i < n_; i++) {
        const t = i / n_;
        d += horiz
          ? `M ${n(b.x + b.w * t)} ${n(b.y)} L ${n(b.x + b.w * t)} ${n(b.y + b.h)} `
          : `M ${n(b.x)} ${n(b.y + b.h * t)} L ${n(b.x + b.w)} ${n(b.y + b.h * t)} `;
      }
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const a = Math.min(b.w, b.h) * 0.3;
      const arrow = horiz
        ? `M ${n(cx - a)} ${n(cy)} L ${n(cx + a)} ${n(cy)} M ${n(cx + a - a * 0.5)} ${n(cy - a * 0.5)} L ${n(cx + a)} ${n(cy)} L ${n(cx + a - a * 0.5)} ${n(cy + a * 0.5)}`
        : `M ${n(cx)} ${n(cy - a)} L ${n(cx)} ${n(cy + a)} M ${n(cx - a * 0.5)} ${n(cy + a - a * 0.5)} L ${n(cx)} ${n(cy + a)} L ${n(cx + a * 0.5)} ${n(cy + a - a * 0.5)}`;

      return `<g fill="none" stroke="${col}" stroke-width="1.2"
          vector-effect="non-scaling-stroke" pointer-events="none" opacity=".75">
        <path d="${d}"/><path d="${arrow}" stroke-width="1.8"/></g>`;
    },

    /* Bay mouth plus an arrow showing which way freight moves. */
    'loading-dock'(el, b, col) {
      const { ax, dir } = inwardAxis(b);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const len = (ax === 'y' ? b.h : b.w) * 0.34;
      const dx = ax === 'x' ? dir : 0, dy = ax === 'y' ? dir : 0;
      const hw = Math.min(b.w, b.h) * 0.16;
      const tipX = cx + dx * len, tipY = cy + dy * len;
      const px = -dy * hw, py = dx * hw;

      return `<g pointer-events="none" opacity=".8">
        <line x1="${n(cx - dx * len)}" y1="${n(cy - dy * len)}" x2="${n(tipX)}" y2="${n(tipY)}"
              stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/>
        <polygon points="${n(tipX)},${n(tipY)} ${n(tipX - dx * hw + px)},${n(tipY - dy * hw + py)} ${n(tipX - dx * hw - px)},${n(tipY - dy * hw - py)}"
              fill="${col}"/>
      </g>`;
    },

    /* Chevrons running the length of an aisle. */
    aisle(el, b, col, zoom) {
      const horiz = b.w >= b.h;
      const run = horiz ? b.w : b.h;
      const step = Math.max(14, 90 / zoom);
      const size = Math.min(horiz ? b.h : b.w, step) * 0.22;
      if (size * zoom < 4) return '';
      let d = '';
      for (let t = step; t < run; t += step) {
        const cx = horiz ? b.x + t : b.x + b.w / 2;
        const cy = horiz ? b.y + b.h / 2 : b.y + t;
        d += horiz
          ? `M ${n(cx - size)} ${n(cy - size)} L ${n(cx)} ${n(cy)} L ${n(cx - size)} ${n(cy + size)} `
          : `M ${n(cx - size)} ${n(cy - size)} L ${n(cx)} ${n(cy)} L ${n(cx + size)} ${n(cy - size)} `;
      }
      return `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.4" opacity=".45"
        stroke-linecap="round" stroke-linejoin="round"
        vector-effect="non-scaling-stroke" pointer-events="none"/>`;
    },

    /* Platform with a weighted downstage edge. */
    stage(el, b, col) {
      const { ax, dir } = inwardAxis(b);
      let x1, y1, x2, y2;
      if (ax === 'y') {
        const y = dir > 0 ? b.y + b.h : b.y;
        x1 = b.x; y1 = y; x2 = b.x + b.w; y2 = y;
      } else {
        const x = dir > 0 ? b.x + b.w : b.x;
        x1 = x; y1 = b.y; x2 = x; y2 = b.y + b.h;
      }
      const inset = Math.min(b.w, b.h) * 0.16;
      return `<g pointer-events="none">
        <line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"
              stroke="${col}" stroke-width="3.2" vector-effect="non-scaling-stroke" opacity=".9"/>
        <rect x="${n(b.x + inset)}" y="${n(b.y + inset)}" width="${n(b.w - inset * 2)}"
              height="${n(b.h - inset * 2)}" fill="none" stroke="${col}" stroke-width="1"
              stroke-dasharray="2 2" vector-effect="non-scaling-stroke" opacity=".45"/>
      </g>`;
    },
  };

  /* Labels inside rects/polys — hidden when they'd be unreadable. */
  function labelFor(el, k, box, opts) {
    /* A legend swatch is the symbol alone; the name sits beside it. */
    if (opts.swatch) return '';
    if (!FP.state.showLabels || opts.ghost) return '';
    const zoom = FP.state.view.zoom;
    const wpx = box.w * zoom, hpx = box.h * zoom;
    if (wpx < 34 || hpx < 18) return '';

    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const isSpace = C.flag(el.kind, 'sellable');
    const title = isSpace ? (el.props.number || '—') : (el.props.label || k.name);
    const sub = isSpace ? el.props.exhibitor : '';

    /* Size to the box, then clamp to a readable range in screen px. */
    let fs = Math.min(box.w * 0.22, box.h * 0.3, 4.5);
    fs = Math.max(fs, 7 / zoom);
    if (fs * zoom > 26) fs = 26 / zoom;
    if (fs * zoom < 7) return '';

    /* Large open zones (aisles, fire lanes, rigging areas) sit UNDER the
       booths, so a centred label lands on top of them. Tuck those into the
       top-left corner instead, the way a drafter would annotate them. */
    const isZone = !isSpace && (C.flag(el.kind, 'aisle') || C.flag(el.kind, 'zone') ||
                                C.flag(el.kind, 'keepClear') || C.flag(el.kind, 'riggingZone'));

    const dark = 'var(--ink)';
    let out;
    if (isZone) {
      const zfs = G.clamp(11 / zoom, 0.8, 3.6);
      out = `<text x="${n(box.x + zfs * 0.6)}" y="${n(box.y + zfs * 1.15)}"
          font-size="${n(zfs)}" fill="var(--ink-2)" text-anchor="start" font-weight="600"
          letter-spacing="${n(zfs * 0.06)}" font-family="var(--font)" pointer-events="none"
          style="paint-order:stroke" stroke="var(--paper)" stroke-width="${n(zfs * 0.28)}"
          >${esc(title.toUpperCase())}</text>`;
      return out;
    }

    /* Never let a label spill past its own footprint — on a floor plan an
       overflowing name reads as if it belongs to the neighbouring booth. */
    const maxChars = Math.floor(box.w / (fs * 0.54));
    if (maxChars < 2) return '';

    /* Furniture is not captioned on a real drawing. A stool labelled
       "Ale Bar Stool" cannot physically fit the words inside a 1.5 ft
       circle, so the text escapes the shape and collides with whatever is
       next to it — which is exactly what makes a plan look amateur.
       Draw the name only when it genuinely fits inside the object;
       otherwise the symbol speaks for itself and the name lives in the
       order list and the properties panel. */
    if (el.layer === 'contents') {
      const needed = title.length * fs * 0.58;
      if (needed > box.w * 0.9 || fs * zoom < 8) return '';
    }

    /* A symbol owns the middle of the box, so the caption drops to the
       foot of it rather than sitting on top of the glyph. */
    /* Booths draw walls at their edges, not a glyph in the middle, so the
       number stays centred where an exhibitor expects to read it. */
    const symbol = hasSymbol(k) && !isSpace && hpx > 46 && wpx > 30;
    const baseY = symbol
      ? box.y + box.h - fs * 0.55
      : (sub && hpx > 40 ? cy - fs * 0.15 : cy + fs * 0.34);

    out = `<text x="${n(cx)}" y="${n(baseY)}"
        font-size="${n(fs)}" fill="${dark}" text-anchor="middle" font-weight="680"
        font-family="var(--font)" pointer-events="none"
        style="paint-order:stroke" stroke="var(--paper)" stroke-width="${n(fs * 0.2)}"
        >${esc(clip(title, maxChars))}</text>`;

    if (sub && hpx > 40) {
      const sfs = fs * 0.62;
      if (sfs * zoom >= 6.5) {
        out += `<text x="${n(cx)}" y="${n(cy + fs * 0.95)}" font-size="${n(sfs)}"
            fill="var(--ink-2)" text-anchor="middle" font-weight="500"
            font-family="var(--font)" pointer-events="none"
            style="paint-order:stroke" stroke="var(--paper)" stroke-width="${n(sfs * 0.22)}"
            >${esc(clip(sub, Math.floor(box.w / (sfs * 0.5))))}</text>`;
      }
    }

    /* Footprint dimensions, only when there is room for them. */
    if (isSpace && hpx > 62 && wpx > 60) {
      const dfs = fs * 0.5;
      out += `<text x="${n(cx)}" y="${n(box.y + box.h - dfs * 0.7)}" font-size="${n(dfs)}"
          fill="var(--ink-3)" text-anchor="middle" font-family="var(--mono)"
          pointer-events="none">${esc(G.fmtDims(box.w, box.h, opts.unit))}</text>`;
    }
    return out;
  }

  const clip = (s, len) => (s.length > len ? `${s.slice(0, Math.max(3, len - 1))}…` : s);

  function issueBadge(el, severity) {
    const b = G.bbox(el);
    const r = G.clamp(7 / FP.state.view.zoom, 0.4, 2.2);
    const col = severity === 'error' ? '#ef4444' : '#f59e0b';
    return `<g pointer-events="none">
      <circle cx="${n(b.x + b.w - r * 0.6)}" cy="${n(b.y + r * 0.6)}" r="${n(r)}"
              fill="${col}" stroke="var(--paper)" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
      <text x="${n(b.x + b.w - r * 0.6)}" y="${n(b.y + r * 0.6 + r * 0.52)}" font-size="${n(r * 1.5)}"
            fill="#fff" text-anchor="middle" font-weight="800" font-family="var(--font)">!</text>
    </g>`;
  }

  /* ---------------- selection chrome ---------------- */

  const HANDLES = [
    ['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0],
    ['e', 1, .5], ['se', 1, 1], ['s', .5, 1],
    ['sw', 0, 1], ['w', 0, .5],
  ];

  function selectionChrome() {
    const sel = FP.selected().filter(FP.isVisible);
    if (!sel.length) return '';
    const zoom = FP.state.view.zoom;
    const hs = 4.5 / zoom;          // handle half-size in world units
    let out = '<g class="chrome" pointer-events="none">';

    /* Multi-select: one dashed box around everything. */
    if (sel.length > 1) {
      const b = G.bboxOfMany(sel);
      out += `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}"
                fill="none" stroke="var(--accent)" stroke-width="1.4"
                stroke-dasharray="${n(4 / zoom)} ${n(3 / zoom)}" vector-effect="non-scaling-stroke"/>`;
    }

    for (const el of sel) {
      const q = el.geometry;

      if (el.shape === 'rect' || el.shape === 'poly') {
        const b = el.shape === 'rect'
          ? { x: q.x, y: q.y, w: q.w, h: q.h }
          : G.polyBBox(q.pts);
        const rot = el.shape === 'rect' && q.rot
          ? ` transform="rotate(${n(q.rot)} ${n(b.x + b.w / 2)} ${n(b.y + b.h / 2)})"` : '';

        out += `<g${rot}>`;
        out += `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}"
                  fill="none" stroke="var(--accent)" stroke-width="1.8"
                  vector-effect="non-scaling-stroke"/>`;

        if (sel.length === 1 && el.shape === 'rect' && !FP.isLocked(el)) {
          for (const [id, fx, fy] of HANDLES) {
            const hx = b.x + b.w * fx, hy = b.y + b.h * fy;
            out += `<rect data-handle="${id}" data-el="${el.id}" pointer-events="all"
                      x="${n(hx - hs)}" y="${n(hy - hs)}" width="${n(hs * 2)}" height="${n(hs * 2)}"
                      fill="var(--paper)" stroke="var(--accent)" stroke-width="1.6"
                      vector-effect="non-scaling-stroke" rx="${n(hs * 0.35)}"/>`;
          }
          /* Rotate handle, floating above the top edge. */
          const rx = b.x + b.w / 2, ry = b.y - 22 / zoom;
          out += `<line x1="${n(rx)}" y1="${n(b.y)}" x2="${n(rx)}" y2="${n(ry)}"
                    stroke="var(--accent)" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
          out += `<circle data-handle="rot" data-el="${el.id}" pointer-events="all"
                    cx="${n(rx)}" cy="${n(ry)}" r="${n(hs * 1.15)}"
                    fill="var(--paper)" stroke="var(--accent)" stroke-width="1.6"
                    vector-effect="non-scaling-stroke"/>`;
        }
        out += '</g>';

        if (sel.length === 1 && el.shape === 'poly' && !FP.isLocked(el)) {
          q.pts.forEach((p, i) => {
            out += `<rect data-handle="pt${i}" data-el="${el.id}" pointer-events="all"
                      x="${n(p[0] - hs)}" y="${n(p[1] - hs)}" width="${n(hs * 2)}" height="${n(hs * 2)}"
                      fill="var(--paper)" stroke="var(--accent)" stroke-width="1.6"
                      vector-effect="non-scaling-stroke" rx="${n(hs * 0.35)}"/>`;
          });
        }
      } else if (el.shape === 'line') {
        out += `<line x1="${n(q.x1)}" y1="${n(q.y1)}" x2="${n(q.x2)}" y2="${n(q.y2)}"
                  stroke="var(--accent)" stroke-width="2.4" stroke-opacity=".5"
                  vector-effect="non-scaling-stroke"/>`;
        if (sel.length === 1 && !FP.isLocked(el)) {
          [['p1', q.x1, q.y1], ['p2', q.x2, q.y2]].forEach(([id, x, y]) => {
            out += `<rect data-handle="${id}" data-el="${el.id}" pointer-events="all"
                      x="${n(x - hs)}" y="${n(y - hs)}" width="${n(hs * 2)}" height="${n(hs * 2)}"
                      fill="var(--paper)" stroke="var(--accent)" stroke-width="1.6"
                      vector-effect="non-scaling-stroke" rx="${n(hs * 0.35)}"/>`;
          });
        }
      } else {
        const b = G.bbox(el);
        out += `<rect x="${n(b.x - hs)}" y="${n(b.y - hs)}" width="${n(b.w + hs * 2)}"
                  height="${n(b.h + hs * 2)}" fill="none" stroke="var(--accent)"
                  stroke-width="1.6" vector-effect="non-scaling-stroke" rx="${n(hs)}"/>`;
      }
    }

    /* Live dimensions while dragging a single rect. */
    if (sel.length === 1 && FP.state.drag && sel[0].shape === 'rect') {
      const q = sel[0].geometry;
      const fs = G.clamp(12 / zoom, 0.7, 5);
      out += `<text x="${n(q.x + q.w / 2)}" y="${n(q.y - 8 / zoom)}" font-size="${n(fs)}"
          fill="var(--accent)" text-anchor="middle" font-weight="700" font-family="var(--mono)"
          style="paint-order:stroke" stroke="var(--paper)" stroke-width="${n(fs * 0.3)}"
          >${esc(G.fmtDims(q.w, q.h, FP.plan.unit))}</text>`;
    }

    return `${out}</g>`;
  }

  /* ---------------- draft / marquee ---------------- */

  function draftChrome() {
    const d = FP.state.draft;
    if (!d) return '';
    const zoom = FP.state.view.zoom;
    const col = 'var(--accent)';
    const dash = `stroke-dasharray="${n(5 / zoom)} ${n(3 / zoom)}"`;

    if (d.type === 'rect') {
      const r = G.normalizeRect(d.rect);
      const fs = G.clamp(12 / zoom, 0.7, 5);
      return `<g pointer-events="none">
        <rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}"
              fill="${col}" fill-opacity=".14" stroke="${col}" stroke-width="1.6"
              vector-effect="non-scaling-stroke" ${dash}/>
        <text x="${n(r.x + r.w / 2)}" y="${n(r.y - 8 / zoom)}" font-size="${n(fs)}"
              fill="${col}" text-anchor="middle" font-weight="700" font-family="var(--mono)"
              style="paint-order:stroke" stroke="var(--paper)" stroke-width="${n(fs * 0.3)}"
              >${esc(G.fmtDims(r.w, r.h, FP.plan.unit))}</text></g>`;
    }

    if (d.type === 'marquee') {
      const r = G.normalizeRect(d.rect);
      return `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}"
                fill="var(--accent)" fill-opacity=".1" stroke="var(--accent)"
                stroke-width="1.2" vector-effect="non-scaling-stroke" ${dash}
                pointer-events="none"/>`;
    }

    if (d.type === 'line') {
      const fs = G.clamp(12 / zoom, 0.7, 5);
      const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
      return `<g pointer-events="none">
        <line x1="${n(d.x1)}" y1="${n(d.y1)}" x2="${n(d.x2)}" y2="${n(d.y2)}"
              stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" ${dash}/>
        <text x="${n((d.x1 + d.x2) / 2)}" y="${n((d.y1 + d.y2) / 2 - 6 / zoom)}" font-size="${n(fs)}"
              fill="${col}" text-anchor="middle" font-weight="700" font-family="var(--mono)"
              style="paint-order:stroke" stroke="var(--paper)" stroke-width="${n(fs * 0.3)}"
              >${esc(G.fmtLen(len, FP.plan.unit))}</text></g>`;
    }

    if (d.type === 'poly') {
      const pts = [...d.pts, d.cursor].filter(Boolean);
      if (!pts.length) return '';
      const str = pts.map((p) => `${n(p[0])},${n(p[1])}`).join(' ');
      const hs = 4 / zoom;
      let out = `<g pointer-events="none">
        <polyline points="${str}" fill="var(--accent)" fill-opacity=".1" stroke="${col}"
                  stroke-width="1.8" vector-effect="non-scaling-stroke" ${dash}/>`;
      d.pts.forEach((p, i) => {
        out += `<rect x="${n(p[0] - hs)}" y="${n(p[1] - hs)}" width="${n(hs * 2)}" height="${n(hs * 2)}"
                  fill="${i === 0 ? 'var(--accent)' : 'var(--paper)'}" stroke="${col}"
                  stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
      });
      return `${out}</g>`;
    }
    return '';
  }

  /* ---------------- paint ---------------- */

  function paint() {
    if (!svg) return;
    const st = FP.state;
    const plan = FP.plan;
    const { w, h } = R.size();
    const v = st.view;
    const unit = plan.unit || 'ft';

    svg.setAttribute('viewBox', `${n(v.x)} ${n(v.y)} ${n(w / v.zoom)} ${n(h / v.zoom)}`);

    const issues = FP.rules ? FP.rules.byElement(st.issues || []) : {};
    const scoped = FP.state.scope.type === 'booth';
    const space = FP.scopeSpace();

    let out = defs();

    /* --- hall paper + grid --- */
    if (!scoped) {
      out += `<rect x="0" y="0" width="${n(plan.width)}" height="${n(plan.height)}"
                fill="var(--paper)" stroke="var(--line-2)" stroke-width="2"
                vector-effect="non-scaling-stroke"/>`;
      if (st.showGrid) {
        out += `<rect x="0" y="0" width="${n(plan.width)}" height="${n(plan.height)}"
                  fill="url(#pg-major)" pointer-events="none"/>`;
      }
    } else if (space) {
      const b = G.bbox(space);
      out += `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}"
                fill="var(--paper)" stroke="var(--accent)" stroke-width="2.5"
                vector-effect="non-scaling-stroke"/>`;
      if (st.showGrid) {
        out += `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}"
                  fill="url(#pg-major)" pointer-events="none"/>`;
      }
    }

    /* --- reference image underlay ---
       Scope-aware: the hall traces its venue drawing, a booth traces the
       exhibitor's own CAD. FP.getUnderlay resolves whichever applies. */
    const under = FP.getUnderlay?.();
    if (under?.src && plan.layers.underlay?.visible !== false) {
      const rot = under.rot
        ? ` transform="rotate(${n(under.rot)} ${n(under.x + under.w / 2)} ${n(under.y + under.h / 2)})"`
        : '';
      out += `<image href="${esc(under.src)}" x="${n(under.x)}" y="${n(under.y)}"
                width="${n(under.w)}" height="${n(under.h)}" opacity="${under.opacity ?? 0.5}"
                preserveAspectRatio="none" pointer-events="none"${rot}/>`;
    }

    /* --- elements, ordered by layer then insertion --- */
    const visible = FP.inScope().filter(FP.isVisible);
    const ordered = visible
      .map((el, i) => ({ el, i, o: C.layerOrder(el.layer) }))
      .sort((a, b) => a.o - b.o || a.i - b.i);

    /* Summed once per paint, not per space — see FP.ampsBySpace. */
    const opts = { issues, unit,
      amps: FP.state.colorBy === 'power' ? FP.ampsBySpace() : null };

    /* In booth scope the surrounding hall is drawn as a faint reference. */
    if (scoped && space) {
      const around = FP.plan.elements.filter(
        (e) => !e.parentId && e.id !== space.id && FP.isVisible(e));
      out += '<g class="ghosts">';
      for (const el of around) out += drawElement(el, { ...opts, ghost: true });
      out += '</g>';
    }

    out += '<g class="elements">';
    for (const { el } of ordered) out += drawElement(el, opts);
    out += '</g>';

    /* Booth contents shown faintly on the hall view so nothing is hidden. */
    if (!scoped) {
      const children = FP.plan.elements.filter((e) => e.parentId && FP.isVisible(e));
      if (children.length) {
        out += '<g class="children" opacity=".5">';
        for (const el of children) out += drawElement(el, { ...opts, ghost: true });
        out += '</g>';
      }
    }

    out += selectionChrome();
    out += draftChrome();

    svg.innerHTML = out;
    FP.emit('painted');
  }

  R.paintNow = paint;

  /**
   * A standalone swatch of one kind's plan symbol, for a printed legend.
   *
   * Deliberately runs the real drawElement path rather than re-drawing a
   * lookalike: a legend that is maintained separately from the plan will
   * eventually disagree with it, and a legend that disagrees with the
   * drawing is worse than no legend at all.
   *
   * @param {string} kindId
   * @param {number} px      swatch height in pixels
   * @param {boolean} vars   inline concrete colours (for a print window
   *                         that has none of the app's CSS variables)
   */
  R.symbolSwatch = (kindId, px = 20, vars = true) => {
    const k = C.kind(kindId);
    if (!k) return '';

    /* A landscape box reads best for most kinds; markers get a square. */
    const W = k.shape === 'marker' ? 6 : 10;
    const H = 6;

    const el = {
      id: 'swatch', kind: k.id, shape: k.shape, layer: k.layer,
      parentId: null, geometry: {}, props: {},
    };
    switch (k.shape) {
      case 'rect': el.geometry = { x: 0.6, y: 0.6, w: W - 1.2, h: H - 1.2, rot: 0 }; break;
      case 'line': el.geometry = { x1: 0.5, y1: H / 2, x2: W - 0.5, y2: H / 2,
                                   thickness: k.thickness ?? 0.5 }; break;
      case 'marker': el.geometry = { x: W / 2, y: H / 2, r: Math.min(W, H) * 0.3 }; break;
      case 'poly': el.geometry = { pts: [[0.6, 0.6], [W - 0.6, 1.2], [W - 1.2, H - 0.6], [1, H - 1]] }; break;
      default: el.geometry = { x: 0.6, y: H * 0.68, rot: 0 };
    }
    /* Spaces need a type, or the wall symbol has nothing to orient from. */
    if (C.flag(k.id, 'sellable')) el.props.spaceType = 'inline';

    /* The drawing code reads live view state; borrow it and put it back. */
    const saved = FP.state.view.zoom;
    const savedPlan = FP.plan;
    FP.state.view.zoom = (px / H) * 3;
    let body = '';
    try {
      body = drawElement(el, { issues: {}, unit: 'ft', swatch: true });
    } catch (err) {
      console.warn('swatch failed for', kindId, err);
    } finally {
      FP.state.view.zoom = saved;
      FP.plan = savedPlan;
    }

    const style = vars ? `<style>svg{${SWATCH_VARS}}</style>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" width="${Math.round((px * W) / H)}" height="${px}"
      xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle">${style}${body}</svg>`;
  };

  /* Concrete values for the variables the drawing code emits, so a swatch
     stands alone in a print window with no stylesheet attached. */
  const SWATCH_VARS = [
    '--paper:#ffffff', '--ink:#131a26', '--ink-2:#5a6779',
    '--tx:#131a26', '--tx-2:#5a6779', '--tx-3:#8b96a8',
    '--line:#dde3ec', '--line-2:#c6cfdd', '--accent:#7c5cfc',
    '--font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
  ].join(';');
})(window);
