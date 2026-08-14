// Client-side search/rank/filter engine — a faithful port of
// src/search_ranking.cpp and InternshipStore::search()/tag_facet_counts()
// from src/internship_store.cpp / src/api_server.cpp.
//
// Why this exists: the site is statically hosted (GitHub Pages can't run our
// C++ backend), so ranking/filtering/faceting that used to happen server-side
// now happens here, over a static public/data/internships.json snapshot
// generated at build time by scripts/generate_static_data.sh — see the
// README's "Static hosting" section. The C++ backend itself is unchanged and
// still works for local dev (`./build/internship_server`); this file just
// means the *shipped* frontend doesn't depend on it being alive.
//
// One deliberate improvement over the C++ version: tokenize() here uses
// JS's Unicode-aware toLowerCase()/matching instead of the C++ version's
// ASCII-only lowering, so accented uppercase letters (e.g. "Õigus") fold
// correctly — a known limitation of the original that's fixed for free here.

const RANKING_WEIGHTS = { name: 5, keywords: 4, company: 3, description: 2 };
const RANKING_TOTAL_WEIGHT =
  RANKING_WEIGHTS.name + RANKING_WEIGHTS.keywords + RANKING_WEIGHTS.company + RANKING_WEIGHTS.description;
const FUZZY_THRESHOLD = 0.6; // below this similarity, treat as unrelated
const SUBSTRING_SCORE = 0.7; // token appears inside/around the field text
const FUZZY_SCORE_CAP = 0.5; // fuzzy matches never outrank a real substring hit

function tokenize(text) {
  return (text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function levenshtein(a, b) {
  const n = a.length;
  const m = b.length;
  let prev = new Array(m + 1);
  let curr = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m];
}

function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

// How well a single query token matches a single field, as a 0..1 ratio.
function tokenFieldRatio(fieldLower, fieldWords, token) {
  if (fieldWords.includes(token)) return 1;
  if (fieldLower.includes(token)) return SUBSTRING_SCORE;
  let best = 0;
  for (const word of fieldWords) best = Math.max(best, similarity(word, token));
  return best >= FUZZY_THRESHOLD ? best * FUZZY_SCORE_CAP : 0;
}

function relevanceScore(item, queryTokens) {
  if (!queryTokens.length) return 0;

  const keywordsBlob = (item.keywords || []).join(" ");
  const fields = [
    { lower: (item.name || "").toLowerCase(), words: tokenize(item.name), weight: RANKING_WEIGHTS.name },
    { lower: keywordsBlob.toLowerCase(), words: tokenize(keywordsBlob), weight: RANKING_WEIGHTS.keywords },
    { lower: (item.company || "").toLowerCase(), words: tokenize(item.company), weight: RANKING_WEIGHTS.company },
    { lower: (item.description || "").toLowerCase(), words: tokenize(item.description), weight: RANKING_WEIGHTS.description },
  ];

  let total = 0;
  for (const token of queryTokens) {
    for (const field of fields) {
      total += field.weight * tokenFieldRatio(field.lower, field.words, token);
    }
  }
  const avgPerToken = total / queryTokens.length;
  return avgPerToken / RANKING_TOTAL_WEIGHT;
}

// ---------- Filtering (port of InternshipStore::search()'s hard filters) ----------

function applyFilters(items, filters) {
  return items.filter((item) => {
    if (filters.paySpecified === "true" && !item.pay_specified) return false;
    if (filters.paySpecified === "false" && item.pay_specified) return false;

    if (filters.type && item.employment_type.toLowerCase() !== filters.type.toLowerCase()) return false;
    if (filters.location && item.location.toLowerCase() !== filters.location.toLowerCase()) return false;

    const hasDeadlineRange = filters.deadlineAfter || filters.deadlineBefore;
    if (hasDeadlineRange && item.deadline_rolling) return false;
    if (filters.deadlineAfter && item.deadline < filters.deadlineAfter) return false;
    if (filters.deadlineBefore && item.deadline > filters.deadlineBefore) return false;

    if (filters.tags && filters.tags.size) {
      if (!item.tags.some((t) => filters.tags.has(t))) return false;
    }
    return true;
  });
}

// Soonest deadline first; rolling ("Pidev") postings, having no date to be
// urgent about, always sort after every dated posting. Same rule as
// InternshipStore::active_items().
function sortByDeadline(items) {
  return [...items].sort((a, b) => {
    if (a.deadline_rolling !== b.deadline_rolling) return a.deadline_rolling ? 1 : -1;
    if (a.deadline_rolling && b.deadline_rolling) return 0;
    if (a.deadline < b.deadline) return -1;
    if (a.deadline > b.deadline) return 1;
    return 0;
  });
}

// Mirrors GET /api/search: hard filters always apply; `q` only ranks (never
// excludes) and, when present, overrides the default deadline-first order
// with relevance order. Returns items with a `relevance` field attached
// (0..1, or null when there's no query) — same shape the old API returned.
function search(allItems, filters) {
  const filtered = applyFilters(allItems, filters);

  if (filters.q && filters.q.trim()) {
    const tokens = tokenize(filters.q);
    return filtered
      .map((item) => ({ item, relevance: relevanceScore(item, tokens) }))
      .sort((a, b) => b.relevance - a.relevance)
      .map(({ item, relevance }) => ({ ...item, relevance }));
  }

  return sortByDeadline(filtered).map((item) => ({ ...item, relevance: null }));
}

// Mirrors GET /api/facets: tag counts under the *other* active filters
// (ignoring `tags` itself, so the checkbox list doesn't shrink to just what's
// checked), sorted by count desc then alphabetically.
function tagFacetCounts(allItems, filters) {
  const items = applyFilters(allItems, { ...filters, tags: null });
  const counts = new Map();
  for (const item of items) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.tag.localeCompare(b.tag)));
}

