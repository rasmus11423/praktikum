const form = document.getElementById("filters");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");

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

  return params;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Left-border tint that gets stronger the closer a result matches the query,
// so relevance reads as "layers" at a glance instead of a flat list.
function relevanceBorderColor(relevance) {
  if (relevance === null || relevance === undefined) return "transparent";
  const alpha = Math.max(0, Math.min(1, relevance));
  return `rgba(52, 87, 213, ${alpha})`;
}

function renderRow(item) {
  const payHtml = item.pay_specified
    ? escapeHtml(item.pay)
    : `<span class="pay-unspecified">Pole märgitud</span>`;

  const relevanceHtml =
    item.relevance === null || item.relevance === undefined
      ? ""
      : `${Math.round(item.relevance * 100)}%`;

  const linkHtml = item.link
    ? `<a class="row-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">Vaata kuulutust →</a>`
    : "";

  return `
    <div class="row" style="border-left-color: ${relevanceBorderColor(item.relevance)}" title="${escapeHtml(item.description)}">
      <span class="col-relevance">${relevanceHtml}</span>
      <span class="col-name">${escapeHtml(item.name)}</span>
      <span class="col-company">${escapeHtml(item.company)}</span>
      <span class="col-pay">${payHtml}</span>
      <span class="col-type">${escapeHtml(item.employment_type)}</span>
      <span class="col-deadline">${escapeHtml(item.deadline)}</span>
      <span class="col-description">${escapeHtml(item.description)}</span>
      <span class="col-link">${linkHtml}</span>
    </div>
  `;
}

function pluralize(count) {
  return count === 1 ? "tulemus" : "tulemust";
}

async function runSearch() {
  const params = buildQuery();
  statusEl.textContent = "Otsin…";

  try {
    const res = await fetch(`/api/search?${params.toString()}`);
    const body = await res.json();

    if (!res.ok) {
      statusEl.textContent = `Viga: ${body.error || res.statusText}`;
      resultsEl.innerHTML = "";
      return;
    }

    statusEl.textContent = `${body.length} ${pluralize(body.length)}`;
    resultsEl.innerHTML = body.map(renderRow).join("");
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
  runSearch();
});

populateEmploymentTypes().then(runSearch);
