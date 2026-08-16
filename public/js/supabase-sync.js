// Bridges Supabase (auth + the favorites/saved_searches/recently_viewed
// tables) to search-engine.js's localStorage-backed helpers. localStorage
// stays the fast synchronous cache app.js/profile.js render from directly
// (so neither file needed a rewrite to become async); this file mirrors
// writes to Supabase in the background while logged in, and does a
// one-time pull+merge on login so data from a previous session — or from
// browsing anonymously before logging in — isn't lost.
//
// After any change, `supabase-data-changed` is dispatched on `window` so
// app.js/profile.js know to re-render from the (now possibly server-
// updated) localStorage cache.

const SupabaseSync = (() => {
  let currentUserId = null;

  function isLoggedIn() {
    return !!currentUserId;
  }

  // Each of the three categories merges independently (Promise.allSettled,
  // each wrapped in its own try/catch) — a failure in one (e.g. a
  // misconfigured grant/policy on one table) must not silently block the
  // other two, or the login-merge as a whole, from completing. This is what
  // masked the "permission denied for table favorites" bug during testing:
  // the old single Promise.all threw and aborted the entire merge, so
  // nothing (including saved_searches/recently_viewed, which were fine)
  // ever ran, and no error surfaced anywhere the UI could show it.
  async function mergeOnLogin(userId) {
    currentUserId = userId;

    await Promise.allSettled([mergeFavorites(userId), mergeSavedSearches(userId), mergeRecentlyViewed(userId)]);

    window.dispatchEvent(new Event("supabase-data-changed"));
  }

  // Favorites: union local + remote, push anything local-only up. Merges
  // cleanly since it's just a plain id set, naturally idempotent.
  async function mergeFavorites(userId) {
    try {
      const remoteFavorites = await SupabaseAPI.fetchFavorites(userId);
      const localFavorites = loadFavoriteIds();
      const mergedFavorites = new Set([...localFavorites, ...remoteFavorites]);
      saveFavoriteIds(mergedFavorites);
      await Promise.all(
        [...mergedFavorites].filter((id) => !remoteFavorites.has(id)).map((id) => SupabaseAPI.addFavoriteRemote(userId, id))
      );
    } catch (err) {
      console.error("Supabase favorites merge failed:", err);
    }
  }

  // Saved searches: push local-only entries (deduped by name+query) up,
  // then adopt the combined server list as the new local cache — this is
  // also what reconciles locally-generated ids to server-assigned ones.
  // Best-effort: can leave a harmless near-duplicate if the exact same
  // name+query was saved both locally and remotely before this merge ever
  // ran between two different devices.
  async function mergeSavedSearches(userId) {
    try {
      const remoteSearches = await SupabaseAPI.fetchSavedSearches(userId);
      const localSearches = loadSavedSearches();
      const remoteQueryKeys = new Set(remoteSearches.map((s) => `${s.name} ${s.query}`));
      const localOnly = localSearches.filter((s) => !remoteQueryKeys.has(`${s.name} ${s.query}`));
      const pushed = await Promise.all(localOnly.map((s) => SupabaseAPI.addSavedSearchRemote(userId, s.name, s.query)));
      localStorage.setItem("savedSearches", JSON.stringify([...pushed, ...remoteSearches]));
    } catch (err) {
      console.error("Supabase saved-search merge failed:", err);
    }
  }

  // Recently viewed: push local-only views up, then adopt the server's
  // authoritative (already-capped-at-20) list.
  async function mergeRecentlyViewed(userId) {
    try {
      const remoteViews = await SupabaseAPI.fetchRecentlyViewed(userId);
      const localViews = loadRecentlyViewed();
      const remoteViewIds = new Set(remoteViews.map((v) => v.internship_id));
      const hasLocalOnly = localViews.some((v) => !remoteViewIds.has(v.internship_id));
      await Promise.all(
        localViews.filter((v) => !remoteViewIds.has(v.internship_id)).map((v) => SupabaseAPI.recordViewRemote(userId, v.internship_id))
      );
      const mergedViews = hasLocalOnly ? await SupabaseAPI.fetchRecentlyViewed(userId) : remoteViews;
      localStorage.setItem("recentlyViewed", JSON.stringify(mergedViews));
    } catch (err) {
      console.error("Supabase recently-viewed merge failed:", err);
    }
  }

  function clearOnLogout() {
    currentUserId = null;
  }

  function syncFavorite(id, isFavorited) {
    if (!isLoggedIn()) return;
    const op = isFavorited ? SupabaseAPI.addFavoriteRemote(currentUserId, id) : SupabaseAPI.removeFavoriteRemote(currentUserId, id);
    op.catch((err) => console.error("Supabase favorite sync failed:", err));
  }

  // `localEntry` is the {id, name, query, created_at} object search-engine.js's
  // addSavedSearch() just wrote to localStorage, with a locally-generated
  // id. Once Supabase assigns its own id, the local cache entry is patched
  // in place so a same-session delete targets the right server row.
  function syncSavedSearchAdd(localEntry) {
    if (!isLoggedIn()) return;
    SupabaseAPI.addSavedSearchRemote(currentUserId, localEntry.name, localEntry.query)
      .then((remoteEntry) => {
        const list = loadSavedSearches().map((s) => (s.id === localEntry.id ? remoteEntry : s));
        localStorage.setItem("savedSearches", JSON.stringify(list));
      })
      .catch((err) => console.error("Supabase saved-search sync failed:", err));
  }

  function syncSavedSearchDelete(id) {
    if (!isLoggedIn()) return;
    SupabaseAPI.deleteSavedSearchRemote(currentUserId, id).catch((err) => console.error("Supabase saved-search delete sync failed:", err));
  }

  function syncRecentlyViewed(internshipId) {
    if (!isLoggedIn()) return;
    SupabaseAPI.recordViewRemote(currentUserId, internshipId).catch((err) => console.error("Supabase recently-viewed sync failed:", err));
  }

  return {
    isLoggedIn,
    mergeOnLogin,
    clearOnLogout,
    syncFavorite,
    syncSavedSearchAdd,
    syncSavedSearchDelete,
    syncRecentlyViewed,
  };
})();
