/* ============================================================
   photoplan.js — AI photo → plan conversion.

   The staff-side counterpart to lidar.js: instead of a RoomPlan scan,
   the input is a photo of the venue's printed floor plan. The
   plan-from-photo edge function has Claude read the image and return
   structured JSON — walls, doors, booths, zones, labels — in feet with
   the origin at the hall's top-left, which is already the editor's
   coordinate frame. This module ships the photo up, then instantiates
   the reply as real, editable elements in one undo step.

   The photo is downscaled client-side before upload: floor-plan
   legibility survives 2000 px easily, and it keeps the request far
   under both the function payload limit and the vision API's cap.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const MAX_EDGE = 2000;              /* px, long edge after downscale */

  /** Downscale + JPEG-compress a photo File into { image, media_type }. */
  function prepareImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That file is not a readable image'));
        img.onload = () => {
          const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve({
            image: canvas.toDataURL('image/jpeg', 0.85),
            media_type: 'image/jpeg',
          });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* zone kinds in the AI schema that map 1:1 onto catalog kinds */
  const ZONE_KINDS = { 'loading-dock': 'loading-dock', restroom: 'restroom', stage: 'stage' };

  /**
   * Instantiate an extracted plan as elements on the open plan.
   * `widthHint` (ft) rescales everything when the user knows the real
   * hall width — printed plans rarely carry trustworthy absolute scale.
   */
  function apply(data, widthHint) {
    const hall = data.hall || {};
    const k = widthHint > 0 && hall.width_ft > 0 ? widthHint / hall.width_ft : 1;
    const ft = (n) => Math.round(Number(n || 0) * k * 2) / 2;   /* snap to 6in */

    const specs = [];

    for (const w of data.walls || []) {
      specs.push({
        kind: 'wall',
        geometry: { x1: ft(w.x1), y1: ft(w.y1), x2: ft(w.x2), y2: ft(w.y2), thickness: 0.75 },
        props: {},
      });
    }
    for (const d of data.doors || []) {
      specs.push({
        kind: d.kind === 'fire-exit' ? 'fire-exit' : 'door',
        geometry: { x: ft(d.x), y: ft(d.y), w: Math.max(ft(d.w), 3), h: Math.max(ft(d.h), 1) },
        props: { label: d.kind === 'fire-exit' ? 'Fire exit' : 'Entrance' },
      });
    }
    for (const b of data.booths || []) {
      specs.push({
        kind: 'space',
        geometry: { x: ft(b.x), y: ft(b.y), w: Math.max(ft(b.w), 4), h: Math.max(ft(b.h), 4) },
        props: {
          number: String(b.number || ''),
          /* the model judges open-sidedness from the drawing; second-
             guessing it by size misfiles scaled-up inline booths */
          spaceType: b.island ? 'island' : 'inline',
        },
      });
    }
    for (const z of data.zones || []) {
      specs.push({
        kind: ZONE_KINDS[z.kind] || 'zone',
        geometry: { x: ft(z.x), y: ft(z.y), w: Math.max(ft(z.w), 4), h: Math.max(ft(z.h), 4) },
        props: { label: String(z.label || '') },
      });
    }
    for (const t of data.labels || []) {
      if (!t.text) continue;
      specs.push({
        kind: 'text',
        geometry: { x: ft(t.x), y: ft(t.y) },
        props: { text: String(t.text), fontSize: 2.5 },
      });
    }
    if (!specs.length) return { error: 'The AI found nothing usable in that photo' };

    FP.snapshot();

    /* Grow the hall to fit — never shrink a plan someone may have sized. */
    const needW = Math.ceil((ft(hall.width_ft) || 0) / 5) * 5;
    const needH = Math.ceil((ft(hall.height_ft) || 0) / 5) * 5;
    if (needW > FP.plan.width) FP.plan.width = needW;
    if (needH > FP.plan.height) FP.plan.height = needH;

    const real = specs.map((s) => {
      const el = FP.makeElement(s.kind, s.geometry);
      Object.assign(el.props, s.props);
      return el;
    });
    /* one undo step for the whole conversion — the snapshot above
       covers the plan resize too */
    FP.addElements(real, { snapshot: false, select: false });

    return {
      walls: (data.walls || []).length,
      doors: (data.doors || []).length,
      booths: (data.booths || []).length,
      zones: (data.zones || []).length,
      labels: (data.labels || []).length,
      scaleBasis: hall.scale_basis || '',
    };
  }

  /**
   * Full pipeline: photo File → edge function → elements on the plan.
   * Resolves to the counts from apply(), or { error }.
   */
  async function convert(file, { widthHint, onStatus } = {}) {
    try {
      onStatus?.('Preparing the photo…');
      const { image, media_type } = await prepareImage(file);

      onStatus?.('Reading the floor plan — this can take a minute…');
      const res = await FP.auth.callFn('plan-from-photo', {
        image, media_type,
        width_hint: widthHint > 0 ? widthHint : undefined,
      });
      if (res.error) return { error: res.error };
      if (!res.plan) return { error: 'The AI returned no plan data' };

      onStatus?.('Building the plan…');
      return apply(res.plan, widthHint);
    } catch (e) {
      return { error: e?.message || 'Conversion failed' };
    }
  }

  FP.photoplan = { convert, apply };
})(window);
