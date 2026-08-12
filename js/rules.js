/* ============================================================
   rules.js — the validation engine.

   Rule RECORDS live in config.js (and later in a Postgres `rule` table).
   This file only registers EVALUATORS, keyed by the record's `type`.
   A show tunes severity, params or enabled-ness as data; adding a
   genuinely new check is the only thing that needs code.

   Every evaluator returns { message, detail, ids } objects. The runner
   stamps on severity and rule identity. The same run() is meant to be
   called by the hall editor, the exhibitor portal and the ops dashboard,
   which is why it takes a plan rather than reading global state.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});
  const G = FP.geo;

  const EVAL = {};
  const SEV = { error: 0, warning: 1, info: 2 };

  /* ---------------- naming ---------------- */
  const C = () => FP.config;

  function label(el) {
    if (!el) return 'element';
    const cfg = C();
    if (cfg.flag(el.kind, 'sellable')) return `Booth ${el.props.number || '—'}`;
    return (el.props.label || '').trim() || cfg.kind(el.kind).name;
  }

  /* ---------------- evaluation context ---------------- */
  function buildContext(plan) {
    const cfg = C();
    const all = plan.elements;
    const hall = all.filter((e) => !e.parentId);
    const spaces = hall.filter((e) => cfg.flag(e.kind, 'sellable'));
    const children = {};
    all.forEach((e) => {
      if (!e.parentId) return;
      (children[e.parentId] = children[e.parentId] || []).push(e);
    });
    return {
      plan, cfg, all, hall, spaces, children,
      unit: plan.unit,
      childrenOf: (id) => children[id] || [],
      /* things that must not sit in a protected area */
      obstructors: hall.filter((e) =>
        cfg.flag(e.kind, 'sellable') || e.layer === 'amenities' || e.layer === 'contents'),
    };
  }

  /* ============================================================
     Evaluators
     ============================================================ */

  EVAL['no-overlap'] = (ctx) => {
    const out = [];
    const s = ctx.spaces;
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        if (G.elementsOverlap(s[i], s[j])) {
          out.push({
            message: `${label(s[i])} overlaps ${label(s[j])}`,
            detail: 'Two spaces cannot occupy the same floor area.',
            ids: [s[i].id, s[j].id],
          });
        }
      }
    }
    return out;
  };

  EVAL['inside-bounds'] = (ctx) => {
    const bounds = { x: 0, y: 0, w: ctx.plan.width, h: ctx.plan.height };
    const out = [];
    for (const el of ctx.hall) {
      if (el.layer === 'annotate' || el.layer === 'underlay') continue;
      if (!G.rectContains(bounds, G.bbox(el))) {
        out.push({
          message: `${label(el)} extends outside the hall`,
          detail: `Hall footprint is ${G.fmtDims(ctx.plan.width, ctx.plan.height, ctx.unit)}.`,
          ids: [el.id],
        });
      }
    }
    return out;
  };

  EVAL['not-on-blocking'] = (ctx) => {
    const out = [];
    const blockers = ctx.hall.filter((e) => ctx.cfg.flag(e.kind, 'blocking'));
    for (const b of blockers) {
      const obstruction = ctx.cfg.flag(b.kind, 'obstruction');
      for (const s of ctx.spaces) {
        if (!G.elementsOverlap(b, s)) continue;
        out.push({
          message: obstruction
            ? `${label(b)} sits inside ${label(s)}`
            : `${label(s)} is placed on ${label(b)}`,
          detail: obstruction
            ? 'Disclose the obstruction to the exhibitor before contracting the space.'
            : 'This area is not sellable — relocate the space.',
          /* An obstruction reduces usable area; it does not void the space. */
          severity: obstruction ? 'warning' : undefined,
          ids: [s.id, b.id],
        });
      }
    }
    return out;
  };

  EVAL['keep-clear'] = (ctx, rule) => {
    const out = [];
    const fallback = rule.params.defaultClearance ?? 10;
    const zones = ctx.hall.filter((e) => ctx.cfg.flag(e.kind, 'keepClear'));

    for (const z of zones) {
      /* Exits and doors project a clearance radius; lanes and paths are
         areas that simply must not be built on. */
      const radial = ctx.cfg.flag(z.kind, 'exit')
                  || ctx.cfg.flag(z.kind, 'entrance')
                  || ctx.cfg.flag(z.kind, 'panel');   /* NEC 110.26 working space */
      const clearance = radial ? Number(z.props.clearance ?? fallback) : 0;

      for (const o of ctx.obstructors) {
        if (o.id === z.id) continue;
        if (clearance > 0) {
          const gap = G.gapBetween(z, o);
          if (gap < clearance - 1e-6) {
            out.push({
              message: `${label(o)} encroaches on ${label(z)}`,
              detail: `${G.fmtLen(gap, ctx.unit)} clear — ${G.fmtLen(clearance, ctx.unit)} required in front of the opening.`,
              ids: [o.id, z.id],
            });
          }
        } else if (G.elementsOverlap(z, o)) {
          out.push({
            message: `${label(o)} obstructs ${label(z)}`,
            detail: 'This area must stay completely clear for the duration of the show.',
            ids: [o.id, z.id],
          });
        }
      }
    }
    return out;
  };

  EVAL['min-exit-count'] = (ctx, rule) => {
    const min = rule.params.min ?? 2;
    const exits = ctx.hall.filter((e) => ctx.cfg.flag(e.kind, 'exit'));
    if (exits.length >= min) return [];
    return [{
      message: exits.length
        ? `Only ${exits.length} fire exit${exits.length === 1 ? '' : 's'} marked — ${min} required`
        : 'No fire exits marked on this plan',
      detail: 'Place fire exits from the Life safety group so clearance can be checked.',
      ids: [],
    }];
  };

  EVAL['min-aisle-width'] = (ctx, rule) => {
    const min = rule.params.min ?? 10;
    const out = [];
    const s = ctx.spaces;
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        const a = s[i], b = s[j];
        const ba = G.bbox(a), bb = G.bbox(b);
        /* Only compare spaces that actually face each other on one axis;
           diagonal neighbours do not form an aisle. */
        const facing =
          (ba.x < bb.x + bb.w && ba.x + ba.w > bb.x) ||
          (ba.y < bb.y + bb.h && ba.y + ba.h > bb.y);
        if (!facing) continue;
        const gap = G.gapBetween(a, b);
        /* gap 0 means a shared back wall, which is legitimate */
        if (gap <= 0.01 || gap >= min - 1e-6) continue;
        out.push({
          message: `Aisle between ${label(a)} and ${label(b)} is too narrow`,
          detail: `${G.fmtLen(gap, ctx.unit)} clear — show minimum is ${G.fmtLen(min, ctx.unit)}.`,
          ids: [a.id, b.id],
        });
      }
    }
    return out;
  };

  EVAL['inside-footprint'] = (ctx) => {
    const out = [];
    for (const space of ctx.spaces) {
      const bounds = G.bbox(space);
      for (const child of ctx.childrenOf(space.id)) {
        if (child.layer === 'annotate') continue;
        if (!G.rectContains(bounds, G.bbox(child))) {
          out.push({
            message: `${label(child)} extends outside ${label(space)}`,
            detail: 'Everything an exhibitor builds must sit within their contracted footprint.',
            ids: [child.id, space.id],
          });
        }
      }
    }
    return out;
  };

  EVAL['height-limit'] = (ctx) => {
    const out = [];
    for (const space of ctx.spaces) {
      const type = ctx.cfg.spaceType(space.props.spaceType);
      for (const child of ctx.childrenOf(space.id)) {
        const h = Number(child.props.height);
        if (!h) continue;
        const limit = ctx.cfg.flag(child.kind, 'heightRegulated') ? type.maxHeight : type.maxHeight;
        if (h > limit + 1e-6) {
          out.push({
            message: `${label(child)} in ${label(space)} exceeds the height limit`,
            detail: `${h} ${ctx.unit} declared — ${type.name.toLowerCase()} spaces are limited to ${limit} ${ctx.unit}.`,
            ids: [child.id, space.id],
          });
        }
      }
    }
    return out;
  };

  EVAL['power-capacity'] = (ctx, rule) => {
    const out = [];
    const fallback = Number(rule.params.capacity) || 20;
    for (const space of ctx.spaces) {
      const drops = ctx.childrenOf(space.id).filter((e) => ctx.cfg.flag(e.kind, 'power'));
      if (!drops.length) continue;
      const draw = drops.reduce((s, d) => s + (Number(d.props.amps) || 0), 0);
      const cap = Number(space.props.capacity) || Number(drops[0].props.capacity) || fallback;
      if (draw > cap) {
        out.push({
          message: `${label(space)} draws more power than its circuit allows`,
          detail: `${draw} A requested against ${cap} A available — order additional service.`,
          ids: [space.id, ...drops.map((d) => d.id)],
        });
      }
    }
    return out;
  };

  EVAL['rigging-in-zone'] = (ctx) => {
    const zones = ctx.all.filter((e) => ctx.cfg.flag(e.kind, 'riggingZone'));
    if (!zones.length) return [];   /* no zones defined = no restriction */
    const out = [];
    const points = ctx.all.filter((e) => ctx.cfg.flag(e.kind, 'rigging'));
    for (const p of points) {
      const inside = zones.some((z) => G.rectContains(G.bbox(z), G.bbox(p)));
      if (!inside) {
        out.push({
          message: `${label(p)} is outside every rigging-allowed zone`,
          detail: 'Rigging may only be hung where the venue permits it.',
          ids: [p.id],
        });
      }
    }
    return out;
  };

  EVAL['required-fields'] = (ctx) => {
    const out = [];
    const missingExhibitor = [];

    for (const space of ctx.spaces) {
      const status = ctx.cfg.status(space.props.status);
      const contracted = status && status.id !== 'available';
      if (contracted && !(space.props.exhibitor || '').trim()) missingExhibitor.push(space.id);
    }
    if (missingExhibitor.length) {
      out.push({
        message: `${missingExhibitor.length} contracted ${missingExhibitor.length === 1 ? 'space has' : 'spaces have'} no exhibitor named`,
        detail: 'Add the company to every space that is held or sold.',
        ids: missingExhibitor,
      });
    }

    /* Field definitions marked required, wherever they appear. */
    for (const el of ctx.all) {
      const fields = ctx.cfg.kind(el.kind).fields || [];
      const missing = fields.filter((f) => f.required && !String(el.props[f.key] ?? '').trim());
      if (missing.length) {
        out.push({
          message: `${label(el)} is missing ${missing.map((f) => f.label.toLowerCase()).join(', ')}`,
          detail: 'Required before the submission can be accepted.',
          ids: [el.id],
        });
      }
    }
    return out;
  };

  EVAL['unique-numbers'] = (ctx) => {
    const out = [];
    const byNo = {};
    const unnumbered = [];
    for (const s of ctx.spaces) {
      const num = String(s.props.number ?? '').trim();
      if (!num) { unnumbered.push(s.id); continue; }
      (byNo[num] = byNo[num] || []).push(s);
    }
    for (const [num, list] of Object.entries(byNo)) {
      if (list.length > 1) {
        out.push({
          message: `Space number ${num} is used ${list.length} times`,
          detail: 'Renumber so every space is uniquely addressable.',
          ids: list.map((s) => s.id),
        });
      }
    }
    if (unnumbered.length) {
      out.push({
        message: `${unnumbered.length} space${unnumbered.length === 1 ? '' : 's'} without a number`,
        detail: 'Use Auto-number to fill the gaps.',
        ids: unnumbered,
      });
    }
    return out;
  };

  /* ============================================================
     Electrical

     Boards are referenced by ID, never by object link, so the topology
     is just strings on props: a drop cites `panelId: "D-1"`, a distro
     cites the panel feeding it. That survives JSON, matches the
     Postgres model, and lets a submission reference a board the
     exhibitor never touched.
     ============================================================ */

  /** Circular mils by AWG — the denominator of the voltage-drop formula. */
  const CIRCULAR_MILS = {
    '14': 4110, '12': 6530, '10': 10380, '8': 16510,
    '6': 26240, '4': 41740, '2': 66360, '1/0': 105600,
  };

  /** A board's own identifier: distros carry distroId, panels carry panelId. */
  const boardId = (el) => (el.props.distroId || el.props.panelId || '').trim();

  const boardsOf = (ctx) => ctx.all.filter((e) => ctx.cfg.flag(e.kind, 'panel'));
  const dropsOf = (ctx) => ctx.all.filter((e) => ctx.cfg.flag(e.kind, 'power'));

  /**
   * Connected load per board, with downstream distros rolled up into the
   * panel that feeds them. Cycle-guarded, because nothing stops someone
   * typing a board's own ID into its feed field.
   */
  function loadByBoard(ctx) {
    const boards = boardsOf(ctx);
    const byId = {};
    boards.forEach((b) => {
      const id = boardId(b);
      if (id) byId[id] = { board: b, direct: 0, drops: [], total: 0 };
    });

    for (const d of dropsOf(ctx)) {
      const id = (d.props.panelId || '').trim();
      if (!id || !byId[id]) continue;
      byId[id].direct += Number(d.props.amps) || 0;
      byId[id].drops.push(d);
    }

    /* Roll a distro's load up into whatever feeds it. */
    const resolve = (id, seen) => {
      const node = byId[id];
      if (!node || seen.has(id)) return 0;
      seen.add(id);
      let total = node.direct;
      for (const other of Object.values(byId)) {
        const oid = boardId(other.board);
        if (oid === id) continue;
        const feed = (other.board.props.panelId || '').trim();
        /* A distro's panelId names its feed; a panel's names itself. */
        if (feed === id && ctx.cfg.flag(other.board.kind, 'distro')) {
          total += resolve(oid, seen);
        }
      }
      node.total = total;
      return total;
    };
    Object.keys(byId).forEach((id) => resolve(id, new Set()));
    return byId;
  }

  /**
   * Percent voltage drop on a cable run.
   * Single phase VD = 2 × 12.9 × I × L / CM; three phase uses √3.
   */
  const voltageDrop = (el) => {
    const cm = CIRCULAR_MILS[el.props.gauge];
    const amps = Number(el.props.amps) || 0;
    const volts = Number(el.props.voltage) || 208;
    const len = G.length(el);
    if (!cm || !amps || !len || !volts) return null;
    const k = el.props.phase === '3' ? Math.sqrt(3) : 2;
    const vd = (k * 12.9 * amps * len) / cm;
    return { volts: vd, percent: (vd / volts) * 100, length: len };
  };

  EVAL['panel-load'] = (ctx, rule) => {
    const derate = rule.params.derate ?? 0.8;
    const out = [];
    const loads = loadByBoard(ctx);

    for (const [id, node] of Object.entries(loads)) {
      const cap = Number(node.board.props.mainAmps) || 0;
      if (!cap) continue;
      const pct = (node.total / cap) * 100;
      if (node.total <= cap * derate + 1e-6) continue;

      const over = node.total > cap;
      out.push({
        severity: over ? 'error' : 'warning',
        message: over
          ? `${id} is over capacity at ${Math.round(node.total)} A on a ${cap} A board`
          : `${id} is at ${Math.round(pct)}% of ${cap} A`,
        detail: over
          ? `${node.drops.length} connected drop${node.drops.length === 1 ? '' : 's'}. Move load to another board or upsize the service.`
          : `Continuous load should stay under ${Math.round(derate * 100)}% of the breaker (${Math.round(cap * derate)} A).`,
        ids: [node.board.id, ...node.drops.map((d) => d.id)],
      });
    }
    return out;
  };

  EVAL['unassigned-power'] = (ctx) => {
    const known = new Set(boardsOf(ctx).map(boardId).filter(Boolean));
    const out = [];

    for (const d of dropsOf(ctx)) {
      const id = (d.props.panelId || '').trim();
      const owner = d.parentId ? ctx.all.find((e) => e.id === d.parentId) : null;
      const where = owner ? ` in ${label(owner)}` : '';

      if (!id) {
        out.push({
          message: `${label(d)}${where} is not assigned to a panel`,
          detail: 'An unassigned drop cannot be ordered, scheduled or billed.',
          ids: [d.id],
        });
      } else if (!known.has(id)) {
        out.push({
          message: `${label(d)}${where} references unknown board “${id}”`,
          detail: 'No panel, distro or generator on this plan carries that ID.',
          ids: [d.id],
        });
      }
    }
    return out;
  };

  EVAL['voltage-drop'] = (ctx, rule) => {
    const max = rule.params.maxPercent ?? 3;
    const out = [];

    for (const run of ctx.all.filter((e) => ctx.cfg.flag(e.kind, 'cableRun'))) {
      const vd = voltageDrop(run);
      if (!vd || vd.percent <= max + 1e-6) continue;
      out.push({
        message: `${run.props.circuitId || label(run)} drops ${vd.percent.toFixed(1)}% over ${G.fmtLen(vd.length, ctx.unit)}`,
        detail: `${run.props.amps} A on ${run.props.gauge} AWG — limit is ${max}%. Upsize the conductor or shorten the run.`,
        ids: [run.id],
      });
    }
    return out;
  };

  /**
   * Every booth must back onto a bus.
   *
   * The floor is built on a 30 ft module — 10 ft booth, 10 ft aisle,
   * 10 ft booth — and buses are laid on that pitch so each booth reaches
   * the one behind it. A booth further than half the module from any bus
   * can only be fed by running cable across an aisle, which is a trip
   * hazard and will not pass a fire marshal.
   */
  EVAL['bus-reach'] = (ctx, rule) => {
    const module = rule.params.module ?? 30;
    const limit = rule.params.maxDistance ?? module / 2;

    const buses = ctx.hall.filter((e) => ctx.cfg.flag(e.kind, 'cableRun'));
    if (!buses.length) return [];

    const out = [];
    for (const sp of ctx.spaces) {
      /* Only booths that actually ordered power need to reach a bus. */
      const draw = ctx.childrenOf(sp.id)
        .filter((e) => ctx.cfg.flag(e.kind, 'power'))
        .reduce((sum, d) => sum + (Number(d.props.amps) || 0), 0);
      if (!draw) continue;

      let nearest = Infinity;
      for (const bus of buses) nearest = Math.min(nearest, G.gapBetween(sp, bus));
      if (nearest <= limit + 1e-6) continue;

      out.push({
        message: `${label(sp)} is ${G.fmtLen(nearest, ctx.unit)} from the nearest bus`,
        detail: `Feeding it would cross an aisle. Buses sit on a ${module} ft module `
              + `(booth + aisle + booth); add a run within ${G.fmtLen(limit, ctx.unit)}.`,
        ids: [sp.id],
      });
    }
    return out;
  };

  /* ============================================================
     Runner
     ============================================================ */
  const rules = {};

  /** Seed records merged with this show's overrides. */
  rules.records = (plan = FP.plan) => {
    const over = plan.ruleConfig || {};
    return C().rules.map((r) => {
      const o = over[r.id] || {};
      return { ...r, ...o, params: { ...r.params, ...(o.params || {}) } };
    });
  };

  rules.setOverride = (id, patch, plan = FP.plan) => {
    plan.ruleConfig = plan.ruleConfig || {};
    const cur = plan.ruleConfig[id] || {};
    plan.ruleConfig[id] = { ...cur, ...patch, params: { ...(cur.params || {}), ...(patch.params || {}) } };
  };

  rules.resetOverrides = (plan = FP.plan) => { plan.ruleConfig = {}; };

  /**
   * @param {object} plan
   * @param {object} [opts] – { scope: { type, spaceId } } narrows evaluation
   *        to a single footprint, which is what the exhibitor portal passes
   *        so an exhibitor only ever sees their own violations.
   */
  rules.run = (plan = FP.plan, opts = {}) => {
    if (!plan || !plan.elements) return [];
    const ctx = buildContext(plan);

    const boothScope = opts.scope?.type === 'booth' && !!opts.scope.spaceId;

    if (boothScope) {
      const sp = ctx.all.find((e) => e.id === opts.scope.spaceId);
      ctx.spaces = sp ? [sp] : [];
      ctx.obstructors = ctx.obstructors.filter((e) => e.id === opts.scope.spaceId);
    }

    const issues = [];

    for (const rec of rules.records(plan)) {
      if (!rec.enabled) continue;

      /* Hall-level rules must not run for a single booth. An exhibitor
         cannot see the fire exits, aisles or neighbouring stands those
         rules reason about — row level security hides them — so running
         one here would report "no fire exits on this plan" to someone who
         is simply not allowed to see them, and block a submission they
         have no way to fix. Scope is a property of the rule record, so a
         show can retune it without touching this file. */
      if (boothScope && rec.scope === 'hall') continue;

      const fn = EVAL[rec.type];
      if (!fn) continue;
      let found;
      try {
        found = fn(ctx, rec) || [];
      } catch (err) {
        console.warn(`rule "${rec.id}" (${rec.type}) failed`, err);
        continue;
      }
      for (const f of found) {
        issues.push({
          ruleId: rec.id,
          ruleName: rec.name,
          type: rec.type,
          /* A rule record sets the default severity, but an evaluator may
             downgrade an individual finding — a column inside a booth is
             worth disclosing, not blocking. */
          severity: f.severity || rec.severity,
          message: f.message,
          detail: f.detail || '',
          ids: f.ids || [],
        });
      }
    }

    issues.sort((a, b) => SEV[a.severity] - SEV[b.severity]);
    return issues;
  };

  /** element id -> worst severity, for drawing badges on the plan. */
  rules.byElement = (issues) => {
    const m = {};
    for (const i of issues) {
      for (const id of i.ids) {
        if (!m[id] || SEV[i.severity] < SEV[m[id]]) m[id] = i.severity;
      }
    }
    return m;
  };

  rules.counts = (issues) => ({
    error: issues.filter((i) => i.severity === 'error').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  });

  /** Errors block a submission; warnings only flag it. */
  rules.blocking = (issues) => issues.filter((i) => i.severity === 'error');

  rules.summary = rules.counts;

  /** Errors block submission; warnings only flag it. */
  rules.canSubmit = (issues) => rules.blocking(issues).length === 0;

  /** Register a new evaluator type. Rule RECORDS stay in config. */
  rules.register = (type, fn) => (EVAL[type] = fn);
  rules.types = () => Object.keys(EVAL);

  /* Exposed so the Electrical panel schedule and the exports compute
     load and voltage drop from exactly the same code as the rules. */
  rules.electrical = { loadByBoard, boardId, boardsOf, dropsOf, voltageDrop, CIRCULAR_MILS };
  rules.voltageDrop = voltageDrop;

  rules.label = label;
  rules.evaluators = EVAL;
  rules.severityOrder = SEV;

  FP.rules = rules;
})(window);
