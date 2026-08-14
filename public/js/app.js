// Search/browse page. Statically hosted (see README "Static hosting"), so
// there's no live backend here — search-engine.js does all ranking/
// filtering/faceting client-side over a static /data/internships.json
// snapshot loaded once at startup. Favorites/saved searches/recently-viewed
// live in localStorage (also via search-engine.js) since there's no login.

const form = document.getElementById("filters");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const saveSearchBtn = document.getElementById("saveSearchBtn");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const gridViewBtn = document.getElementById("gridViewBtn");
const listViewBtn = document.getElementById("listViewBtn");
const typeToggle = document.getElementById("typeToggle");
const typePanel = document.getElementById("typePanel");
const typeLabel = document.getElementById("typeLabel");
const locationToggle = document.getElementById("locationToggle");
const locationPanel = document.getElementById("locationPanel");
const locationLabel = document.getElementById("locationLabel");
const tagFilterToggle = document.getElementById("tagFilterToggle");
const tagFilterPanel = document.getElementById("tagFilterPanel");
const tagFilterCount = document.getElementById("tagFilterCount");
const notifToggle = document.getElementById("notifToggle");
const notifPanel = document.getElementById("notifPanel");
const notifList = document.getElementById("notifList");
const notifDot = document.getElementById("notifDot");
const detailModal = document.getElementById("detailModal");
const modalClose = document.getElementById("modalClose");
const modalBody = document.getElementById("modalBody");

let ALL_ITEMS = [];
let selectedTags = new Set();
let favorites = loadFavoriteIds();
let favoriteItems = [];            // full posting objects for favorites, used by notifications
let paidValue = "";                 // "" | "true" | "false"
let selectedType = "";
let selectedLocation = "";
let typeValues = [];
let locationValues = [];
let viewMode = "grid";              // "grid" | "list"
let lastResults = [];
let lastQueryTokens = [];
let currentResultsById = new Map();

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Wraps case-insensitive matches of any query word in <mark>, so relevance is
// visible directly in the text instead of only as a score/border tint.
function highlight(text, queryTokens) {
  const candidates = queryTokens.filter((t) => t.length >= 2);
  if (!candidates.length) return escapeHtml(text);

  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  const pattern = sorted.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = (text ?? "").split(new RegExp(`(${pattern})`, "ig"));

  return parts.map((part, i) => (i % 2 === 1 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part))).join("");
}

// Left-border tint that gets stronger the closer a result matches the query,
// so relevance reads as "layers" at a glance instead of a flat list.
function relevanceBorderColor(relevance) {
  if (relevance === null || relevance === undefined) return "transparent";
  const alpha = Math.max(0, Math.min(1, relevance));
  return `rgba(43, 134, 89, ${alpha})`;
}

// Whole calendar days between today and an ISO date, comparing dates only
// (not times) so the result doesn't drift with the viewer's local clock.
function daysUntil(isoDate) {
  const target = new Date(`${isoDate}T00:00:00Z`);
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return Math.round((target - todayUtc) / 86400000);
}

// Deadline urgency: <=3 days is red, <=7 days is yellow, otherwise neutral.
// Rolling ("Pidev") postings have no date to be urgent about.
function deadlineUrgencyClass(item) {
  if (item.deadline_rolling) return "";
  const days = daysUntil(item.deadline);
  if (days <= 3) return " deadline-urgent";
  if (days <= 7) return " deadline-soon";
  return "";
}

