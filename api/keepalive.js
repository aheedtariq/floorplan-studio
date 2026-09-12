/* Pinged daily by the Vercel cron in vercel.json. One lightweight read
   counts as activity, which stops Supabase's free tier from pausing the
   project after a quiet week — the pause that took every login and the
   public map down. The key here is the public (publishable) one. */
export default async function handler(req, res) {
  try {
    const r = await fetch(
      'https://bvbjjawpmdfpkmasrcpk.supabase.co/rest/v1/show?select=id&limit=1',
      { headers: { apikey: 'sb_publishable_phh-vhvlqPg8YGEjuxIorw_hgn7bnAX' } },
    );
    res.status(200).json({ db: r.status, at: new Date().toISOString() });
  } catch (e) {
    res.status(200).json({ db: 'unreachable', error: String(e && e.message) });
  }
}
