/* ============================================================
   backend.js — Supabase client and session.

   Deliberately thin. The app talks to FP.store for documents and FP.auth
   for identity; nothing else in the codebase imports the Supabase client
   directly, so the editor stays runnable with no backend at all.

   The publishable key below is safe in client source — it grants only
   what row level security allows, which for a signed-out visitor is
   nothing. Every real permission decision happens in Postgres.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  const CONFIG = {
    url: 'https://bvbjjawpmdfpkmasrcpk.supabase.co',
    key: 'sb_publishable_phh-vhvlqPg8YGEjuxIorw_hgn7bnAX',
  };
  FP.backendConfig = CONFIG;

  const A = (FP.auth = {});
  let client = null;
  let session = null;
  let profile = null;

  /** True when the Supabase SDK actually loaded. */
  A.available = () => typeof root.supabase?.createClient === 'function';

  A.client = () => {
    if (!A.available()) return null;
    if (!client) {
      client = root.supabase.createClient(CONFIG.url, CONFIG.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    }
    return client;
  };

  A.session = () => session;
  A.user = () => session?.user || null;
  A.profile = () => profile;
  A.role = () => profile?.role || null;
  A.signedIn = () => !!session;

  /* Mirrors private.can_edit() / private.is_staff() so the UI can hide
     what the database would refuse anyway. The database remains the
     authority; this is only about not showing dead buttons. */
  A.isStaff = () => ['admin', 'planner', 'sales', 'crew'].includes(A.role());
  A.canEdit = () => ['admin', 'planner'].includes(A.role());
  A.isAdmin = () => A.role() === 'admin';

  async function loadProfile() {
    const sb = A.client();
    if (!sb || !session) { profile = null; return null; }
    const { data, error } = await sb
      .from('profile')
      .select('id, email, full_name, role, active')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error) console.warn('Could not read profile', error.message);
    profile = data || null;
    return profile;
  }

  /** Call once at boot. Resolves after the stored session is restored. */
  A.init = async () => {
    const sb = A.client();
    if (!sb) return null;

    const { data } = await sb.auth.getSession();
    session = data?.session || null;
    if (session) await loadProfile();

    sb.auth.onAuthStateChange(async (_event, next) => {
      session = next || null;
      await loadProfile();
      FP.emit('auth', { session, profile });
    });

    FP.emit('auth', { session, profile });
    return session;
  };

  /* ---------------- sign in ---------------- */

  A.signInWithPassword = async (email, password) => {
    const sb = A.client();
    if (!sb) return { error: 'Supabase SDK not loaded' };
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    session = data.session;
    await loadProfile();
    FP.emit('auth', { session, profile });
    return { session };
  };

  /** Magic link — the path exhibitors will use in phase 3. */
  A.signInWithMagicLink = async (email) => {
    const sb = A.client();
    if (!sb) return { error: 'Supabase SDK not loaded' };
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: root.location.origin + root.location.pathname },
    });
    return error ? { error: error.message } : { sent: true };
  };

  A.signUpWithPassword = async (email, password, fullName) => {
    const sb = A.client();
    if (!sb) return { error: 'Supabase SDK not loaded' };
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: fullName || '' } },
    });
    if (error) return { error: error.message };
    session = data.session || null;
    if (session) await loadProfile();
    FP.emit('auth', { session, profile });
    return { session, needsConfirmation: !session };
  };

  A.signOut = async () => {
    const sb = A.client();
    if (sb) await sb.auth.signOut();
    session = null;
    profile = null;
    FP.emit('auth', { session: null, profile: null });
  };

  A.resetPassword = async (email) => {
    const sb = A.client();
    if (!sb) return { error: 'Supabase SDK not loaded' };
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: root.location.origin + root.location.pathname,
    });
    return error ? { error: error.message } : { sent: true };
  };
})(window);
