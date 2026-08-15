/* ============================================================
   heartbeat.js — presence reporting.

   Every signed-in page pings its own row in `presence` once a minute
   (and on wake), recording where the user is and which plan they have
   open. The admin page reads recency to say who's on right now.
   Fire-and-forget throughout: presence must never break the app.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  let timer = null;

  async function beat() {
    try {
      const sb = FP.auth?.client?.();
      if (!sb || !FP.auth.signedIn?.()) return;
      const user = FP.auth.user();
      const p = FP.auth.profile?.();
      const page = (location.pathname.split('/').pop() || 'index.html').replace('.html', '') || 'index';
      /* a plan is only "what they're doing" on pages that open plans —
         state.js's blank default must not read as an open document */
      const urlPlan = new URLSearchParams(location.search).get('plan');
      const planId = urlPlan
        || (['index', 'portal'].includes(page) && FP.isUuid?.(FP.plan?.id) ? FP.plan.id : null);
      await sb.from('presence').upsert({
        user_id: user.id,
        email: p?.email || user.email || null,
        role: p?.role || null,
        page,
        plan_id: planId && FP.isUuid?.(planId) ? planId : null,
        plan_name: planId ? FP.plan?.name || null : null,
        last_seen: new Date().toISOString(),
      });
    } catch { /* presence is best-effort */ }
  }

  function start() {
    if (timer) return;
    beat();
    timer = setInterval(beat, 60_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') beat();
    });
  }

  /* start as soon as a session exists; auth fires on boot and sign-in */
  FP.on?.('auth', ({ session } = {}) => { if (session) start(); });
  if (FP.auth?.signedIn?.()) start();
  /* the first beat can outrun the plan fetch — beat again once it lands
     so the board says WHICH plan, not "Untitled Show" */
  FP.on?.('plan-loaded', () => { if (timer) beat(); });
})(window);