// No company logos in our data, so postings get a deterministic colored
// initial-letter avatar instead (same company always gets the same color).
function companyAvatarStyle(company) {
  let hash = 0;
  for (let i = 0; i < company.length; i++) hash = (hash * 31 + company.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `background: hsl(${hue}, 45%, 40%);`;
}
function companyInitial(company) {
  return (company.trim()[0] || "?").toUpperCase();
}

function payChipHtml(item, queryTokens) {
  if (!item.pay_specified) return `<span class="chip chip-unspecified">Tasu pole märgitud</span>`;
  return `<span class="chip chip-pay">${highlight(item.pay, queryTokens || [])}</span>`;
}

function deadlineNoteHtml(item) {
  const cls = deadlineUrgencyClass(item);
  const text = item.deadline_rolling ? item.deadline : `Kandideeri hiljemalt ${item.deadline}`;
  return `<span class="deadline-note${cls}">${escapeHtml(text)}</span>`;
}

function favBtnHtml(item, extraClass) {
  const isFavorite = favorites.has(item.id);
  return `
    <button type="button" class="fav-btn${isFavorite ? " favorited" : ""}${extraClass ? " " + extraClass : ""}" data-id="${escapeHtml(item.id)}" aria-label="Lisa lemmikuks">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3.5h12a1 1 0 011 1V21l-7-4.2L5 21V4.5a1 1 0 011-1z"/></svg>
    </button>
  `;
}

function renderCard(item, queryTokens) {
  const relevanceHtml =
    item.relevance === null || item.relevance === undefined
      ? ""
      : `<span class="match-badge">${Math.round(item.relevance * 100)}% sobivus</span>`;

  const chips = [
    item.tags[0] ? `<span class="chip">${escapeHtml(item.tags[0])}</span>` : "",
    item.location ? `<span class="chip">${escapeHtml(item.location)}</span>` : "",
    `<span class="chip">${escapeHtml(item.employment_type)}</span>`,
    payChipHtml(item, queryTokens),
  ].join("");

  return `
    <div class="offer-card" data-id="${escapeHtml(item.id)}" style="border-left-color: ${relevanceBorderColor(item.relevance)}">
      ${relevanceHtml}
      ${favBtnHtml(item)}
      <div class="company-avatar" style="${companyAvatarStyle(item.company)}">${escapeHtml(companyInitial(item.company))}</div>
      <div class="offer-title-wrap">
        <div class="offer-title bolt-font-body-m-accent">${highlight(item.name, queryTokens)}</div>
        <div class="offer-company bolt-font-body-s-regular">${highlight(item.company, queryTokens)}</div>
      </div>
      <div class="chip-row">${chips}</div>
      ${deadlineNoteHtml(item)}
    </div>
  `;
}

function renderRow(item, queryTokens) {
  const relevanceHtml =
    item.relevance === null || item.relevance === undefined
      ? ""
      : `<span class="match-badge" style="position:static;">${Math.round(item.relevance * 100)}% sobivus</span>`;

  return `
    <div class="offer-row" data-id="${escapeHtml(item.id)}" style="border-left-color: ${relevanceBorderColor(item.relevance)}">
      ${favBtnHtml(item)}
      <div class="company-avatar" style="${companyAvatarStyle(item.company)}">${escapeHtml(companyInitial(item.company))}</div>
      <div class="offer-main">
        ${relevanceHtml}
        <div class="offer-title bolt-font-body-m-accent">${highlight(item.name, queryTokens)}</div>
        <div class="chip-row">
          ${payChipHtml(item, queryTokens)}
          <span class="offer-company bolt-font-body-s-regular">${highlight(item.company, queryTokens)}</span>
        </div>
      </div>
      <div class="offer-meta-right">
        ${deadlineNoteHtml(item)}
        <span class="chip">${escapeHtml(item.location)}</span>
      </div>
    </div>
  `;
}

function pluralize(count) {
  return count === 1 ? "tulemus" : "tulemust";
}

const RELEVANCE_TIERS = [
  { label: "Parimad vasted", min: 0.5, max: Infinity },
  { label: "Seotud", min: 0.15, max: 0.5 },
  { label: "Vähem seotud", min: -Infinity, max: 0.15, collapsible: true },
];

// With a query: bucket into relevance tiers (best/related/less related).
// Without a query: group by each posting's primary tag instead — a
// browsing-friendly view of "what categories exist here."
function sectionResults(items, queryActive) {
  if (queryActive) {
    return RELEVANCE_TIERS.map((tier) => ({
      label: tier.label,
      items: items.filter((item) => item.relevance >= tier.min && item.relevance < tier.max),
      collapsible: Boolean(tier.collapsible),
    })).filter((section) => section.items.length > 0);
  }

  const groups = new Map();
  for (const item of items) {
    const key = item.tags[0] || "Muu";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()]
    .map(([label, groupItems]) => ({ label, items: groupItems, collapsible: false }))
    .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
}

function renderSections(items, queryTokens) {
  const sections = sectionResults(items, queryTokens.length > 0);
  const renderItem = viewMode === "grid" ? renderCard : renderRow;
  const containerClass = viewMode === "grid" ? "cards-grid" : "cards-list";

  return sections
    .map((section) => {
      const cards = section.items.map((item) => renderItem(item, queryTokens)).join("");
      const header = `${escapeHtml(section.label)} <span class="section-count">(${section.items.length})</span>`;
      const body = `<div class="${containerClass}">${cards}</div>`;

      if (section.collapsible) {
        return `<details class="result-section"><summary class="section-header">${header}</summary>${body}</details>`;
      }
      return `<div class="result-section"><div class="section-header">${header}</div>${body}</div>`;
    })
    .join("");
}

function toggleFavorite(id) {
  const nowFavorited = !favorites.has(id);
  if (nowFavorited) favorites.add(id);
  else favorites.delete(id);
  saveFavoriteIds(favorites);
  refreshFavoriteItems();
  return nowFavorited;
}

function renderModalContent(item, queryTokens) {
  const tagChipsHtml = item.tags.length
    ? item.tags.map((t) => `<span class="modal-chip chip">${escapeHtml(t)}</span>`).join("")
    : `<span class="no-tags">Sildid puuduvad</span>`;
  const keywordChipsHtml = item.keywords.length
    ? item.keywords.map((k) => `<span class="modal-chip chip">${highlight(k, queryTokens)}</span>`).join("")
    : "";
  const isFavorite = favorites.has(item.id);

  return `
    <div class="modal-header">
      <div class="company-avatar" style="${companyAvatarStyle(item.company)}">${escapeHtml(companyInitial(item.company))}</div>
      <div>
        <div class="bolt-font-heading-s-accent">${highlight(item.name, queryTokens)}</div>
        <div class="modal-meta bolt-font-body-m-regular">${highlight(item.company, queryTokens)} · ${escapeHtml(item.location) || "—"}</div>
      </div>
    </div>
    <div class="modal-chips">
      ${payChipHtml(item, queryTokens)}
      <span class="modal-chip chip">${escapeHtml(item.employment_type)}</span>
      ${tagChipsHtml}
      <span class="modal-chip chip" style="background:var(--color-bg-promo-secondary); color:var(--color-content-promo-primary);">Tähtaeg: ${escapeHtml(item.deadline)}</span>
    </div>
    <p class="modal-description">${highlight(item.description, queryTokens)}</p>
    ${keywordChipsHtml ? `<div class="modal-keywords">${keywordChipsHtml}</div>` : ""}
    <div class="modal-actions">
      <a class="btn-primary" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">Kandideeri</a>
      <button type="button" class="btn-secondary" id="modalFavBtn" data-id="${escapeHtml(item.id)}">${isFavorite ? "★ Salvestatud" : "☆ Salvesta"}</button>
    </div>
    <div class="modal-tip">
      <span>Ei tea, kuidas kandideerida? <a href="/guide.html">Loe meie kandideerimisjuhendit</a></span>
    </div>
  `;
}

function wireModalButtons(item) {
  const modalFavBtn = modalBody.querySelector("#modalFavBtn");
  if (!modalFavBtn) return;
  modalFavBtn.addEventListener("click", () => {
    const nowFav = toggleFavorite(item.id);
    modalFavBtn.textContent = nowFav ? "★ Salvestatud" : "☆ Salvesta";
    resultsEl.querySelectorAll(`.fav-btn[data-id="${item.id}"]`).forEach((b) => b.classList.toggle("favorited", nowFav));
  });
}

function openModal(id) {
  const item = currentResultsById.get(id);
  if (!item) return;
  modalBody.innerHTML = renderModalContent(item, lastQueryTokens);
  wireModalButtons(item);
  detailModal.classList.remove("hidden");
  recordView(id);
}

function closeModal() {
  detailModal.classList.add("hidden");
  modalBody.innerHTML = "";
}

modalClose.addEventListener("click", closeModal);
detailModal.addEventListener("click", (e) => {
  if (e.target === detailModal) closeModal();
});

// Wires up per-card/row interactions after every re-render: clicking a
// card/row opens the detail modal, the favorite star toggles independently.
function attachResultInteractions() {
  resultsEl.querySelectorAll(".offer-card[data-id], .offer-row[data-id]").forEach((el) => {
    el.addEventListener("click", () => openModal(el.dataset.id));
  });

  resultsEl.querySelectorAll(".fav-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const nowFav = toggleFavorite(btn.dataset.id);
      btn.classList.toggle("favorited", nowFav);
    });
  });
}

