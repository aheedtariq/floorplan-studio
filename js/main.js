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
      if (FP.auth?.signedIn?.() && FP.prefs.store === 'supabase') {
        FP.useStore('supabase');
      }
    } catch (e) {
      console.warn('Auth unavailable — continuing with local storage', e);
    }
    FP.syncAccountBadge?.();
    FP.on('auth', () => FP.syncAccountBadge?.());
    FP.on('store-changed', () => FP.syncAccountBadge?.());

    await openInitialPlan();

    FP.render.fit();
    FP.renderAll();

    /* Autosave is debounced; make sure a pending write lands on exit. */
    window.addEventListener('beforeunload', () => {
      if (FP.state.dirty) FP.save();
    });
  }

  async function openInitialPlan() {
    let plan = null;
    try {
      const lastId = FP.lastPlanId();
      if (lastId) plan = await FP.store.get(lastId);
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
