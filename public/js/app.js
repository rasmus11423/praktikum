const form = document.getElementById("filters");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");

function buildQuery() {
  const params = new URLSearchParams();

  const q = form.q.value.trim();
  if (q) params.set("q", q);

  const paid = form.querySelector('input[name="paid"]:checked').value;
  if (paid) params.set("paid", paid);

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
  const payTag = item.paid
    ? `<span class="tag">${escapeHtml(item.pay || "Paid")}</span>`
    : `<span class="tag unpaid">Unpaid</span>`;

  return `
    <article class="card">
      <h3>${escapeHtml(item.name)}</h3>
      <p class="company">${escapeHtml(item.company)}</p>
      <p class="description">${escapeHtml(item.description)}</p>
      <div class="tags">
        ${payTag}
        <span class="tag">${escapeHtml(item.employment_type)}</span>
        <span class="tag">Deadline: ${escapeHtml(item.deadline)}</span>
      </div>
    </article>
  `;
}

async function runSearch() {
  const params = buildQuery();
  statusEl.textContent = "Searching…";

  try {
    const res = await fetch(`/api/search?${params.toString()}`);
    const body = await res.json();

    if (!res.ok) {
      statusEl.textContent = `Error: ${body.error || res.statusText}`;
      resultsEl.innerHTML = "";
      return;
    }

    statusEl.textContent = `${body.length} result${body.length === 1 ? "" : "s"}`;
    resultsEl.innerHTML = body.map(renderCard).join("");
  } catch (err) {
    statusEl.textContent = `Request failed: ${err.message}`;
    resultsEl.innerHTML = "";
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

runSearch();
