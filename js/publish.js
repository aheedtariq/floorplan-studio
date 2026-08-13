/* ============================================================
   publish.js — building the public document.

   The working plan and the public plan are DIFFERENT DOCUMENTS. The
   viewer never receives the working plan with fields hidden by CSS; it
   receives a separate object that was built by copying across an
   explicit allow-list. Anything not named here simply does not exist in
   what gets served.

   That matters because the plan carries things nobody outside the
   organisation should have: exhibitor contact emails, internal notes,
   which booths are unsold or in dispute, and the connector/hours fields
   that are billing-relevant.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});
  const C = FP.config;

  const PUBLIC_KEY = 'fps.public.v1';

  /* Allow-lists. A key absent here never reaches the public document. */
  const SPACE_KEYS = ['number', 'exhibitor', 'spaceType'];
  const GENERAL_KEYS = ['label', 'text', 'fontSize', 'color'];

  /* Whole categories the public has no business seeing. Power topology
     and utility drops are operational, and they carry pricing signals. */
  const PRIVATE_LAYERS = new Set(['electrical', 'utilities']);

  /** Public-facing categories an exhibitor might be listed under. */
  const publicCategory = (space) =>
    (space.props.publicCategory || '').trim();

  function stripElement(el) {
    const isSpace = C.flag(el.kind, 'sellable');
    const keys = isSpace ? [...SPACE_KEYS, ...GENERAL_KEYS] : GENERAL_KEYS;

    const props = {};
    for (const k of keys) {
      if (el.props[k] !== undefined && el.props[k] !== '') props[k] = el.props[k];
    }
    if (isSpace) {
      const cat = publicCategory(el);
      if (cat) props.publicCategory = cat;
      /* Assigned-vs-open is already implicit in whether a company is
         named, so the map may show it. The internal workflow state —
         held, awaiting info, changes needed — collapses away entirely:
         it never reaches the public document in any form, not even as
         a colour. */
      props.assigned = !!(el.props.exhibitor || '').trim();
      props.color = props.assigned ? '#7c5cfc' : '#94a3b8';
    }
    /* Nothing in the viewer is editable, so everything is locked. This
       also stops the shared renderer from drawing resize handles. */
    props.locked = true;

    return {
      id: el.id,
      kind: el.kind,
      shape: el.shape,
      layer: el.layer,
      parentId: el.parentId || null,
      geometry: { ...el.geometry },
      props,
    };
  }

  /**
   * Build the public document from a working plan.
   * @returns {object} a new plan object safe to serve publicly
   */
  FP.publishPublicSnapshot = (plan = FP.plan) => {
    const elements = plan.elements
      .filter((el) => !PRIVATE_LAYERS.has(el.layer))
      .map(stripElement);

    /* Drop orphans whose parent was filtered out. */
    const ids = new Set(elements.map((e) => e.id));
    const kept = elements.filter((e) => !e.parentId || ids.has(e.parentId));

    return {
      id: `pub_${plan.id}`,
      schema: plan.schema,
      public: true,
      name: plan.name,
      venue: plan.venue,
      hall: plan.hall,
      /* Only the public-facing date. Deadlines and freeze are internal. */
      dates: { open: plan.dates?.open || '' },
      unit: plan.unit,
      width: plan.width,
      height: plan.height,
      grid: plan.grid,
      revision: plan.revision || 1,
      publishedAt: Date.now(),
      layers: JSON.parse(JSON.stringify(plan.layers)),
      underlay: plan.underlay ? { ...plan.underlay, locked: true } : null,
      elements: kept,
      /* Explicitly not carried across: ruleConfig, fieldDefs, nextSpaceNo,
         created/updated, and every stripped prop above. */
    };
  };

  /** Publish to local storage. Phase 2 replaces this with a Supabase write. */
  FP.publish = (plan = FP.plan) => {
    const snapshot = FP.publishPublicSnapshot(plan);
    try {
      localStorage.setItem(PUBLIC_KEY, JSON.stringify(snapshot));
    } catch (err) {
      console.warn('Publish failed', err);
      return null;
    }
    return snapshot;
  };

  FP.readPublic = () => {
    try { return JSON.parse(localStorage.getItem(PUBLIC_KEY)) || null; }
    catch { return null; }
  };

  FP.PUBLIC_KEY = PUBLIC_KEY;

  /** What publishing would remove — shown in the confirmation dialog. */
  FP.publishAudit = (plan = FP.plan) => {
    const spaces = plan.elements.filter((e) => C.flag(e.kind, 'sellable') && !e.parentId);
    return {
      spaces: spaces.length,
      listed: spaces.filter((s) => (s.props.exhibitor || '').trim()).length,
      contactsRemoved: spaces.filter((s) => (s.props.contact || '').trim()).length,
      notesRemoved: plan.elements.filter((e) => (e.props.notes || '').trim()).length,
      elementsRemoved: plan.elements.filter((e) => PRIVATE_LAYERS.has(e.layer)).length,
    };
  };
})(window);