// ---------- localStorage-backed "profile" data ----------
// No login/backend in the static build, so favorites/saved searches/
// recently-viewed all live in the browser's localStorage instead of an
// account — shared between index.html (app.js) and profile.html
// (profile.js) via these same keys/helpers.

const LS_KEYS = {
  favorites: "favorites",
  savedSearches: "savedSearches",
  recentlyViewed: "recentlyViewed",
};

function randomId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function loadFavoriteIds() {
  return new Set(JSON.parse(localStorage.getItem(LS_KEYS.favorites) || "[]"));
}
function saveFavoriteIds(idSet) {
  localStorage.setItem(LS_KEYS.favorites, JSON.stringify([...idSet]));
}

function loadSavedSearches() {
  return JSON.parse(localStorage.getItem(LS_KEYS.savedSearches) || "[]");
}
function addSavedSearch(name, query) {
  const list = loadSavedSearches();
  const entry = { id: randomId(), name, query, created_at: new Date().toISOString() };
  list.push(entry);
  localStorage.setItem(LS_KEYS.savedSearches, JSON.stringify(list));
  return entry;
}
function deleteSavedSearch(id) {
  const list = loadSavedSearches().filter((s) => s.id !== id);
  localStorage.setItem(LS_KEYS.savedSearches, JSON.stringify(list));
}

const MAX_RECENTLY_VIEWED = 20;
function loadRecentlyViewed() {
  return JSON.parse(localStorage.getItem(LS_KEYS.recentlyViewed) || "[]");
}
function recordView(internshipId) {
  let list = loadRecentlyViewed().filter((v) => v.internship_id !== internshipId);
  list.unshift({ internship_id: internshipId, viewed_at: new Date().toISOString() });
  list = list.slice(0, MAX_RECENTLY_VIEWED);
  localStorage.setItem(LS_KEYS.recentlyViewed, JSON.stringify(list));
}