// Renders the "Valdkond" (field/tag) dropdown's checkbox list from live
// facet counts, preserving which tags are checked across re-renders.
function renderTagPanel(facets) {
  tagFilterCount.textContent = selectedTags.size ? ` (${selectedTags.size})` : "";

  if (!facets.length) {
    tagFilterPanel.innerHTML = `<p class="dropdown-empty">Valdkondi ei leitud.</p>`;
    return;
  }

  tagFilterPanel.innerHTML = facets
    .map(({ tag, count }) => {
      const checked = selectedTags.has(tag) ? "checked" : "";
      return `
        <label class="dropdown-option">
          <input type="checkbox" value="${escapeHtml(tag)}" ${checked}>
          <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(tag)}</span>
          <span class="dropdown-option-count">${count}</span>
        </label>
      `;
    })
    .join("");

  tagFilterPanel.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedTags.add(checkbox.value);
      else selectedTags.delete(checkbox.value);
      runSearch();
    });
  });
}

function renderSingleSelectPanel(panel, values, current, onSelect) {
  const allOption = `<div class="dropdown-option${current === "" ? " active" : ""}" data-value="">Kõik</div>`;
  const opts = values.map(
    (v) => `<div class="dropdown-option${v === current ? " active" : ""}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</div>`
  );
  panel.innerHTML = [allOption, ...opts].join("");
  panel.querySelectorAll(".dropdown-option").forEach((el) => {
    el.addEventListener("click", () => onSelect(el.dataset.value));
  });
}

