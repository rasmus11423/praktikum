// Profile page. No login/backend in the static build — everything here
// comes from localStorage (via search-engine.js's helpers) cross-referenced
// against the same static /data/internships.json snapshot app.js uses.

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Same urgency logic as the main page's app.js (kept as a small local copy
// rather than a shared module, since this is a two-page static site).
function daysUntil(isoDate) {
  const target = new Date(`${isoDate}T00:00:00Z`);
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return Math.round((target - todayUtc) / 86400000);
}

function deadlineUrgencyClass(item) {
  if (item.deadline_rolling) return "";
  const days = daysUntil(item.deadline);
  if (days <= 3) return " deadline-urgent";
  if (days <= 7) return " deadline-soon";
  return "";
}

function renderPostingRow(item, removeAction) {
  return `
    <div class="mini-row">
      <div class="mini-row-main">
        <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="mini-row-name">${escapeHtml(item.name)}</a>
        <span class="mini-row-company">${escapeHtml(item.company)}</span>
      </div>
      <span class="mini-row-deadline${deadlineUrgencyClass(item)}">${escapeHtml(item.deadline)}</span>
      <button type="button" class="mini-remove" data-id="${escapeHtml(item.id)}" data-action="${removeAction}">Eemalda</button>
    </div>
  `;
}

function renderHistoryRow(item) {
  return `
    <div class="mini-row">
      <div class="mini-row-main">
        <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="mini-row-name">${escapeHtml(item.name)}</a>
        <span class="mini-row-company">${escapeHtml(item.company)}</span>
      </div>
      <span class="mini-row-deadline${deadlineUrgencyClass(item)}">${escapeHtml(item.deadline)}</span>
      <span class="mini-row-meta">vaadatud ${escapeHtml(item.viewed_at.slice(0, 10))}</span>
    </div>
  `;
}

function renderSearchRow(s) {
  return `
    <div class="mini-row">
      <div class="mini-row-main">
        <a href="./?${s.query}" class="mini-row-name">${escapeHtml(s.name)}</a>
        <span class="mini-row-company">salvestatud ${escapeHtml(s.created_at.slice(0, 10))}</span>
      </div>
      <button type="button" class="mini-remove" data-id="${escapeHtml(s.id)}" data-action="delete-search">Kustuta</button>
    </div>
  `;
}

function renderFavorites(allItems) {
  const el = document.getElementById("favoritesList");
  const ids = loadFavoriteIds();
  const items = allItems.filter((item) => ids.has(item.id));

  el.innerHTML = items.length
    ? items.map((item) => renderPostingRow(item, "unfavorite")).join("")
    : `<p class="mini-empty">Lemmikuid pole veel.</p>`;

  el.querySelectorAll('[data-action="unfavorite"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const current = loadFavoriteIds();
      current.delete(btn.dataset.id);
      saveFavoriteIds(current);
      renderFavorites(allItems);
    });
  });
}

function renderSearches() {
  const el = document.getElementById("searchesList");
  const items = loadSavedSearches();

  el.innerHTML = items.length
    ? items.map(renderSearchRow).join("")
    : `<p class="mini-empty">Salvestatud otsinguid pole veel — need saad lisada otsingulehelt "☆ Salvesta otsing" nupuga.</p>`;

  el.querySelectorAll('[data-action="delete-search"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      deleteSavedSearch(btn.dataset.id);
      renderSearches();
    });
  });
}

function renderHistory(allItems) {
  const el = document.getElementById("historyList");
  const byId = new Map(allItems.map((item) => [item.id, item]));
  const views = loadRecentlyViewed();
  const items = views
    .map((v) => (byId.has(v.internship_id) ? { ...byId.get(v.internship_id), viewed_at: v.viewed_at } : null))
    .filter(Boolean);

  el.innerHTML = items.length
    ? items.map(renderHistoryRow).join("")
    : `<p class="mini-empty">Vaadatud kuulutusi pole veel.</p>`;
}

async function loadAllItems() {
  const res = await fetch("data/internships.json");
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

loadAllItems()
  .then((allItems) => {
    renderFavorites(allItems);
    renderSearches();
    renderHistory(allItems);
  })
  .catch((err) => {
    document.getElementById("favoritesList").innerHTML = `<p class="mini-empty">Laadimine ebaõnnestus: ${escapeHtml(err.message)}</p>`;
    document.getElementById("historyList").innerHTML = "";
    renderSearches();
  });
