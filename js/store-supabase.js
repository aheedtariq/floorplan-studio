/* ============================================================
   store-supabase.js — the cloud implementation of FP.store.

   Same four methods as the localStorage adapter (list / get / put /
   remove), so nothing above it changes. FP.useStore() swaps between them
   at runtime; the editor never learns which one it is talking to.

   The mapping is deliberately boring, because the schema was built to
   mirror the client model:

     plan            -> one `show` row
     plan.elements[] -> `element` rows, parent_id intact

   The one piece of real work is id normalisation. Plans drafted before
   the cloud existed carry ids like `el_m8x2k1`, which Postgres will not
   accept as uuid. normalise() rewrites those — and every parent_id that
   points at them — in one pass, so a legacy plan uploads without
   losing the parent/child structure that makes booth interiors work.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const LAST_KEY = 'fps.last.cloud.v1';

  /* Columns on `show` that mirror plan fields of the same meaning. */
  const SHOW_COLUMNS = {
    name: 'name',
    width: 'width',
    height: 'height',
    unit: 'unit',
    grid: 'grid',
    revision: 'revision',
    underlay: 'underlay',
  };

  /** Give every element and the plan itself a real uuid, keeping links. */
  function normalise(plan) {
    const map = {};
    const idFor = (old) => {
      if (!old) return null;
      if (FP.isUuid(old)) return old;
      if (!map[old]) map[old] = FP.uid();
      return map[old];
    };

    const out = FP.clone(plan);
    out.id = idFor(out.id) || FP.uid();
    out.elements = (out.elements || []).map((el) => ({
      ...el,
      id: idFor(el.id) || FP.uid(),
      parentId: el.parentId ? idFor(el.parentId) : null,
    }));
    return out;
  }

  const toRow = (plan, el, index) => ({
    id: el.id,
    show_id: plan.id,
    parent_id: el.parentId || null,
    kind: el.kind,
    shape: el.shape,
    layer: el.layer,
    geometry: el.geometry,
    props: el.props,
    z: el.z ?? index,
  });

  const fromRow = (row) => ({
    id: row.id,
    kind: row.kind,
    shape: row.shape,
    layer: row.layer,
    parentId: row.parent_id || null,
    geometry: row.geometry || {},
    props: row.props || {},
    z: row.z ?? 0,
  });

  function showRow(plan) {
    const row = { id: plan.id };
    for (const [planKey, col] of Object.entries(SHOW_COLUMNS)) {
      if (plan[planKey] !== undefined) row[col] = plan[planKey];
    }
    const d = plan.dates || {};
    row.load_in     = d.loadIn   || null;
    row.opens       = d.open     || null;
    row.teardown    = d.teardown || null;
    row.deadline    = d.deadline || null;
    row.freeze_date = d.freeze   || null;
    row.rule_config = plan.ruleConfig || {};
    row.field_defs  = plan.fieldDefs || [];
    return row;
  }

  /** Every element row for a show, paginated past PostgREST's 1,000-row
      cap. A furnished CAD floor passes 1,000 elements easily; reading a
      capped page and then "pruning" what the page didn't include is how
      plans silently lose furniture. */
  async function allElements(sb, showId, cols) {
    const out = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from('element').select(cols)
        .eq('show_id', showId).order('z').range(from, from + PAGE - 1);
      if (error) { console.warn('Could not read elements', error.message); break; }
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  function planFromRows(show, rows) {
    const base = FP.blankPlan(show.name || 'Untitled Show');
    return FP.migrate({
      ...base,
      id: show.id,
      name: show.name,
      width: Number(show.width),
      height: Number(show.height),
      unit: show.unit,
      grid: Number(show.grid),
      revision: show.revision,
      dates: {
        loadIn: show.load_in || '', open: show.opens || '',
        teardown: show.teardown || '', deadline: show.deadline || '',
        freeze: show.freeze_date || '',
      },
      ruleConfig: show.rule_config || {},
      fieldDefs: show.field_defs || [],
      underlay: show.underlay || null,
      elements: (rows || []).map(fromRow),
      updated: Date.parse(show.created_at) || Date.now(),
    });
  }

  /* ------------------------------------------------------------
     Save baseline — what the cloud last accepted, per plan. A save
     diffs against this in memory and writes only the rows that
     changed, instead of re-uploading the whole floor and reading
     every id back to find deletions.
     ------------------------------------------------------------ */
  const baseline = new Map();   /* plan id → { show, els: Map<id, {str, layer, kind}> } */

  function rememberBaseline(planId, showStr, rows) {
    const els = new Map();
    for (const r of rows) {
      els.set(r.id, { str: JSON.stringify(r), layer: r.layer, kind: r.kind });
    }
    baseline.set(planId, { show: showStr, els });
  }

  async function upsertChunked(sb, rows) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('element').upsert(rows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
  }

  async function deleteChunked(sb, ids) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await sb.from('element').delete().in('id', ids.slice(i, i + 200));
      if (error) console.warn('Could not prune deleted elements', error.message);
    }
  }

  /* ------------------------------------------------------------
     The adapter
     ------------------------------------------------------------ */
  const cloudStore = {
    id: 'supabase',

    async list() {
      const sb = FP.auth.client();
      if (!sb) return [];
      /* The plan cards need a thumbnail and a space count — booths only.
         Embedding EVERY element of EVERY show made this call crawl once
         real CAD floors existed (thousands of rows, megabytes of jsonb):
         the Plans button sat dead while the request dragged. Fetch shows
         plain, then just the booth rows, paginated. */
      const { data: shows, error } = await sb
        .from('show').select('*').order('created_at', { ascending: false });
      if (error) {
        console.warn('Could not list plans', error.message);
        return [];
      }
      const ids = (shows || []).map((s) => s.id);
      const spaces = [];
      const PAGE = 1000;
      for (let from = 0; ids.length; from += PAGE) {
        const { data, error: elErr } = await sb.from('element')
          .select('id, show_id, kind, shape, layer, parent_id, geometry, props')
          .eq('layer', 'spaces').in('show_id', ids)
          .range(from, from + PAGE - 1);
        if (elErr) { console.warn('Could not list booths', elErr.message); break; }
        spaces.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      const byShow = {};
      for (const row of spaces) (byShow[row.show_id] ||= []).push(row);
      return (shows || []).map((show) => planFromRows(show, byShow[show.id] || []));
    },

    async get(id) {
      const sb = FP.auth.client();
      if (!sb) return null;
      const { data: show, error } = await sb
        .from('show').select('*').eq('id', id).maybeSingle();
      if (error || !show) {
        if (error) console.warn('Could not read plan', error.message);
        return null;
      }
      const rows = await allElements(sb, id, '*');
      const plan = planFromRows(show, rows);
      /* seed the diff baseline from exactly what a save would produce */
      rememberBaseline(plan.id, JSON.stringify(showRow(plan)),
        plan.elements.map((el, i) => toRow(plan, el, i)));
      return plan;
    },

    async put(plan) {
      const sb = FP.auth.client();
      if (!sb) throw new Error('Not connected');
      if (!FP.auth.signedIn()) throw new Error('Sign in to save to the cloud');

      const doc = normalise(plan);
      const base = baseline.get(doc.id);
      const showStr = JSON.stringify(showRow(doc));

      /* The show row is staff territory — clients hold element-level
         rights only. Writing it from a client session dies on RLS and
         took the whole save down with it, so their furniture moves
         never reached the cloud. Elements are the client's edit. */
      const canEditShow = FP.auth.canEdit?.();
      if (canEditShow && (!base || base.show !== showStr)) {
        const { error: showErr } = await sb.from('show').upsert(showRow(doc));
        if (showErr) throw new Error(showErr.message);
      }

      /* Clients write only the rentals they arrange; the structure the
         floor is built from is upserted by staff sessions alone. This
         mirrors the element_client_write RLS boundary, so a client
         save never trips over rows it was never allowed to touch. */
      const isClient = FP.auth.isClient?.();
      const editable = (el) =>
        el.layer === 'contents' || ['carpet', 'turf', 'hanging-sign'].includes(el.kind);
      const writable = doc.elements.filter((el) => !isClient || editable(el));

      const rows = writable.map((el, i) => toRow(doc, el, i));
      const keep = new Set(rows.map((r) => r.id));

      /* With a baseline, the diff is pure memory: write rows whose JSON
         changed, delete ids the baseline knew that the plan no longer
         has. Without one (first save of a plan this page never loaded)
         fall back to the full write + read-back reconcile. */
      let changed = rows, stale = [];
      if (base) {
        changed = rows.filter((r) => base.els.get(r.id)?.str !== JSON.stringify(r));
        stale = [...base.els]
          .filter(([id, m]) => (!isClient || editable(m)) && !keep.has(id))
          .map(([id]) => id);
      } else {
        const existing = await allElements(sb, doc.id, 'id, layer, kind');
        stale = (existing || [])
          .filter((r) => !isClient || editable(r))
          .map((r) => r.id)
          .filter((id) => !keep.has(id));
      }

      /* Parents must exist before children, or the parent_id FK fails. */
      await upsertChunked(sb, changed.filter((r) => !r.parent_id));
      await upsertChunked(sb, changed.filter((r) => r.parent_id));
      if (stale.length) await deleteChunked(sb, stale);

      /* Only after every write landed — a failed save must leave the
         baseline alone so the next save retries the same diff. */
      rememberBaseline(doc.id, canEditShow ? showStr : (base?.show ?? showStr), rows);

      try { localStorage.setItem(LAST_KEY, doc.id); } catch {}

      /* Hand the normalised ids back so the in-memory plan matches the
         database and the next save is an update rather than a duplicate. */
      return doc;
    },

    async remove(id) {
      const sb = FP.auth.client();
      if (!sb) return;
      baseline.delete(id);
      /* element.show_id cascades, so deleting the show is enough. */
      const { error } = await sb.from('show').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    lastId: () => {
      try { return localStorage.getItem(LAST_KEY); } catch { return null; }
    },
  };

  /* The row <-> plan mapping is also what the exhibitor portal needs to
     turn the handful of rows RLS lets it see into a plan the renderer
     understands. Exported so there is exactly one mapping in the codebase. */
  FP.cloud = { planFromRows, fromRow, toRow, showRow, normalise };

  FP.stores = FP.stores || {};
  FP.stores.supabase = cloudStore;
  FP.stores.local = FP.store;          /* whatever state.js installed */

  /**
   * Swap the persistence layer at runtime.
   * @param {'local'|'supabase'} which
   */
  FP.useStore = (which) => {
    const next = FP.stores[which];
    if (!next) return false;
    FP.store = next;
    FP.setPref('store', which);
    FP.emit('store-changed', which);
    return true;
  };

  FP.storeId = () => FP.store?.id || 'local';
})(window);
