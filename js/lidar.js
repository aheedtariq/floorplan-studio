/* ============================================================
   lidar.js — iPhone LiDAR scan import.

   Safari cannot talk to the LiDAR sensor directly (Apple only exposes
   it to native apps through ARKit/RoomPlan), so the bridge is the file
   those apps export: a RoomPlan "CapturedRoom" JSON. Any scanner app
   built on RoomPlan can produce one. This module converts that JSON
   into real plan elements — walls, doors, windows-as-openings, and
   recognisable furniture — at true dimensions, metres in, feet out.
   No tracing, no scale calibration.

   Geometry notes:
   · RoomPlan is y-up; the floor plane is x/z. A surface's `transform`
     is a column-major 4×4: translation in elements 12/14 (x/z), and
     the local x-axis (elements 0/2) is the wall's run direction.
   · `dimensions` is [length, height, thickness] — as [x,y,z] arrays
     or {x,y,z} objects depending on the exporting app; both accepted.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const M2FT = 3.28084;

  const dim = (d) => Array.isArray(d)
    ? { x: d[0] || 0, y: d[1] || 0, z: d[2] || 0 }
    : { x: d?.x || 0, y: d?.y || 0, z: d?.z || 0 };

  /* Wall run as a 2D segment in feet: centre ± half-length along the
     local x-axis, projected onto the floor plane. */
  function segment(surface) {
    const t = surface.transform;
    if (!Array.isArray(t) || t.length < 16) return null;
    const d = dim(surface.dimensions);
    const len = d.x * M2FT;
    if (len < 0.5) return null;
    const cx = t[12] * M2FT, cz = t[14] * M2FT;
    let ax = t[0], az = t[2];
    const n = Math.hypot(ax, az) || 1;
    ax /= n; az /= n;
    const h = len / 2;
    return {
      x1: cx - ax * h, y1: cz - az * h,
      x2: cx + ax * h, y2: cz + az * h,
      len,
      height: d.y * M2FT,
      cx, cz,
    };
  }

  /* RoomPlan object categories worth placing; everything else (beds,
     bathtubs…) has no trade-show meaning and is skipped. Category is a
     string, or an object like {table:{}} in some exports. */
  const OBJ_KINDS = {
    table: 'table', chair: 'chair', sofa: 'sofa', stool: 'stool',
    television: 'monitor', storage: 'shelf', stairs: 'stairs',
  };
  const objCategory = (o) => {
    const c = o.category;
    if (typeof c === 'string') return c.toLowerCase();
    if (c && typeof c === 'object') return String(Object.keys(c)[0] || '').toLowerCase();
    return '';
  };

  /**
   * Parse a CapturedRoom JSON string and add its contents to the open
   * plan. Returns {walls, doors, openings, objects, error}.
   */
  FP.importRoomPlan = (jsonText) => {
    let scan;
    try { scan = JSON.parse(jsonText); } catch {
      return { error: 'That file is not valid JSON. Export the scan as RoomPlan JSON and try again.' };
    }
    /* some apps nest the room under coreModel / capturedRoom */
    if (!scan.walls && scan.coreModel?.walls) scan = scan.coreModel;
    if (!scan.walls && scan.capturedRoom?.walls) scan = scan.capturedRoom;
    const walls = Array.isArray(scan.walls) ? scan.walls : [];
    if (!walls.length) {
      return { error: 'No walls found in this file — it does not look like a RoomPlan export.' };
    }

    const made = { walls: 0, doors: 0, openings: 0, objects: 0 };
    const els = [];
    const pts = [];

    for (const w of walls) {
      const s = segment(w);
      if (!s) continue;
      pts.push([s.x1, s.y1], [s.x2, s.y2]);
      els.push({
        kind: 'wall', shape: 'line', layer: 'structure',
        geometry: { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, thickness: 0.75 },
        props: { height: Math.round(s.height * 2) / 2 || undefined, label: '' },
      });
      made.walls++;
    }
    if (!made.walls) return { error: 'The walls in this file had no usable geometry.' };

    for (const d of (Array.isArray(scan.doors) ? scan.doors : [])) {
      const s = segment(d);
      if (!s) continue;
      els.push({
        kind: 'door', shape: 'rect', layer: 'structure',
        geometry: { x: s.cx - s.len / 2, y: s.cz - 0.75, w: s.len, h: 1.5,
                    rot: Math.round(Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180 / Math.PI) },
        props: { label: 'Door' },
      });
      made.doors++;
    }

    for (const o of (Array.isArray(scan.openings) ? scan.openings : [])
                      .concat(Array.isArray(scan.windows) ? scan.windows : [])) {
      const s = segment(o);
      if (!s) continue;
      els.push({
        kind: 'text', shape: 'text', layer: 'annotate',
        geometry: { x: s.cx, y: s.cz },
        props: { text: 'Opening', fontSize: 2 },
      });
      made.openings++;
    }

    for (const o of (Array.isArray(scan.objects) ? scan.objects : [])) {
      const kind = OBJ_KINDS[objCategory(o)];
      if (!kind) continue;
      const t = o.transform;
      if (!Array.isArray(t) || t.length < 16) continue;
      const d = dim(o.dimensions);
      const w = Math.max(d.x * M2FT, 0.8), h = Math.max(d.z * M2FT, 0.8);
      const cx = t[12] * M2FT, cz = t[14] * M2FT;
      const rot = Math.round(Math.atan2(t[2], t[0]) * 180 / Math.PI);
      els.push({
        kind, shape: 'rect', layer: 'contents',
        geometry: { x: cx - w / 2, y: cz - h / 2, w, h, rot },
        props: { label: '' },
      });
      made.objects++;
    }

    /* Shift the scan into positive plan coordinates with a margin, and
       grow the hall if the room is bigger than the current plan. */
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const maxX = Math.max(...xs), maxY = Math.max(...ys);
    const M = 10;                      /* ft margin */
    const dx = M - minX, dy = M - minY;

    for (const el of els) {
      const g = el.geometry;
      if (el.shape === 'line') { g.x1 += dx; g.y1 += dy; g.x2 += dx; g.y2 += dy; }
      else { g.x += dx; g.y += dy; }
    }

    FP.snapshot();
    const needW = maxX - minX + M * 2, needH = maxY - minY + M * 2;
    if (needW > FP.plan.width) FP.plan.width = Math.ceil(needW / 5) * 5;
    if (needH > FP.plan.height) FP.plan.height = Math.ceil(needH / 5) * 5;

    const real = els.map((spec) => {
      const el = FP.makeElement(spec.kind, spec.geometry);
      Object.assign(el.props, spec.props);
      return el;
    });
    /* one undo step for the whole scan — the snapshot above covers the
       plan resize too */
    FP.addElements(real, { snapshot: false, select: false });
    return made;
  };
})(window);
