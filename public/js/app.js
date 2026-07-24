const form = document.getElementById("filters");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const tagFilterToggle = document.getElementById("tagFilterToggle");
const tagFilterPanel = document.getElementById("tagFilterPanel");
const tagFilterCount = document.getElementById("tagFilterCount");

let selectedTags = new Set();

function buildQuery() {
  const params = new URLSearchParams();

  const q = form.q.value.trim();
  if (q) params.set("q", q);

  const paySpecified = form.querySelector('input[name="pay_specified"]:checked').value;
  if (paySpecified) params.set("pay_specified", paySpecified);

  const type = form.type.value;
  if (type) params.set("type", type);

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

  const titleText = item.tags.length
    ? `${item.description}\n\nSildid: ${item.tags.join(", ")}`
    : item.description;

  return `
    <div class="row" style="border-left-color: ${relevanceBorderColor(item.relevance)}" title="${escapeHtml(titleText)}">
      <span class="col-relevance">${relevanceHtml}</span>
      <span class="col-name">${highlight(item.name, queryTokens)}</span>
      <span class="col-company">${highlight(item.company, queryTokens)}</span>
      <span class="col-pay">${payHtml}</span>
      <span class="col-type">${escapeHtml(item.employment_type)}</span>
      <span class="col-tags${tagsClass}">${escapeHtml(tagsText)}</span>
      <span class="col-deadline">${escapeHtml(item.deadline)}</span>
      <span class="col-description">${highlight(item.description, queryTokens)}</span>
      <span class="col-link">${linkHtml}</span>
    </div>
  `;
}

function pluralize(count) {
  return count === 1 ? "tulemus" : "tulemust";
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
    resultsEl.innerHTML = body.map((item) => renderRow(item, queryTokens)).join("");

    if (facetsRes.ok) {
      const facetsBody = await facetsRes.json();
      renderTagPanel(facetsBody.tags);
    }
  } catch (err) {
    statusEl.textContent = `Päring ebaõnnestus: ${err.message}`;
    resultsEl.innerHTML = "";
  }
}

// Populates the "Tööaeg" dropdown from whatever employment_type values
// actually appear in the data, instead of hardcoding an enum.
async function populateEmploymentTypes() {
  try {
    const res = await fetch("/api/internships");
    const items = await res.json();
    const types = [...new Set(items.map((item) => item.employment_type))].sort();

    for (const type of types) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      form.type.appendChild(option);
    }
  } catch (err) {
    // Non-fatal: dropdown just stays at "Kõik" if this fails.
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  runSearch();
});

document.getElementById("reset").addEventListener("click", () => {
  form.reset();
  selectedTags.clear();
  runSearch();
});

tagFilterToggle.addEventListener("click", () => {
  const opening = tagFilterPanel.classList.contains("hidden");
  tagFilterPanel.classList.toggle("hidden");
  tagFilterToggle.setAttribute("aria-expanded", String(opening));
});

document.addEventListener("click", (e) => {
  if (tagFilterPanel.classList.contains("hidden")) return;
  if (tagFilterPanel.contains(e.target) || tagFilterToggle.contains(e.target)) return;
  tagFilterPanel.classList.add("hidden");
  tagFilterToggle.setAttribute("aria-expanded", "false");
});

populateEmploymentTypes().then(runSearch);