function renderTypePanel() {
  renderSingleSelectPanel(typePanel, typeValues, selectedType, (v) => {
    selectedType = v;
    typeLabel.textContent = v || "Kõik";
    renderTypePanel();
    closeAllDropdowns();
    runSearch();
  });
}

function renderLocationPanel() {
  renderSingleSelectPanel(locationPanel, locationValues, selectedLocation, (v) => {
    selectedLocation = v;
    locationLabel.textContent = v || "Kõik";
    renderLocationPanel();
    closeAllDropdowns();
    runSearch();
  });
}

function hasActiveFilters() {
  return Boolean(
    form.q.value.trim() ||
      paidValue ||
      selectedType ||
      selectedLocation ||
      form.deadline_after.value ||
      form.deadline_before.value ||
      selectedTags.size
  );
}

function updateClearFiltersVisibility() {
  clearFiltersBtn.classList.toggle("hidden", !hasActiveFilters());
}

// Shareable/saved-search representation (URL query string) — kept separate
// from buildFilters() below since it needs a different shape (string params,
// not a Set) and is also used to seed state back from a URL on load.
function buildQuery() {
  const params = new URLSearchParams();

  const q = form.q.value.trim();
  if (q) params.set("q", q);
  if (paidValue) params.set("pay_specified", paidValue);
  if (selectedType) params.set("type", selectedType);
  if (selectedLocation) params.set("location", selectedLocation);

  const deadlineAfter = form.deadline_after.value;
  if (deadlineAfter) params.set("deadline_after", deadlineAfter);
  const deadlineBefore = form.deadline_before.value;
  if (deadlineBefore) params.set("deadline_before", deadlineBefore);

  for (const tag of selectedTags) params.append("tags", tag);

  return params;
}

