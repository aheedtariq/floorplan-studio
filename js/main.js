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
    document.documentElement.dataset.theme = FP.prefs.theme || 'dark';

    const canvas = document.getElementById('canvas');
    FP.render.init(canvas);
    FP.initInteractions(canvas);
    FP.initUI();

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
