// Login/signup/logout UI, wired into the #authWidget/#authModal markup in
// index.html and profile.html's header. Talks to Supabase via
// supabase-client.js and hands off to supabase-sync.js on sign-in/sign-out.

(function () {
  const widget = document.getElementById("authWidget");
  const modal = document.getElementById("authModal");
  const modalBody = document.getElementById("authModalBody");
  const modalClose = document.getElementById("authModalClose");
  if (!widget || !modal || !modalBody || !modalClose) return;

  let mode = "login"; // "login" | "signup"

  function escapeHtmlLocal(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  function renderLoggedOut() {
    widget.innerHTML = `<button type="button" id="authOpenBtn" class="btn-secondary auth-open-btn">Logi sisse</button>`;
    document.getElementById("authOpenBtn").addEventListener("click", () => openModal("login"));
  }

  function renderLoggedIn(email) {
    widget.innerHTML = `
      <div class="auth-user">
        <span class="auth-email bolt-font-body-s-regular" title="${escapeHtmlLocal(email)}">${escapeHtmlLocal(email)}</span>
        <button type="button" id="authLogoutBtn" class="btn-secondary auth-open-btn">Logi välja</button>
      </div>
    `;
    document.getElementById("authLogoutBtn").addEventListener("click", async () => {
      try {
        await SupabaseAPI.signOut();
      } catch (err) {
        console.error("Logout failed:", err);
      }
    });
  }

  function renderConfirmationNotice() {
    modalBody.innerHTML = `
      <h2 class="bolt-font-heading-s-accent">Kontrolli oma e-posti</h2>
      <p class="bolt-font-body-m-regular">Saatsime sulle kinnituslingi. Kinnita oma e-post ja seejärel logi sisse.</p>
      <button type="button" id="authNoticeOkBtn" class="btn-primary auth-submit">Selge</button>
    `;
    document.getElementById("authNoticeOkBtn").addEventListener("click", closeModal);
  }

  function renderForm(errorMsg) {
    const isSignup = mode === "signup";
    modalBody.innerHTML = `
      <h2 class="bolt-font-heading-s-accent">${isSignup ? "Loo konto" : "Logi sisse"}</h2>
      ${!SupabaseAPI.isConfigured ? `<p class="auth-error">Supabase pole veel seadistatud (public/js/supabase-client.js).</p>` : ""}
      <form id="authForm" class="auth-form">
        <label class="auth-field">
          <span class="bolt-font-body-s-accent">E-post</span>
          <input type="email" name="email" required autocomplete="email">
        </label>
        <label class="auth-field">
          <span class="bolt-font-body-s-accent">Parool</span>
          <input type="password" name="password" required minlength="8" autocomplete="${isSignup ? "new-password" : "current-password"}">
        </label>
        ${errorMsg ? `<p class="auth-error">${escapeHtmlLocal(errorMsg)}</p>` : ""}
        <button type="submit" class="btn-primary auth-submit">${isSignup ? "Registreeru" : "Logi sisse"}</button>
      </form>
      <p class="auth-switch bolt-font-body-s-regular">
        ${isSignup ? "Konto juba olemas?" : "Kontot veel pole?"}
        <button type="button" id="authSwitchBtn" class="auth-switch-btn">${isSignup ? "Logi sisse" : "Registreeru"}</button>
      </p>
    `;

    document.getElementById("authSwitchBtn").addEventListener("click", () => {
      mode = isSignup ? "login" : "signup";
      renderForm();
    });

    document.getElementById("authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const email = form.email.value.trim();
      const password = form.password.value;
      const submitBtn = form.querySelector(".auth-submit");
      submitBtn.disabled = true;
      try {
        if (isSignup) {
          const data = await SupabaseAPI.signUp(email, password);
          if (!data.session) {
            renderConfirmationNotice();
            return;
          }
        } else {
          await SupabaseAPI.signIn(email, password);
        }
        closeModal();
      } catch (err) {
        submitBtn.disabled = false;
        renderForm(err.message || "Midagi läks valesti.");
      }
    });
  }

  function openModal(startMode) {
    mode = startMode;
    renderForm();
    modal.classList.remove("hidden");
  }

  function closeModal() {
    modal.classList.add("hidden");
    modalBody.innerHTML = "";
  }

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  renderLoggedOut();

  if (SupabaseAPI.isConfigured) {
    SupabaseAPI.getSession().then((session) => {
      if (session) {
        renderLoggedIn(session.user.email);
        SupabaseSync.mergeOnLogin(session.user.id).catch((err) => console.error("Login merge failed:", err));
      }
    });

    SupabaseAPI.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        renderLoggedIn(session.user.email);
        SupabaseSync.mergeOnLogin(session.user.id).catch((err) => console.error("Login merge failed:", err));
      } else if (event === "SIGNED_OUT") {
        renderLoggedOut();
        SupabaseSync.clearOnLogout();
        window.dispatchEvent(new Event("supabase-data-changed"));
      }
    });
  }
})();