// Shape search-engine.js's search()/tagFacetCounts() expect.
function buildFilters() {
  return {
    q: form.q.value.trim(),
    paySpecified: paidValue,
    type: selectedType,
    location: selectedLocation,
    deadlineAfter: form.deadline_after.value,
    deadlineBefore: form.deadline_before.value,
    tags: selectedTags,
  };
}

function runSearch() {
  lastQueryTokens = form.q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  updateClearFiltersVisibility();

  const filters = buildFilters();
  const results = search(ALL_ITEMS, filters);

  lastResults = results;
  currentResultsById = new Map(results.map((item) => [item.id, item]));
  statusEl.textContent = `${results.length} ${pluralize(results.length)}`;
  resultsEl.innerHTML = results.length
    ? renderSections(results, lastQueryTokens)
    : `<div class="dropdown-empty" style="padding:48px 24px; text-align:center; background:var(--color-layer-floor-1); border-radius:var(--corner-radius-l);">Ühtegi praktikat ei leitud sinu filtritega.</div>`;
  attachResultInteractions();

  renderTagPanel(tagFacetCounts(ALL_ITEMS, filters));
}

function setViewMode(mode) {
  viewMode = mode;
  gridViewBtn.classList.toggle("active", mode === "grid");
  listViewBtn.classList.toggle("active", mode === "list");
  if (lastResults.length) {
    resultsEl.innerHTML = renderSections(lastResults, lastQueryTokens);
    attachResultInteractions();
  }
}
gridViewBtn.addEventListener("click", () => setViewMode("grid"));
listViewBtn.addEventListener("click", () => setViewMode("list"));

// Populates the "Tööaeg"/"Asukoht" dropdowns from whatever values actually
// appear in the data, instead of hardcoding enums. Also seeds selection from
// the URL's query params (for saved-search links) since the option lists
// need to exist before a value can be marked active.
function populateFilterOptions() {
  typeValues = [...new Set(ALL_ITEMS.map((item) => item.employment_type))].sort();
  locationValues = [...new Set(ALL_ITEMS.map((item) => item.location))].sort();

  const params = new URLSearchParams(location.search);
  if (params.has("type")) selectedType = params.get("type");
  if (params.has("location")) selectedLocation = params.get("location");

  typeLabel.textContent = selectedType || "Kõik";
  locationLabel.textContent = selectedLocation || "Kõik";
  renderTypePanel();
  renderLocationPanel();
}

function applyFiltersFromUrl() {
  const params = new URLSearchParams(location.search);
  if (params.has("q")) form.q.value = params.get("q");
  if (params.has("pay_specified")) {
    paidValue = params.get("pay_specified");
    document.querySelectorAll("#paidSegmented .segmented-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.value === paidValue);
    });
  }
  if (params.has("deadline_after")) form.deadline_after.value = params.get("deadline_after");
  if (params.has("deadline_before")) form.deadline_before.value = params.get("deadline_before");
  for (const tag of params.getAll("tags")) selectedTags.add(tag);
}

document.querySelectorAll("#paidSegmented .segmented-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    paidValue = btn.dataset.value;
    document.querySelectorAll("#paidSegmented .segmented-btn").forEach((b) => b.classList.toggle("active", b === btn));
    runSearch();
  });
});

clearFiltersBtn.addEventListener("click", () => {
  form.q.value = "";
  paidValue = "";
  selectedType = "";
  selectedLocation = "";
  selectedTags.clear();
  form.deadline_after.value = "";
  form.deadline_before.value = "";
  document.querySelectorAll("#paidSegmented .segmented-btn").forEach((b) => b.classList.toggle("active", b.dataset.value === ""));
  typeLabel.textContent = "Kõik";
  locationLabel.textContent = "Kõik";
  renderTypePanel();
  renderLocationPanel();
  runSearch();
});

saveSearchBtn.addEventListener("click", () => {
  const name = prompt("Anna otsingule nimi:");
  if (!name || !name.trim()) return;
  addSavedSearch(name.trim(), buildQuery().toString());
  alert("Otsing salvestatud — leiad selle oma lehelt.");
});

