const form = document.getElementById("filters");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const moreFiltersToggle = document.getElementById("moreFiltersToggle");
const moreFiltersPanel = document.getElementById("moreFiltersPanel");
const tagFilterToggle = document.getElementById("tagFilterToggle");
const tagFilterPanel = document.getElementById("tagFilterPanel");
const tagFilterCount = document.getElementById("tagFilterCount");

let selectedTags = new Set();
let expandedIds = new Set();
let favorites = new Set(JSON.parse(localStorage.getItem("favorites") || "[]"));

function saveFavorites() {
  localStorage.setItem("favorites", JSON.stringify([...favorites]));
}

function buildQuery() {
  const params = new URLSearchParams();

  const q = form.q.value.trim();
  if (q) params.set("q", q);

  const paySpecified = form.querySelector('input[name="pay_specified"]:checked').value;
  if (paySpecified) params.set("pay_specified", paySpecified);

  const type = form.type.value;
  if (type) params.set("type", type);

  const location = form.location.value;
  if (location) params.set("location", location);

  const deadlineAfter = form.deadline_after.value;
  if (deadlineAfter) params.set("deadline_after", deadlineAfter);

  const deadlineBefore = form.deadline_before.value;
  if (deadlineBefore) params.set("deadline_before", deadlineBefore);

  for (const tag of selectedTags) params.append("tags", tag);

  return params;
}

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
  return `rgba(52, 87, 213, ${alpha})`;
}

// Whole calendar days between today and an ISO date, comparing dates only
// (not times) so the result doesn't drift with the viewer's local clock.
function daysUntil(isoDate) {
  const target = new Date(`${isoDate}T00:00:00Z`);
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return Math.round((target - todayUtc) / 86400000);
}

// Deadline urgency: <=3 days is red, <=7 days is yellow, otherwise the
// neutral color already used elsewhere in the UI. Rolling ("Pidev")
// postings have no date to be urgent about, so they stay neutral.
function deadlineUrgencyClass(item) {
  if (item.deadline_rolling) return "";
  const days = daysUntil(item.deadline);
  if (days <= 3) return " deadline-urgent";
  if (days <= 7) return " deadline-soon";
  return "";
}

