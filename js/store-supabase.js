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
    z: index,
  });

  const fromRow = (row) => ({
    id: row.id,
    kind: row.kind,
    shape: row.shape,
    layer: row.layer,
    parentId: row.parent_id || null,
    geometry: row.geometry || {},
    props: row.props || {},
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
      return planFromRows(show, rows);
    },

    async put(plan) {
      const sb = FP.auth.client();
      if (!sb) throw new Error('Not connected');
      if (!FP.auth.signedIn()) throw new Error('Sign in to save to the cloud');

      const doc = normalise(plan);

      /* The show row is staff territory — clients hold element-level
         rights only. Writing it from a client session dies on RLS and
         took the whole save down with it, so their furniture moves
         never reached the cloud. Elements are the client's edit. */
      if (FP.auth.canEdit?.()) {
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

      /* Parents must exist before children, or the parent_id FK fails. */
      const parents = rows.filter((r) => !r.parent_id);
      const children = rows.filter((r) => r.parent_id);
      for (const batch of [parents, children]) {
        if (!batch.length) continue;
        const { error } = await sb.from('element').upsert(batch);
        if (error) throw new Error(error.message);
      }

      /* Remove anything deleted since the last save. Diffing against the
         stored ids keeps the delete bounded — a `not.in` filter carrying
         every current id would blow past URL length on a real floor.
         Client sessions diff only against rows they may write, so the
         structure they can't touch is never flagged stale. */
      const existing = await allElements(sb, doc.id, 'id, layer, kind');
      const keep = new Set(rows.map((r) => r.id));
      const stale = (existing || [])
        .filter((r) => !isClient || editable(r))
        .map((r) => r.id)
        .filter((id) => !keep.has(id));
      if (stale.length) {
        const { error } = await sb.from('element').delete().in('id', stale);
        if (error) console.warn('Could not prune deleted elements', error.message);
      }

      try { localStorage.setItem(LAST_KEY, doc.id); } catch {}

      /* Hand the normalised ids back so the in-memory plan matches the
         database and the next save is an update rather than a duplicate. */
      return doc;
    },

    async remove(id) {
      const sb = FP.auth.client();
      if (!sb) return;
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
