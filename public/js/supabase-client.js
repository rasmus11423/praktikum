// Supabase client init + low-level Auth/DB calls. No DOM/UI logic here —
// see auth-ui.js (login/signup/logout UI) and supabase-sync.js (bridges
// this to search-engine.js's localStorage-backed favorites/saved-searches/
// recently-viewed). Loaded via the supabase-js UMD build (see the <script>
// tag in index.html/profile.html before this file), which exposes a global
// `supabase.createClient`.
//
// SUPABASE_URL / SUPABASE_ANON_KEY: fill these in from your Supabase
// project's Settings -> API page (see README's "Accounts (Supabase)"
// section). The anon key is meant to be public — every browser gets the
// same one, safe to ship in client-side code by design. It grants nothing
// on its own; every table it can reach is gated by Row Level Security (see
// supabase/schema.sql) to auth.uid() = user_id.

const SUPABASE_URL = "https://dpjjyvymfrlwrzqlnxpp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_rPi0gKbpswx2J4qcynSZqQ_0clhlhK5";

const SupabaseAPI = (() => {
  const isConfigured = !SUPABASE_URL.startsWith("YOUR_") && !SUPABASE_ANON_KEY.startsWith("YOUR_");
  const client = isConfigured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  function requireClient() {
    if (!client) throw new Error("Supabase pole veel seadistatud (public/js/supabase-client.js).");
    return client;
  }

  // ---------- Auth ----------

  async function signUp(email, password) {
    const { data, error } = await requireClient().auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await requireClient().auth.signOut();
    if (error) throw error;
  }

  async function getSession() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session;
  }

  // callback(event, session) — event is e.g. "SIGNED_IN" / "SIGNED_OUT".
  function onAuthStateChange(callback) {
    if (!client) return;
    client.auth.onAuthStateChange((event, session) => callback(event, session));
  }

  // ---------- favorites ----------

  async function fetchFavorites(userId) {
    const { data, error } = await requireClient().from("favorites").select("internship_id").eq("user_id", userId);
    if (error) throw error;
    return new Set(data.map((row) => row.internship_id));
  }

  async function addFavoriteRemote(userId, internshipId) {
    // ignoreDuplicates -> INSERT ... ON CONFLICT DO NOTHING, which only
    // needs INSERT privilege. Without it, upsert() compiles to ON CONFLICT
    // DO UPDATE, which also needs UPDATE — and favorites is deliberately
    // only granted select/insert/delete (a favorite is either present or
    // absent, never "updated"), so that failed with a bare "permission
    // denied for table favorites" (Postgres 42501).
    const { error } = await requireClient()
      .from("favorites")
      .upsert(
        { user_id: userId, internship_id: internshipId },
        { onConflict: "user_id,internship_id", ignoreDuplicates: true }
      );
    if (error) throw error;
  }

  async function removeFavoriteRemote(userId, internshipId) {
    const { error } = await requireClient()
      .from("favorites")
      .delete()
      .eq("user_id", userId)
      .eq("internship_id", internshipId);
    if (error) throw error;
  }

  // ---------- saved searches ----------

  async function fetchSavedSearches(userId) {
    const { data, error } = await requireClient()
      .from("saved_searches")
      .select("id, name, query, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  async function addSavedSearchRemote(userId, name, query) {
    const { data, error } = await requireClient()
      .from("saved_searches")
      .insert({ user_id: userId, name, query })
      .select("id, name, query, created_at")
      .single();
    if (error) throw error;
    return data;
  }

  async function deleteSavedSearchRemote(userId, searchId) {
    const { error } = await requireClient().from("saved_searches").delete().eq("user_id", userId).eq("id", searchId);
    if (error) throw error;
  }

  // ---------- recently viewed ----------

  async function fetchRecentlyViewed(userId) {
    const { data, error } = await requireClient()
      .from("recently_viewed")
      .select("internship_id, viewed_at")
      .eq("user_id", userId)
      .order("viewed_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return data;
  }

  async function recordViewRemote(userId, internshipId) {
    const { error } = await requireClient()
      .from("recently_viewed")
      .upsert(
        { user_id: userId, internship_id: internshipId, viewed_at: new Date().toISOString() },
        { onConflict: "user_id,internship_id" }
      );
    if (error) throw error;
  }

  return {
    isConfigured,
    signUp,
    signIn,
    signOut,
    getSession,
    onAuthStateChange,
    fetchFavorites,
    addFavoriteRemote,
    removeFavoriteRemote,
    fetchSavedSearches,
    addSavedSearchRemote,
    deleteSavedSearchRemote,
    fetchRecentlyViewed,
    recordViewRemote,
  };
})();