// ---------- Notifications: computed client-side from favorited postings'
// deadlines (all data is already local, no fetch needed). ----------

function refreshFavoriteItems() {
  favoriteItems = ALL_ITEMS.filter((item) => favorites.has(item.id));
  updateNotifications();
}

function updateNotifications() {
  const upcoming = favoriteItems
    .filter((item) => !item.deadline_rolling && daysUntil(item.deadline) <= 7 && daysUntil(item.deadline) >= 0)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));

  notifDot.classList.toggle("hidden", upcoming.length === 0);

  if (!upcoming.length) {
    notifList.innerHTML = `<div class="notif-empty bolt-font-body-s-regular">Praegu pole teavitusi.</div>`;
    return;
  }

  notifList.innerHTML =
    `<div class="bolt-font-caps-s-accent" style="color:var(--color-content-tertiary); padding:8px 8px 2px;">Lähenevad tähtajad</div>` +
    upcoming
      .map(
        (item) => `
      <a href="#" class="notif-item" data-id="${escapeHtml(item.id)}">
        <div class="company-avatar" style="width:26px; height:26px; font-size:0.7rem; ${companyAvatarStyle(item.company)}">${escapeHtml(companyInitial(item.company))}</div>
        <div class="notif-item-body">
          <div class="notif-item-title bolt-font-body-s-accent">${escapeHtml(item.name)}</div>
          <div class="bolt-font-body-xs-regular deadline-note${deadlineUrgencyClass(item)}">${escapeHtml(item.deadline)}</div>
        </div>
      </a>
    `
      )
      .join("");

  notifList.querySelectorAll(".notif-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      closeAllDropdowns();
      const item = favoriteItems.find((f) => f.id === el.dataset.id);
      if (item) {
        currentResultsById.set(item.id, item);
        openModal(item.id);
      }
    });
  });
}

// ---------- Dropdown open/close (shared: type/location/field/notifications) ----------

const DROPDOWNS = [
  [typeToggle, typePanel],
  [tagFilterToggle, tagFilterPanel],
  [locationToggle, locationPanel],
  [notifToggle, notifPanel],
];

function closeAllDropdowns() {
  for (const [toggle, panel] of DROPDOWNS) {
    panel.classList.add("hidden");
    toggle.setAttribute("aria-expanded", "false");
  }
}

DROPDOWNS.forEach(([toggle, panel]) => {
  toggle.addEventListener("click", () => {
    const opening = panel.classList.contains("hidden");
    closeAllDropdowns();
    if (opening) {
      panel.classList.remove("hidden");
      toggle.setAttribute("aria-expanded", "true");
    }
  });
});

document.addEventListener("click", (e) => {
  for (const [toggle, panel] of DROPDOWNS) {
    if (panel.classList.contains("hidden")) continue;
    if (panel.contains(e.target) || toggle.contains(e.target)) continue;
    panel.classList.add("hidden");
    toggle.setAttribute("aria-expanded", "false");
  }
});

// No submit button — Enter in the search box still submits the form, so
// this stays as the handler for that; every other control runs the search
// itself as soon as it changes.
form.addEventListener("submit", (e) => {
  e.preventDefault();
  runSearch();
});

let searchDebounce;
form.q.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runSearch, 250);
});
form.deadline_after.addEventListener("change", runSearch);
form.deadline_before.addEventListener("change", runSearch);

async function loadAllItems() {
  const res = await fetch("/data/internships.json");
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  ALL_ITEMS = await res.json();
}

applyFiltersFromUrl();
statusEl.textContent = "Laen andmeid…";
loadAllItems()
  .then(() => {
    refreshFavoriteItems();
    populateFilterOptions();
    runSearch();
  })
  .catch((err) => {
    statusEl.textContent =
      `Andmete laadimine ebaõnnestus (${err.message}). Kohalikuks testimiseks käivita ` +
      `scripts/generate_static_data.sh, et luua public/data/internships.json.`;
  });
