/* ============================================================
   main.js — bootstrap.

   Wires the modules together and decides what to open: the plan you
   were last editing, else the most recent saved plan, else the worked
   example so the app never opens on a blank canvas.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  async function boot() {
    /* theme before first paint */
    document.documentElement.dataset.theme = FP.prefs.theme || 'light';
    if (FP.prefs.colorBy) FP.state.colorBy = FP.prefs.colorBy;

    const canvas = document.getElementById('canvas');
    FP.render.init(canvas);
    FP.initInteractions(canvas);
    FP.initUI();

    /* Restore any Supabase session before choosing a store, so a signed-in
       user lands on their cloud plans rather than briefly on local ones.
       Never let a backend problem stop the editor from opening. */
    try {
      await FP.auth?.init?.();
    } catch (e) {
      console.warn('Auth init failed', e);
    }
    /* Every page is walled: the Studio needs a signed-in session. The
       real protection is RLS — this keeps signed-out visitors from even
       seeing the app shell. */
    if (!FP.auth?.signedIn?.()) {
      location.replace('login.html');
      return;
    }
    /* A ?plan= deep link (from the dashboard) implies the cloud store,
       whatever the stored preference says. */
    const deepLink = new URLSearchParams(location.search).has('plan');
    if (FP.prefs.store === 'supabase' || deepLink || !FP.prefs.store) {
      FP.useStore('supabase');
    }
    FP.syncAccountBadge?.();
    FP.on('auth', () => FP.syncAccountBadge?.());
    FP.on('store-changed', () => FP.syncAccountBadge?.());

    await openInitialPlan();

    /* A dashboard-created plan can carry a template to build on first
       open. Only ever on an EMPTY plan — a reload after building finds
       elements and does nothing, even if the param survived. */
    const tplKey = new URLSearchParams(location.search).get('template');
    if (tplKey && FP.templates?.[tplKey] && !(FP.plan.elements || []).length) {
      FP.templates[tplKey].build();
      history.replaceState(null, '',
        `${location.pathname}?plan=${encodeURIComponent(FP.plan.id)}`);
      await FP.save();
      FP.toast?.(`${FP.templates[tplKey].name} built — make it this show's own`);
    }

    FP.render.fit();
    FP.renderAll();

    /* dashboard hand-offs — checked at boot AND on hash changes, because
       navigating to an already-open editor with #admin only fires
       hashchange, and some hosts apply the fragment after load */
    const maybeAdmin = () => {
      if (location.hash !== '#admin') return;
      /* the admin panel is its own page now */
      location.replace('admin.html');
    };
    maybeAdmin();
    window.addEventListener('hashchange', maybeAdmin);

    /* Autosave is debounced; make sure a pending write lands on exit. */
    window.addEventListener('beforeunload', () => {
      if (FP.state.dirty) FP.save();
    });
  }

  async function openInitialPlan() {
    let plan = null;
    try {
      /* dashboard deep link wins over "whatever was open last" */
      const wanted = new URLSearchParams(location.search).get('plan');
      if (wanted) plan = await FP.store.get(wanted);
      if (!plan) {
        const lastId = FP.lastPlanId();
        if (lastId) plan = await FP.store.get(lastId);
      }
      if (!plan) plan = (await FP.store.list())[0] || null;
    } catch (e) {
      console.warn('Could not read saved plans', e);
    }

    if (!plan) {
      plan = FP.samplePlan();
      FP.loadPlan(plan);
      await FP.save();
      return;
    }
    FP.loadPlan(plan);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
