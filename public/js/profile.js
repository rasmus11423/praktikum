const authForms = document.getElementById("authForms");
const profileContent = document.getElementById("profileContent");

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
        <a href="/?${s.query}" class="mini-row-name">${escapeHtml(s.name)}</a>
        <span class="mini-row-company">salvestatud ${escapeHtml(s.created_at.slice(0, 10))}</span>
      </div>
      <button type="button" class="mini-remove" data-id="${escapeHtml(s.id)}" data-action="delete-search">Kustuta</button>
    </div>
  `;
}

async function loadFavorites() {
  const el = document.getElementById("favoritesList");
  try {
    const res = await fetch("/api/me/favorites");
    const items = await res.json();
    el.innerHTML = items.length
      ? items.map((item) => renderPostingRow(item, "unfavorite")).join("")
      : `<p class="mini-empty">Lemmikuid pole veel.</p>`;
    el.querySelectorAll('[data-action="unfavorite"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        await fetch(`/api/me/favorites/${encodeURIComponent(btn.dataset.id)}`, { method: "DELETE" });
        loadFavorites();
      });
    });
  } catch (err) {
    el.innerHTML = `<p class="mini-empty">Laadimine ebaõnnestus.</p>`;
  }
}

async function loadSearches() {
  const el = document.getElementById("searchesList");
  try {
    const res = await fetch("/api/me/searches");
    const items = await res.json();
    el.innerHTML = items.length
      ? items.map(renderSearchRow).join("")
      : `<p class="mini-empty">Salvestatud otsinguid pole veel — need saad lisada otsingulehelt "☆ Salvesta otsing" nupuga.</p>`;
    el.querySelectorAll('[data-action="delete-search"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        await fetch(`/api/me/searches/${encodeURIComponent(btn.dataset.id)}`, { method: "DELETE" });
        loadSearches();
      });
    });
  } catch (err) {
    el.innerHTML = `<p class="mini-empty">Laadimine ebaõnnestus.</p>`;
  }
}

async function loadHistory() {
  const el = document.getElementById("historyList");
  try {
    const res = await fetch("/api/me/history");
    const items = await res.json();
    el.innerHTML = items.length
      ? items.map(renderHistoryRow).join("")
      : `<p class="mini-empty">Vaadatud kuulutusi pole veel.</p>`;
  } catch (err) {
    el.innerHTML = `<p class="mini-empty">Laadimine ebaõnnestus.</p>`;
  }
}

function showAuthForms() {
  authForms.classList.remove("hidden");
  profileContent.classList.add("hidden");
}

function showProfile(user) {
  authForms.classList.add("hidden");
  profileContent.classList.remove("hidden");
  document.getElementById("profileEmail").textContent = user.email;
  document.getElementById("profileCreated").textContent = user.created_at.slice(0, 10);
  loadFavorites();
  loadSearches();
  loadHistory();
}

async function checkAuthAndRender() {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) {
      showAuthForms();
      return;
    }
    showProfile(await res.json());
  } catch (err) {
    showAuthForms();
  }
}

function switchTab(which) {
  document.getElementById("tabLogin").classList.toggle("active", which === "login");
  document.getElementById("tabRegister").classList.toggle("active", which === "register");
  document.getElementById("loginForm").classList.toggle("hidden", which !== "login");
  document.getElementById("registerForm").classList.toggle("hidden", which !== "register");
}

document.getElementById("tabLogin").addEventListener("click", () => switchTab("login"));
document.getElementById("tabRegister").addEventListener("click", () => switchTab("register"));

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("loginError");
  errorEl.textContent = "";
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.email.value, password: form.password.value }),
    });
    const body = await res.json();
    if (!res.ok) {
      errorEl.textContent = body.error || "Sisselogimine ebaõnnestus";
      return;
    }
    showProfile(body);
  } catch (err) {
    errorEl.textContent = `Päring ebaõnnestus: ${err.message}`;
  }
});

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById("registerError");
  errorEl.textContent = "";
  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.email.value, password: form.password.value }),
    });
    const body = await res.json();
    if (!res.ok) {
      errorEl.textContent = body.error || "Konto loomine ebaõnnestus";
      return;
    }
    showProfile(body);
  } catch (err) {
    errorEl.textContent = `Päring ebaõnnestus: ${err.message}`;
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  showAuthForms();
});

checkAuthAndRender();
