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

function renderCard(item) {
  const payTag = item.pay_specified
    ? `<span class="tag">${escapeHtml(item.pay)}</span>`
    : `<span class="tag unspecified">Tasu pole märgitud</span>`;

  const linkHtml = item.link
    ? `<a class="card-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">Vaata kuulutust →</a>`
    : "";

  return `
    <article class="card">
      <h3>${escapeHtml(item.name)}</h3>
      <p class="company">${escapeHtml(item.company)}</p>
      <p class="description">${escapeHtml(item.description)}</p>
      <div class="tags">
        ${payTag}
        <span class="tag">${escapeHtml(item.employment_type)}</span>
        <span class="tag">Tähtaeg: ${escapeHtml(item.deadline)}</span>
      </div>
      ${linkHtml}
    </article>
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
    resultsEl.innerHTML = body.map(renderCard).join("");
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