// Renders a row plus its (initially collapsed) inline detail panel, kept as
// a sibling rather than nested so it doesn't disturb the row's own flex
// column layout. Expand state and favorite state both persist across
// re-renders via the module-level Sets.
function renderRow(item, queryTokens) {
  const payHtml = item.pay_specified
    ? highlight(item.pay, queryTokens)
    : `<span class="pay-unspecified">Pole märgitud</span>`;

  const relevanceHtml =
    item.relevance === null || item.relevance === undefined
      ? ""
      : `${Math.round(item.relevance * 100)}%`;

  const tagsText = item.tags.length ? item.tags.join(", ") : "—";
  const tagsClass = item.tags.length ? "" : " no-tags";

  const linkHtml = item.link
    ? `<a class="row-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">Vaata kuulutust →</a>`
    : "";

  const isFavorite = favorites.has(item.id);
  const favHtml = `<button type="button" class="fav-btn${isFavorite ? " favorited" : ""}" data-id="${escapeHtml(item.id)}" aria-label="Lisa lemmikuks">${isFavorite ? "★" : "☆"}</button>`;

  const isExpanded = expandedIds.has(item.id);
  const tagChipsHtml = item.tags.length
    ? item.tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")
    : `<span class="no-tags">Sildid puuduvad</span>`;
  const keywordChipsHtml = item.keywords.length
    ? item.keywords.map((k) => `<span class="keyword-chip">${highlight(k, queryTokens)}</span>`).join("")
    : "";

  return `
    <div class="row" data-id="${escapeHtml(item.id)}" style="border-left-color: ${relevanceBorderColor(item.relevance)}">
      <span class="col-favorite">${favHtml}</span>
      <span class="col-relevance">${relevanceHtml}</span>
      <span class="col-name">${highlight(item.name, queryTokens)}</span>
      <span class="col-company">${highlight(item.company, queryTokens)}</span>
      <span class="col-pay">${payHtml}</span>
      <span class="col-type">${escapeHtml(item.employment_type)}</span>
      <span class="col-tags${tagsClass}">${escapeHtml(tagsText)}</span>
      <span class="col-deadline${deadlineUrgencyClass(item)}">${escapeHtml(item.deadline)}</span>
      <span class="col-description">${highlight(item.description, queryTokens)}</span>
      <span class="col-link">${linkHtml}</span>
    </div>
    <div class="row-details${isExpanded ? " expanded" : ""}" data-details-for="${escapeHtml(item.id)}">
      <div class="row-details-inner">
        <div class="row-details-content">
          <p class="row-details-description">${highlight(item.description, queryTokens)}</p>
          <div class="row-details-meta">
            <span>Asukoht: ${escapeHtml(item.location) || "—"}</span>
            <span class="${deadlineUrgencyClass(item).trim()}">Tähtaeg: ${escapeHtml(item.deadline)}</span>
            <span>Allikas: ${escapeHtml(item.source) || "—"}</span>
          </div>
          <div class="row-details-group">
            <span class="row-details-label">Sildid</span>
            <div class="row-details-tags">${tagChipsHtml}</div>
          </div>
          ${keywordChipsHtml ? `
          <div class="row-details-group">
            <span class="row-details-label">Märksõnad</span>
            <div class="row-details-tags">${keywordChipsHtml}</div>
          </div>` : ""}
        </div>
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

// With a query: bucket into relevance tiers (best/related/less related),
// since that's what "closeness in layers" means when ranking is active.
// Without a query: there's no relevance to tier by, so group by each
// posting's primary (first-matched) tag instead — a browsing-friendly view
// of "what categories exist here." Both return the same shape so rendering
// doesn't need to care which mode produced it.
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

  return sections
    .map((section) => {
      const rows = section.items.map((item) => renderRow(item, queryTokens)).join("");
      const header = `${escapeHtml(section.label)} <span class="section-count">(${section.items.length})</span>`;

      if (section.collapsible) {
        return `
          <details class="result-section">
            <summary class="section-header">${header}</summary>
            ${rows}
          </details>
        `;
      }
      return `
        <div class="result-section">
          <div class="section-header">${header}</div>
          ${rows}
        </div>
      `;
    })
    .join("");
}

// Wires up per-row interactions after every re-render: clicking a row
// toggles its inline detail panel, the favorite star toggles independently
// (without also triggering expand), and the outbound link doesn't trigger
// expand either.
function attachRowInteractions() {
  resultsEl.querySelectorAll(".row[data-id]").forEach((rowEl) => {
    rowEl.addEventListener("click", () => {
      const id = rowEl.dataset.id;
      const details = resultsEl.querySelector(`.row-details[data-details-for="${id}"]`);
      if (!details) return;
      if (expandedIds.has(id)) expandedIds.delete(id);
      else expandedIds.add(id);
      details.classList.toggle("expanded");
    });
  });

  resultsEl.querySelectorAll(".fav-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (favorites.has(id)) favorites.delete(id);
      else favorites.add(id);
      saveFavorites();
      btn.classList.toggle("favorited", favorites.has(id));
      btn.textContent = favorites.has(id) ? "★" : "☆";
    });
  });

  resultsEl.querySelectorAll(".row-link").forEach((link) => {
    link.addEventListener("click", (e) => e.stopPropagation());
  });
}

// Renders the tag dropdown's checkbox list from live facet counts (how many
// of the *current* results carry each tag), preserving which tags are
// checked across re-renders.
function renderTagPanel(facets) {
  tagFilterCount.textContent = selectedTags.size ? ` (${selectedTags.size})` : "";

  if (!facets.length) {
    tagFilterPanel.innerHTML = `<p class="tag-filter-empty">Sildid puuduvad.</p>`;
    return;
  }

  tagFilterPanel.innerHTML = facets
    .map(({ tag, count }) => {
      const checked = selectedTags.has(tag) ? "checked" : "";
      return `
        <label class="tag-option">
          <input type="checkbox" value="${escapeHtml(tag)}" ${checked}>
          <span class="tag-option-label">${escapeHtml(tag)}</span>
          <span class="tag-option-count">(${count})</span>
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

async function runSearch() {
  const params = buildQuery();
  const queryString = params.toString();
  const queryTokens = form.q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  statusEl.textContent = "Otsin…";

  try {
    const [searchRes, facetsRes] = await Promise.all([
      fetch(`/api/search?${queryString}`),
      fetch(`/api/facets?${queryString}`),
    ]);
    const body = await searchRes.json();

    if (!searchRes.ok) {
      statusEl.textContent = `Viga: ${body.error || searchRes.statusText}`;
      resultsEl.innerHTML = "";
      return;
    }

    statusEl.textContent = `${body.length} ${pluralize(body.length)}`;
    resultsEl.innerHTML = renderSections(body, queryTokens);
    attachRowInteractions();

    if (facetsRes.ok) {
      const facetsBody = await facetsRes.json();
      renderTagPanel(facetsBody.tags);
    }
  } catch (err) {
    statusEl.textContent = `Päring ebaõnnestus: ${err.message}`;
    resultsEl.innerHTML = "";
  }
}

// Populates the "Tööaeg" and "Asukoht" dropdowns from whatever values
// actually appear in the data (one shared fetch), instead of hardcoding
// enums that would drift out of sync with the CSV.
async function populateFilterOptions() {
  try {
    const res = await fetch("/api/internships");
    const items = await res.json();

    const fill = (select, values) => {
      for (const value of [...new Set(values)].sort()) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      }
    };

    fill(form.type, items.map((item) => item.employment_type));
    fill(form.location, items.map((item) => item.location));
  } catch (err) {
    // Non-fatal: dropdowns just stay at "Kõik" if this fails.
  }
}

function setupDropdown(toggle, panel) {
  toggle.addEventListener("click", () => {
    const opening = panel.classList.contains("hidden");
    panel.classList.toggle("hidden");
    toggle.setAttribute("aria-expanded", String(opening));
  });
}

setupDropdown(moreFiltersToggle, moreFiltersPanel);
setupDropdown(tagFilterToggle, tagFilterPanel);

document.addEventListener("click", (e) => {
  for (const [toggle, panel] of [
    [moreFiltersToggle, moreFiltersPanel],
    [tagFilterToggle, tagFilterPanel],
  ]) {
    if (panel.classList.contains("hidden")) continue;
    if (panel.contains(e.target) || toggle.contains(e.target)) continue;
    panel.classList.add("hidden");
    toggle.setAttribute("aria-expanded", "false");
  }
});

// No submit button anymore — Enter in the search box still submits the
// form, so this stays as the handler for that; every other control runs
// the search itself as soon as it changes.
form.addEventListener("submit", (e) => {
  e.preventDefault();
  runSearch();
});

let searchDebounce;
form.q.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runSearch, 250);
});

for (const radio of form.querySelectorAll('input[name="pay_specified"]')) {
  radio.addEventListener("change", runSearch);
}
form.type.addEventListener("change", runSearch);
form.location.addEventListener("change", runSearch);
form.deadline_after.addEventListener("change", runSearch);
form.deadline_before.addEventListener("change", runSearch);

populateFilterOptions().then(runSearch);
