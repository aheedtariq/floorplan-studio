/* ============================================================
   state.js — document model, editing scope, history, persistence.

   The document is a flat list of ELEMENTS. There is no separate booth
   model: a sellable footprint is an element of kind `space`, and the
   things inside it are elements carrying `parentId = <space element id>`.
   That is what lets one editor, one renderer and one rules engine serve
   both the hall and the booth interiors.

   Persistence goes through FP.store, an async adapter. Phase 2 swaps the
   localStorage implementation for Supabase without touching callers.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});
  const G = FP.geo;
  const C = FP.config;

  const STORE_KEY = 'fps.plans.v2';
  const LAST_KEY = 'fps.last.v2';
  const PREF_KEY = 'fps.prefs.v2';

  /* ---------------- event bus ---------------- */
  const listeners = {};
  FP.on = (evt, fn) => ((listeners[evt] = listeners[evt] || []).push(fn), fn);
  FP.emit = (evt, data) => (listeners[evt] || []).forEach((fn) => fn(data));

  /* ---------------- ids ---------------- */
  let seq = 0;
  /* Real UUIDs, because these ids become Postgres uuid primary keys the
     moment a plan is saved to the cloud. Generating them client-side means
     a plan drafted offline keeps its identity when it syncs — no
     rewriting of parent_id references on the way up. */
  FP.uid = () => {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    /* Fallback for older/insecure contexts: RFC 4122 v4 shape. */
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };
  void seq;

  FP.isUuid = (v) =>
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  const clone = (v) => JSON.parse(JSON.stringify(v));
  FP.clone = clone;

  /* ---------------- runtime state (not persisted) ---------------- */
  FP.state = {
    tool: 'select',
    armedKind: null,        // kind id the draw tools will create
    armedSize: null,        // [w,h] override from a preset
    selection: [],
    view: { x: -12, y: -12, zoom: 4 },   // world offset + px per world unit
    scope: { type: 'hall', spaceId: null },
    showGrid: true,
    /* How booths are coloured: replaces highlighting them by hand. */
    colorBy: 'status',
    snap: true,
    showLabels: true,
    dirty: false,
    drag: null,
    hover: null,
    draft: null,
    issues: [],
    filter: '',
  };

  /* ---------------- document ---------------- */
  FP.blankPlan = (name = 'Untitled Show') => ({
    id: FP.uid('plan'),
    schema: 2,
    name,
    venue: '',
    hall: '',
    dates: { loadIn: '', open: '', teardown: '', deadline: '', freeze: '' },
    unit: 'ft',
    width: 200,
    height: 120,
    grid: 5,
    nextSpaceNo: 101,
    elements: [],
    underlay: null,                 // { src, x, y, w, h, opacity }
    layers: C.layers.reduce((a, l) => ((a[l.id] = { visible: l.visible !== false, locked: !!l.locked }), a), {}),
    /* Per-show rule overrides, merged over the seed records at run time. */
    ruleConfig: {},
    /* Per-show custom form fields — same shape as kind field definitions. */
    fieldDefs: [],
    /* Bumped on every published revision; the crew diff compares these. */
    revision: 1,
    created: Date.now(),
    updated: Date.now(),
  });

  FP.plan = FP.blankPlan();

  /* ---------------- history ---------------- */
  const history = { past: [], future: [], limit: 100 };
  FP.history = history;

  /** Call BEFORE mutating the plan. */
  FP.snapshot = () => {
    history.past.push(clone(FP.plan));
    if (history.past.length > history.limit) history.past.shift();
    history.future.length = 0;
  };

  /** Call AFTER mutating the plan. */
  FP.changed = (opts = {}) => {
    FP.plan.updated = Date.now();
    FP.state.dirty = true;
    if (opts.recheck !== false) FP.recheck();
    FP.emit('change');
    scheduleSave();
  };

  FP.recheck = () => {
    FP.state.issues = FP.rules ? FP.rules.run(FP.plan) : [];
    return FP.state.issues;
  };

  FP.undo = () => {
    if (!history.past.length) return false;
    history.future.push(clone(FP.plan));
    FP.plan = history.past.pop();
    afterHistory();
    return true;
  };

  FP.redo = () => {
    if (!history.future.length) return false;
    history.past.push(clone(FP.plan));
    FP.plan = history.future.pop();
    afterHistory();
    return true;
  };

  function afterHistory() {
    const ids = new Set(FP.plan.elements.map((e) => e.id));
    FP.state.selection = FP.state.selection.filter((id) => ids.has(id));
    if (FP.state.scope.spaceId && !ids.has(FP.state.scope.spaceId)) FP.exitScope();
    FP.changed();
    FP.emit('select');
  }

  /* ---------------- element access ---------------- */
  FP.get = (id) => FP.plan.elements.find((e) => e.id === id);
  FP.selected = () => FP.state.selection.map(FP.get).filter(Boolean);
  FP.isSelected = (id) => FP.state.selection.includes(id);

  /** Elements belonging to the current editing scope. */
  FP.inScope = () => {
    const { type, spaceId } = FP.state.scope;
    return type === 'booth'
      ? FP.plan.elements.filter((e) => e.parentId === spaceId)
      : FP.plan.elements.filter((e) => !e.parentId);
  };

  FP.childrenOf = (spaceId) => FP.plan.elements.filter((e) => e.parentId === spaceId);
  FP.spaces = () => FP.plan.elements.filter((e) => C.flag(e.kind, 'sellable') && !e.parentId);

  /**
   * Total ordered load per space, summed from the power drops inside it.
   * Built in one pass because the renderer needs it for every space on
   * every paint, and walking the children per space would be quadratic.
   */
  FP.ampsBySpace = () => {
    const map = {};
    for (const el of FP.plan.elements) {
      if (!el.parentId || !C.flag(el.kind, 'power')) continue;
      map[el.parentId] = (map[el.parentId] || 0) + (Number(el.props.amps) || 0);
    }
    return map;
  };

  FP.spaceAmps = (spaceId) => FP.ampsBySpace()[spaceId] || 0;

  FP.select = (ids, additive = false) => {
    const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
    if (additive) {
      const s = new Set(FP.state.selection);
      list.forEach((id) => (s.has(id) ? s.delete(id) : s.add(id)));
      FP.state.selection = [...s];
    } else {
      FP.state.selection = list;
    }
    FP.emit('select');
    FP.emit('change');
  };

  FP.selectAll = () => FP.select(FP.inScope().filter((e) => !FP.isLocked(e)).map((e) => e.id));

  FP.isLocked = (el) => {
    const L = FP.plan.layers[el.layer];
    return !!(el.props?.locked || !L || L.locked || !L.visible);
  };
  FP.isVisible = (el) => {
    const L = FP.plan.layers[el.layer];
    return (!L || L.visible) && !el.props?.hidden;
  };

  /* ---------------- element construction ---------------- */

  /** Default props for a kind, taken from its field definitions. */
  FP.defaultProps = (kindId) => {
    const k = C.kind(kindId);
    const props = { label: '', notes: '', locked: false, hidden: false, color: k.fill };
    (k.fields || []).forEach((f) => {
      if (f.default !== undefined) props[f.key] = f.default;
    });
    return props;
  };

  /**
   * Build an element. `geometry` overrides the kind's defaults;
   * `parentId` puts it inside a booth footprint.
   */
  FP.makeElement = (kindId, geometry = {}, parentId = null) => {
    const k = C.kind(kindId);
    const el = {
      id: FP.uid(),
      kind: k.id,
      shape: k.shape,
      layer: k.layer,
      parentId,
      geometry: {},
      props: FP.defaultProps(kindId),
    };

    switch (k.shape) {
      case 'rect': {
        const [w, h] = k.size || [10, 10];
        el.geometry = { x: 0, y: 0, w, h, rot: 0, ...geometry };
        break;
      }
      case 'poly':
        el.geometry = { pts: [], ...geometry };
        break;
      case 'line':
        el.geometry = { x1: 0, y1: 0, x2: 10, y2: 0, thickness: k.thickness ?? 0.5, ...geometry };
        break;
      case 'marker':
        el.geometry = { x: 0, y: 0, r: k.r || 1.2, ...geometry };
        break;
      case 'text':
        el.geometry = { x: 0, y: 0, rot: 0, ...geometry };
        break;
      default:
        el.geometry = { x: 0, y: 0, ...geometry };
    }

    if (C.flag(k.id, 'sellable')) {
      el.props.number = String(FP.plan.nextSpaceNo++);
      el.props.status = 'available';
      el.props.exhibitor = '';
      el.props.contact = '';
    }
    return el;
  };

  FP.addElements = (els, { snapshot = true, select = true } = {}) => {
    const list = Array.isArray(els) ? els : [els];
    if (!list.length) return [];
    if (snapshot) FP.snapshot();
    FP.plan.elements.push(...list);
    if (select) FP.state.selection = list.map((e) => e.id);
    FP.changed();
    FP.emit('select');
    return list;
  };

  FP.removeSelected = () => {
    const del = new Set(FP.state.selection);
    const removable = FP.plan.elements.filter((e) => del.has(e.id) && !FP.isLocked(e));
    if (!removable.length) return 0;
    FP.snapshot();
    /* Deleting a space takes its contents with it. */
    const kill = new Set(removable.map((e) => e.id));
    FP.plan.elements.forEach((e) => { if (e.parentId && kill.has(e.parentId)) kill.add(e.id); });
    FP.plan.elements = FP.plan.elements.filter((e) => !kill.has(e.id));
    FP.state.selection = [];

    /* Deleting the booth you are standing inside would leave the editor
       scoped to an element that no longer exists: the catalog, the
       renderer and the rules would all be looking at a dead id, with no
       obvious way back to the hall. Step out first. Undo/redo guards the
       same case in afterHistory(). */
    if (FP.state.scope.spaceId && kill.has(FP.state.scope.spaceId)) {
      FP.state.scope = { type: 'hall', spaceId: null };
      FP.emit('scope');
    }

    FP.changed();
    FP.emit('select');
    return kill.size;
  };

  /** Deep copy with fresh ids, offset, and re-numbered spaces. */
  FP.duplicate = (els, dx = 5, dy = 5) => {
    const idMap = {};
    const copies = els.map((el) => {
      const c = clone(el);
      c.id = FP.uid();
      idMap[el.id] = c.id;
      c.geometry = G.translate(c.geometry, c.shape, dx, dy);
      if (C.flag(c.kind, 'sellable')) c.props.number = String(FP.plan.nextSpaceNo++);
      return c;
    });
    /* Carry contents along when a space is duplicated. */
    const extra = [];
    els.forEach((el) => {
      if (!C.flag(el.kind, 'sellable')) return;
      FP.childrenOf(el.id).forEach((child) => {
        const c = clone(child);
        c.id = FP.uid();
        c.parentId = idMap[el.id];
        c.geometry = G.translate(c.geometry, c.shape, dx, dy);
        extra.push(c);
      });
    });
    return [...copies, ...extra];
  };

  FP.duplicateSelected = (dx = 5, dy = 5) => {
    const src = FP.selected();
    if (!src.length) return;
    const copies = FP.duplicate(src, dx, dy);
    FP.snapshot();
    FP.plan.elements.push(...copies);
    /* Select the copied elements themselves, not the contents dragged along. */
    FP.state.selection = copies.slice(0, src.length).map((c) => c.id);
    FP.changed();
    FP.emit('select');
  };

  FP.moveElement = (el, dx, dy) => {
    el.geometry = G.translate(el.geometry, el.shape, dx, dy);
  };

  /** Moving a space drags its contents with it. */
  FP.moveElementDeep = (el, dx, dy) => {
    FP.moveElement(el, dx, dy);
    if (C.flag(el.kind, 'sellable')) FP.childrenOf(el.id).forEach((c) => FP.moveElement(c, dx, dy));
  };

  FP.setZ = (dir) => {
    const sel = FP.selected();
    if (!sel.length) return;
    FP.snapshot();
    const ids = new Set(sel.map((e) => e.id));
    const rest = FP.plan.elements.filter((e) => !ids.has(e.id));
    FP.plan.elements = dir === 'front' ? [...rest, ...sel] : [...sel, ...rest];
    FP.changed();
  };

  /** Patch props on every selected element. */
  FP.patchSelected = (patch, { snapshot = true } = {}) => {
    const sel = FP.selected();
    if (!sel.length) return;
    if (snapshot) FP.snapshot();
    sel.forEach((el) => Object.assign(el.props, patch));
    FP.changed();
  };

  FP.patchGeometry = (el, patch, { snapshot = true } = {}) => {
    if (snapshot) FP.snapshot();
    Object.assign(el.geometry, patch);
    FP.changed();
  };

  /* ---------------- editing scope ---------------- */
  FP.enterScope = (spaceId) => {
    const space = FP.get(spaceId);
    if (!space || !C.flag(space.kind, 'sellable')) return false;
    FP.state.scope = { type: 'booth', spaceId };
    FP.state.selection = [];
    FP.state.armedKind = null;
    FP.emit('scope');
    FP.emit('select');
    FP.emit('change');
    return true;
  };

  FP.exitScope = () => {
    const prev = FP.state.scope.spaceId;
    FP.state.scope = { type: 'hall', spaceId: null };
    FP.state.selection = prev ? [prev] : [];
    FP.emit('scope');
    FP.emit('select');
    FP.emit('change');
  };

  FP.scopeSpace = () => (FP.state.scope.spaceId ? FP.get(FP.state.scope.spaceId) : null);

  /* ---------------- reference image (underlay) ----------------
     Each scope gets its own tracing image: the hall keeps one on the
     plan, and a booth keeps one on the space's props — so an exhibitor
     can upload their own booth CAD without touching the hall drawing.
     Both hosts store it under the same `underlay` key.
     ------------------------------------------------------------ */
  FP.underlayHost = () => {
    const sp = FP.scopeSpace();
    return sp ? sp.props : FP.plan;
  };
  FP.getUnderlay = () => FP.underlayHost().underlay || null;
  FP.setUnderlay = (u) => { FP.underlayHost().underlay = u; };

  /**
   * Rescale the reference image so a drawn distance equals a real one,
   * holding the calibration start point fixed.
   */
  FP.calibrateUnderlay = (px, py, drawnLength, realLength) => {
    const u = FP.getUnderlay();
    if (!u || !drawnLength || !realLength) return null;
    const scale = realLength / drawnLength;
    FP.snapshot();
    u.w *= scale;
    u.h *= scale;
    u.x = px - (px - u.x) * scale;
    u.y = py - (py - u.y) * scale;
    u.calibrated = true;
    /* Lock it so tracing can't nudge the thing you just calibrated. */
    u.locked = true;
    FP.changed();
    return scale;
  };

  /* ---------------- clipboard ---------------- */
  FP.clipboard = null;
  FP.copy = () => {
    const sel = FP.selected();
    if (sel.length) FP.clipboard = clone(sel);
    return sel.length;
  };
  FP.cut = () => {
    const n = FP.copy();
    if (n) FP.removeSelected();
    return n;
  };
  FP.paste = () => {
    if (!FP.clipboard?.length) return;
    const parentId = FP.state.scope.spaceId;
    const copies = FP.duplicate(FP.clipboard, 5, 5).map((c) => ({ ...c, parentId: c.parentId ?? parentId }));
    FP.snapshot();
    FP.plan.elements.push(...copies);
    FP.state.selection = copies.map((c) => c.id);
    FP.changed();
    FP.emit('select');
  };

  /* ---------------- persistence adapter ----------------
     Async on purpose: the Supabase implementation in phase 2 drops in
     behind this same surface.
     ------------------------------------------------------ */
  const localStore = {
    id: 'local',
    _read() {
      try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
      catch { return {}; }
    },
    _write(store) {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    },
    async list() {
      return Object.values(this._read()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    },
    async get(id) {
      return this._read()[id] || null;
    },
    async put(plan) {
      const store = this._read();
      store[plan.id] = plan;
      this._write(store);
      localStorage.setItem(LAST_KEY, plan.id);
      return plan;
    },
    async remove(id) {
      const store = this._read();
      delete store[id];
      this._write(store);
    },
    lastId: () => localStorage.getItem(LAST_KEY),
  };

  FP.store = localStore;

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => FP.save(), 700);
  }

  FP.save = async () => {
    try {
      await FP.store.put(clone(FP.plan));
      FP.state.dirty = false;
      FP.emit('saved');
    } catch (e) {
      console.warn('Save failed', e);
      FP.emit('save-error', e);
    }
  };

  FP.listPlans = () => FP.store.list();

  FP.loadPlan = (plan) => {
    FP.plan = FP.migrate(clone(plan));
    history.past.length = 0;
    history.future.length = 0;
    FP.state.selection = [];
    FP.state.scope = { type: 'hall', spaceId: null };
    FP.recheck();
    FP.emit('plan-loaded');
    FP.emit('scope');
    FP.emit('select');
    FP.emit('change');
  };

  FP.openPlan = async (id) => {
    const p = await FP.store.get(id);
    if (!p) return false;
    FP.loadPlan(p);
    return true;
  };

  FP.deletePlan = (id) => FP.store.remove(id);

  /** Fill in fields added after a plan was written; upgrade v1 documents. */
  FP.migrate = (p) => {
    const base = FP.blankPlan();

    /* v1 stored flat objects with geometry on the root and no props bag. */
    if (p.objects && !p.elements) {
      p.elements = p.objects.map((o) => {
        const { id, kind, shape, layer, x, y, w, h, rot, pts, x1, y1, x2, y2,
                thickness, r, text, fontSize, ...rest } = o;
        const geometry = {};
        ['x', 'y', 'w', 'h', 'rot', 'pts', 'x1', 'y1', 'x2', 'y2', 'thickness', 'r']
          .forEach((k) => { if (o[k] !== undefined) geometry[k] = o[k]; });
        const el = {
          id, kind: kind === 'booth' ? 'space' : kind,
          shape: shape || C.kind(kind).shape,
          layer: layer === 'booths' ? 'spaces' : layer || C.kind(kind).layer,
          parentId: null, geometry,
          props: { ...rest, label: rest.name || '', number: rest.boothNo, text, fontSize },
        };
        delete el.props.name; delete el.props.boothNo;
        return el;
      });
      delete p.objects;
      p.nextSpaceNo = p.nextBooth || 101;
    }

    const out = Object.assign({}, base, p);
    out.dates = Object.assign({}, base.dates, p.dates || {});
    out.layers = Object.assign({}, base.layers, p.layers || {});
    out.ruleConfig = Object.assign({}, p.ruleConfig || {});
    out.elements = (p.elements || []).map((el) => {
      const k = C.kind(el.kind);
      return {
        parentId: null,
        layer: k.layer,
        shape: k.shape,
        ...el,
        geometry: { ...el.geometry },
        props: { ...FP.defaultProps(el.kind), ...el.props },
      };
    });
    /* Ids became uuids when the cloud store landed, because they are used
       directly as Postgres primary keys. Rewrite any older id here — and
       every parentId pointing at one — so a plan drafted before that
       change uploads with its booth interiors still attached. Doing it at
       load time means it happens once, not on every save. */
    const idMap = {};
    const remap = (old) => {
      if (!old) return null;
      if (FP.isUuid(old)) return old;
      if (!idMap[old]) idMap[old] = FP.uid();
      return idMap[old];
    };
    if (!FP.isUuid(out.id)) out.id = remap(out.id);
    out.elements.forEach((el) => {
      el.id = remap(el.id);
      el.parentId = el.parentId ? remap(el.parentId) : null;
    });

    out.schema = 2;
    return out;
  };

  FP.lastPlanId = () => FP.store.lastId?.();

  /* ---------------- preferences ---------------- */
  FP.prefs = (() => {
    try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
  })();
  FP.setPref = (k, v) => {
    FP.prefs[k] = v;
    try { localStorage.setItem(PREF_KEY, JSON.stringify(FP.prefs)); } catch {}
  };

  /* ---------------- derived ---------------- */
  FP.stats = () => {
    const spaces = FP.spaces();
    const byStatus = {};
    C.statuses.forEach((s) => (byStatus[s.id] = 0));
    spaces.forEach((s) => {
      const k = s.props.status || 'available';
      byStatus[k] = (byStatus[k] || 0) + 1;
    });
    const sellable = spaces.reduce((sum, s) => sum + G.area(s), 0);
    const hall = FP.plan.width * FP.plan.height;
    const dead = FP.plan.elements
      .filter((e) => !e.parentId && C.flag(e.kind, 'unsellable'))
      .reduce((sum, e) => sum + G.area(e), 0);
    const complete = spaces.filter((s) => C.status(s.props.status)?.complete).length;
    return {
      total: spaces.length,
      byStatus,
      complete,
      outstanding: spaces.length - complete,
      sellable, hall, dead,
      utilization: hall ? sellable / hall : 0,
    };
  };
})(window);
