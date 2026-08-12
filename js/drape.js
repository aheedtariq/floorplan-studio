/* ============================================================
   drape.js — pipe & drape, and the material takeoff.

   On the working plans this replaces, the drape counts are written in
   the margin by hand: "8 BLACK DRAPE = 83", "3 BLACK DRAPE = 205",
   "147 qty 3' high back wall", "96 qty 8' high". Someone measures the
   runs off the drawing, multiplies, and writes a number that is wrong the
   moment a booth moves.

   The runs are already on the plan as geometry. The counts should be
   derived from them, not recounted — so a booth moving changes the order
   automatically.

   What a run needs, per standard pipe & drape:
     panels     one per section (a section is one crossbar span)
     crossbars  one per section
     uprights   sections + 1  (a post at each joint, plus the far end)
     bases      one per upright
   Runs are grouped by height and colour, because that is how drape is
   ordered and priced — an 8 ft back wall and a 3 ft side rail are
   different line items.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});
  const G = FP.geo;
  const C = FP.config;

  const D = (FP.drape = {});

  const isDrape = (el) => C.flag(el.kind, 'drape');

  D.runs = (plan = FP.plan) => (plan.elements || []).filter(isDrape);

  const ROLE_NAMES = {
    backwall: 'Back wall', siderail: 'Side rail',
    masking: 'Masking', stage: 'Stage surround',
  };

  /**
   * Group every drape run by height + colour and compute what has to be
   * ordered.
   *
   * Sections are counted PER RUN, not from the pooled length: two 15 ft
   * runs on 10 ft crossbars need four sections, not three, because you
   * cannot span a gap between two separate walls with one crossbar.
   */
  D.takeoff = (plan = FP.plan) => {
    const groups = {};
    let totalLength = 0;

    for (const el of D.runs(plan)) {
      const len = G.length(el);
      if (!len) continue;

      const height = String(el.props.drapeHeight ?? 8);
      const color = el.props.drapeColor || 'black';
      const role = el.props.drapeRole || 'backwall';
      const section = Number(el.props.sectionWidth) || 10;

      const key = `${height}|${color}`;
      const g = groups[key] || (groups[key] = {
        key, height: Number(height), color, roles: {},
        length: 0, sections: 0, uprights: 0, runs: 0, sectionWidth: section,
      });

      /* Whole sections per run — a part-section still costs a full one. */
      const sections = Math.max(1, Math.ceil(len / section - 1e-9));

      g.length += len;
      g.sections += sections;
      g.uprights += sections + 1;
      g.runs += 1;
      g.roles[role] = (g.roles[role] || 0) + len;
      totalLength += len;
    }

    const list = Object.values(groups).sort(
      (a, b) => b.height - a.height || a.color.localeCompare(b.color));

    return {
      groups: list,
      totalLength,
      totalPanels: list.reduce((n, g) => n + g.sections, 0),
      totalUprights: list.reduce((n, g) => n + g.uprights, 0),
      unit: plan.unit || 'ft',
    };
  };

  /** "8 ft black — back wall 240 ft, side rail 60 ft" */
  D.describe = (g, unit) => {
    const parts = Object.entries(g.roles)
      .sort((a, b) => b[1] - a[1])
      .map(([role, len]) => `${ROLE_NAMES[role] || role} ${G.fmtLen(len, unit)}`);
    return parts.join(' · ');
  };

  D.roleName = (id) => ROLE_NAMES[id] || id;

  /* ------------------------------------------------------------
     Deriving drape from the booth layout
     ------------------------------------------------------------ */

  /** Group booths into rows the same way the numbering does. */
  function rowsOf(spaces, tol = 2) {
    const rows = [];
    spaces
      .map((el) => ({ el, b: G.bbox(el) }))
      .sort((a, b) => a.b.y - b.b.y || a.b.x - b.b.x)
      .forEach((item) => {
        const row = rows.find((r) => Math.abs(r.y - item.b.y) <= tol);
        if (row) {
          row.items.push(item);
          row.bottom = Math.max(row.bottom, item.b.y + item.b.h);
        } else {
          rows.push({ y: item.b.y, bottom: item.b.y + item.b.h, items: [item] });
        }
      });
    rows.forEach((r) => r.items.sort((a, b) => a.b.x - b.b.x));
    return rows.sort((a, b) => a.y - b.y);
  }

  /**
   * Generate back walls and side rails from the booth layout.
   *
   * Two details that matter commercially:
   *
   *  · Back-to-back rows SHARE one back wall. Drawing a run for each
   *    would double the order — this is exactly the sort of error the
   *    hand count produces.
   *  · A side rail goes between neighbours, not at the ends of a row, and
   *    only where booths actually touch. An exhibitor on the end of a row
   *    has no neighbour to be separated from.
   *
   * Existing generated drape is replaced; anything drawn by hand is left
   * alone, marked by props.derived.
   */
  D.generate = ({ backHeight = '8', railHeight = '3', color = 'black',
                  sectionWidth = 10, sideRails = true } = {}) => {
    const spaces = FP.spaces();
    if (!spaces.length) return [];

    const rows = rowsOf(spaces);
    const tol = 2;
    const made = [];

    const addRun = (x1, y1, x2, y2, height, role) => {
      const el = FP.makeElement('drape', { x1, y1, x2, y2, thickness: 0.5 }, null);
      Object.assign(el.props, {
        drapeHeight: String(height), drapeColor: color, drapeRole: role,
        sectionWidth, derived: true,
        label: role === 'siderail' ? 'Side rail' : 'Back wall',
      });
      made.push(el);
    };

    const consumed = new Set();

    rows.forEach((row, i) => {
      if (consumed.has(i)) return;
      const next = rows[i + 1];
      const backToBack = next && Math.abs(next.y - row.bottom) <= tol;

      /* One back wall on the shared edge serves both rows. */
      const backY = backToBack ? row.bottom : row.y;
      const spanRows = backToBack ? [row, next] : [row];
      const x1 = Math.min(...spanRows.flatMap((r) => r.items.map((it) => it.b.x)));
      const x2 = Math.max(...spanRows.flatMap((r) => r.items.map((it) => it.b.x + it.b.w)));
      addRun(x1, backY, x2, backY, backHeight, 'backwall');
      if (backToBack) consumed.add(i + 1);

      /* Side rails between touching neighbours, on each row. */
      if (!sideRails) return;
      spanRows.forEach((r) => {
        for (let n = 0; n < r.items.length - 1; n += 1) {
          const a = r.items[n].b;
          const b = r.items[n + 1].b;
          if (Math.abs(b.x - (a.x + a.w)) > tol) continue;   /* gap: not neighbours */
          addRun(b.x, a.y, b.x, a.y + a.h, railHeight, 'siderail');
        }
      });
    });

    /* Replace only what a previous run of this generated. */
    FP.snapshot();
    FP.plan.elements = FP.plan.elements.filter(
      (e) => !(isDrape(e) && e.props.derived));
    FP.plan.elements.push(...made);
    FP.changed();
    return made;
  };
})(window);
