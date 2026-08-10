/* ============================================================
   geometry.js — pure math over the shared element primitive.

   An element is:
     { id, kind, shape, geometry, props, layer, z }

   `shape` selects how `geometry` is read:
     rect   -> { x, y, w, h, rot }
     poly   -> { pts: [[x,y], …] }
     line   -> { x1, y1, x2, y2, thickness }
     marker -> { x, y, r }
     text   -> { x, y, rot }

   World units are feet or metres — the plan carries the unit, the math
   does not care. Nothing here touches the DOM or app state.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});
  const G = (FP.geo = {});

  const RAD = Math.PI / 180;

  G.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  G.round = (v, p = 2) => Math.round(v * 10 ** p) / 10 ** p;
  G.snap = (v, step) => (step > 0 ? Math.round(v / step) * step : v);

  /* Geometry accessor. Elements always carry `geometry`; raw geometry
     objects are accepted too so callers can test candidates before commit. */
  const g = (o) => o.geometry || o;

  G.rotate = (px, py, cx, cy, deg) => {
    if (!deg) return { x: px, y: py };
    const a = deg * RAD, s = Math.sin(a), c = Math.cos(a);
    const dx = px - cx, dy = py - cy;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  };

  G.center = (el) => {
    const q = g(el);
    switch (el.shape) {
      case 'rect': return { x: q.x + q.w / 2, y: q.y + q.h / 2 };
      case 'poly': { const b = G.polyBBox(q.pts); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
      case 'line': return { x: (q.x1 + q.x2) / 2, y: (q.y1 + q.y2) / 2 };
      default: return { x: q.x, y: q.y };
    }
  };

  /** World point -> element-local (un-rotated) space. */
  G.toLocal = (px, py, el) => {
    const c = G.center(el);
    return G.rotate(px, py, c.x, c.y, -(g(el).rot || 0));
  };

  /** The four corners of a rect element, rotation applied. */
  G.corners = (el) => {
    const q = g(el), c = G.center(el);
    return [[q.x, q.y], [q.x + q.w, q.y], [q.x + q.w, q.y + q.h], [q.x, q.y + q.h]]
      .map(([x, y]) => G.rotate(x, y, c.x, c.y, q.rot || 0));
  };

  G.polyBBox = (pts) => {
    if (!pts || !pts.length) return { x: 0, y: 0, w: 0, h: 0 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  /** Axis-aligned bounding box in world space, rotation included. */
  G.bbox = (el) => {
    const q = g(el);
    switch (el.shape) {
      case 'rect':
        return q.rot ? G.polyBBox(G.corners(el).map((p) => [p.x, p.y]))
                     : { x: q.x, y: q.y, w: q.w, h: q.h };
      case 'poly':
        return G.polyBBox(q.pts);
      case 'line': {
        const t = (q.thickness || 0.5) / 2;
        return {
          x: Math.min(q.x1, q.x2) - t, y: Math.min(q.y1, q.y2) - t,
          w: Math.abs(q.x2 - q.x1) + t * 2, h: Math.abs(q.y2 - q.y1) + t * 2,
        };
      }
      case 'text': {
        const fs = el.props?.fontSize || 4;
        const wpx = (el.props?.text || '').length * fs * 0.55;
        return { x: q.x, y: q.y - fs, w: Math.max(wpx, fs), h: fs * 1.3 };
      }
      default: {
        const r = q.r || 1.5;
        return { x: q.x - r, y: q.y - r, w: r * 2, h: r * 2 };
      }
    }
  };

  G.bboxOfMany = (els) => {
    if (!els.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of els) {
      const b = G.bbox(el);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  G.rectsIntersect = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  G.rectContains = (outer, inner) =>
    inner.x >= outer.x - 1e-6 && inner.y >= outer.y - 1e-6 &&
    inner.x + inner.w <= outer.x + outer.w + 1e-6 &&
    inner.y + inner.h <= outer.y + outer.h + 1e-6;

  /** Polygon outline for any element — the common currency for overlap tests. */
  G.outline = (el) => {
    const q = g(el);
    switch (el.shape) {
      case 'rect': return G.corners(el);
      case 'poly': return q.pts.map((p) => ({ x: p[0], y: p[1] }));
      case 'line': {
        const t = Math.max(q.thickness || 0.5, 0.25) / 2;
        const dx = q.x2 - q.x1, dy = q.y2 - q.y1;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * t, ny = (dx / len) * t;
        return [
          { x: q.x1 + nx, y: q.y1 + ny }, { x: q.x2 + nx, y: q.y2 + ny },
          { x: q.x2 - nx, y: q.y2 - ny }, { x: q.x1 - nx, y: q.y1 - ny },
        ];
      }
      default: {
        const b = G.bbox(el);
        const r = q.r || 1.5;
        if (el.shape === 'text') {
          return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
                  { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
        }
        const pts = [];
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          pts.push({ x: q.x + Math.cos(a) * r, y: q.y + Math.sin(a) * r });
        }
        return pts;
      }
    }
  };

  /** Separating-axis test: exact for convex shapes, conservative for concave. */
  G.polysOverlap = (A, B) => {
    if (!A.length || !B.length) return false;
    for (const poly of [A, B]) {
      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
        const ax = -(p2.y - p1.y), ay = p2.x - p1.x;
        if (ax === 0 && ay === 0) continue;
        let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
        for (const p of A) { const d = p.x * ax + p.y * ay; if (d < minA) minA = d; if (d > maxA) maxA = d; }
        for (const p of B) { const d = p.x * ax + p.y * ay; if (d < minB) minB = d; if (d > maxB) maxB = d; }
        if (maxA < minB + 1e-6 || maxB < minA + 1e-6) return false;
      }
    }
    return true;
  };

  G.elementsOverlap = (a, b) =>
    G.rectsIntersect(G.bbox(a), G.bbox(b)) && G.polysOverlap(G.outline(a), G.outline(b));

  G.pointInPoly = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  G.hitTest = (x, y, el, slop = 0) => {
    const b = G.bbox(el);
    if (x < b.x - slop || x > b.x + b.w + slop || y < b.y - slop || y > b.y + b.h + slop) return false;
    if (el.shape === 'line') {
      const q = g(el);
      return G.distPointSeg(x, y, q.x1, q.y1, q.x2, q.y2) <= Math.max((q.thickness || 0.5) / 2, slop);
    }
    return G.pointInPoly(x, y, G.outline(el));
  };

  G.polyArea = (pts) => {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    }
    return Math.abs(a / 2);
  };

  G.area = (el) => {
    const q = g(el);
    switch (el.shape) {
      case 'rect': return Math.abs(q.w * q.h);
      case 'poly': return G.polyArea(q.pts);
      case 'line': return Math.hypot(q.x2 - q.x1, q.y2 - q.y1) * (q.thickness || 0.5);
      case 'text': return 0;
      default: return Math.PI * (q.r || 1.5) ** 2;
    }
  };

  G.length = (el) => {
    const q = g(el);
    return el.shape === 'line' ? Math.hypot(q.x2 - q.x1, q.y2 - q.y1) : 0;
  };

  G.distPointSeg = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    const t = G.clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };

  /** Shortest distance between two element outlines — 0 when they overlap. */
  G.gapBetween = (a, b) => {
    const A = G.outline(a), B = G.outline(b);
    if (G.polysOverlap(A, B)) return 0;
    let min = Infinity;
    const walk = (pts, poly) => {
      for (const p of pts) {
        for (let i = 0; i < poly.length; i++) {
          const q1 = poly[i], q2 = poly[(i + 1) % poly.length];
          const d = G.distPointSeg(p.x, p.y, q1.x, q1.y, q2.x, q2.y);
          if (d < min) min = d;
        }
      }
    };
    walk(A, B); walk(B, A);
    return min;
  };

  /* ---------- translation / transform helpers ---------- */

  G.translate = (geom, shape, dx, dy) => {
    const q = { ...geom };
    switch (shape) {
      case 'poly': q.pts = geom.pts.map(([x, y]) => [x + dx, y + dy]); break;
      case 'line': q.x1 += dx; q.y1 += dy; q.x2 += dx; q.y2 += dy; break;
      default: q.x += dx; q.y += dy;
    }
    return q;
  };

  /** Normalise a rect that was dragged out backwards. */
  G.normalizeRect = (r) => ({
    ...r,
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  });

  /* ---------- display formatting ---------- */

  /** 12.5 -> `12'6"` in feet, `3.81 m` in metres. */
  G.fmtLen = (v, unit) => {
    if (unit === 'm') return `${G.round(v, 2)} m`;
    const neg = v < 0 ? '-' : '';
    v = Math.abs(v);
    let ft = Math.floor(v + 1e-9);
    let inch = Math.round((v - ft) * 12);
    if (inch === 12) { ft += 1; inch = 0; }
    return `${neg}${ft}'${inch ? `${inch}"` : ''}`;
  };

  G.fmtArea = (v, unit) =>
    unit === 'm' ? `${G.round(v, 1)} m²` : `${Math.round(v).toLocaleString()} sq ft`;

  G.fmtDims = (w, h, unit) => `${G.fmtLen(w, unit)} × ${G.fmtLen(h, unit)}`;
})(window);
