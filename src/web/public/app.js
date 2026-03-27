async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setMessage(id, text, isError = false) {
  const el = document.getElementById(id);
  el.textContent = text || "";
  el.style.color = isError ? "#ff6c77" : "#6ae3b9";
}

function renderList(element, items, formatter) {
  if (!items || items.length === 0) {
    element.innerHTML = "<li>No data yet.</li>";
    return;
  }

  element.innerHTML = items.map(formatter).join("");
}

function showPanel(panelId) {
  for (const id of ["setupPanel", "loginPanel", "dashboardPanel"]) {
    const el = document.getElementById(id);
    if (!el) {
      continue;
    }

    if (id === panelId) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }
}

function renderEnvForm(targetId, allowedKeys, values) {
  const form = document.getElementById(targetId);

  const groups = [
    {
      title: "Discord",
      keys: ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID"]
    },
    {
      title: "Overseerr",
      keys: [
        "OVERSEERR_URL",
        "OVERSEERR_BASE_URL",
        "OVERSEERR_API_KEY",
        "OVERSEERR_DEFAULT_USER_ID",
        "OVERSEERR_ALLOW_INSECURE_TLS"
      ]
    },
    {
      title: "Jellyfin",
      keys: [
        "JELLYFIN_URL",
        "JELLYFIN_BASE_URL",
        "JELLYFIN_API_KEY",
        "JELLYFIN_USER_ID",
        "JELLYFIN_USERNAME",
        "JELLYFIN_CLIENT_NAME",
        "JELLYFIN_DEVICE_NAME",
        "JELLYFIN_DEVICE_ID",
        "JELLYFIN_CLIENT_VERSION",
        "JELLYFIN_ALLOW_INSECURE_TLS"
      ]
    },
    {
      title: "App And Reverse Proxy",
      keys: ["PORT", "REQUEST_STATUS_POLL_SECONDS", "LOG_LEVEL", "TRUST_PROXY", "APP_BASE_PATH"]
    }
  ];

  const seen = new Set(groups.flatMap((group) => group.keys));
  const extraKeys = allowedKeys.filter((key) => !seen.has(key));
  if (extraKeys.length > 0) {
    groups.push({ title: "Other", keys: extraKeys });
  }

  const allowedSet = new Set(allowedKeys);

  form.innerHTML = groups
    .map((group) => {
      const keys = group.keys.filter((key) => allowedSet.has(key));
      if (keys.length === 0) {
        return "";
      }

      const fields = keys
        .map((key) => {
          const safeValue = escapeHtml(values[key] || "");
          const label =
            key === "OVERSEERR_BASE_URL" || key === "JELLYFIN_BASE_URL"
              ? `${key} (legacy)`
              : key;
          return `
            <label>
              ${label}
              <input name="${key}" type="text" value="${safeValue}" />
            </label>
          `;
        })
        .join("");

      return `
        <section class="settings-group">
          <h3>${group.title}</h3>
          <div class="settings-group-grid">${fields}</div>
        </section>
      `;
    })
    .join("");
}

async function loadHealth() {
  const data = await fetchJson("api/health");
  const box = document.getElementById("health");
  box.textContent = JSON.stringify(data, null, 2);
}

async function loadRequests() {
  const data = await fetchJson("api/requests/recent?limit=10");
  const el = document.getElementById("requests");

  renderList(
    el,
    data.rows,
    (item) =>
      `<li>#${item.request_id} ${item.title} - <strong>${item.status_text}</strong></li>`
  );
}

async function loadLatest() {
  const data = await fetchJson("api/jellyfin/latest?limit=10");
  const el = document.getElementById("latest");

  renderList(
    el,
    data.items,
    (item) =>
      `<li>${item.name} <span>(${item.type}${item.productionYear ? `, ${item.productionYear}` : ""})</span></li>`
  );
}

function wireForm() {
  const form = document.getElementById("requestForm");
  const result = document.getElementById("requestResult");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const payload = {
      mediaType: String(formData.get("mediaType") || "movie"),
      mediaId: Number(formData.get("mediaId"))
    };

    try {
      const data = await fetchJson("api/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      result.textContent = `Submitted ${data.title || "request"} with status ${data.statusText}`;
      await loadRequests();
    } catch (error) {
      result.textContent = error.message;
      result.style.color = "#ff6c77";
    }
  });
}

async function loadEnvSettings() {
  const data = await fetchJson("api/admin/env");
  renderEnvForm("envForm", data.allowedKeys, data.values);
}

async function saveEnvSettings() {
  const form = document.getElementById("envForm");
  const fields = Array.from(form.querySelectorAll("input[name]"));
  const values = {};

  for (const field of fields) {
    values[field.name] = field.value;
  }

  const response = await fetchJson("api/admin/env", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values })
  });

  setMessage("envResult", response.message || "Saved.");
}

async function loadBotConfig() {
  const data = await fetchJson("api/admin/bot-config");
  const form = document.getElementById("botConfigForm");

  const textFields = [
    "requestsChannelId",
    "uploadsChannelId",
    "updatesChannelId",
    "requestRoleId",
    "requestAnnouncementTemplate",
    "availableAnnouncementTemplate",
    "statusAnnouncementTemplate"
  ];

  const boolFields = [
    "enforceRequestChannel",
    "announceOnRequestCreated",
    "announceOnAvailable",
    "announceOnAnyStatus",
    "dmOnStatusChange",
    "mentionRequesterInChannel",
    "useRichEmbeds"
  ];

  for (const name of textFields) {
    const el = form.querySelector(`[name="${name}"]`);
    if (el) {
      el.value = data.values[name] || "";
    }
  }

  for (const name of boolFields) {
    const el = form.querySelector(`[name="${name}"]`);
    if (el) {
      el.checked = String(data.values[name] || "false") === "true";
    }
  }
}

async function saveBotConfig() {
  const form = document.getElementById("botConfigForm");
  const values = {};

  const textFields = [
    "requestsChannelId",
    "uploadsChannelId",
    "updatesChannelId",
    "requestRoleId",
    "requestAnnouncementTemplate",
    "availableAnnouncementTemplate",
    "statusAnnouncementTemplate"
  ];

  const boolFields = [
    "enforceRequestChannel",
    "announceOnRequestCreated",
    "announceOnAvailable",
    "announceOnAnyStatus",
    "dmOnStatusChange",
    "mentionRequesterInChannel",
    "useRichEmbeds"
  ];

  for (const name of textFields) {
    const el = form.querySelector(`[name="${name}"]`);
    values[name] = el ? String(el.value || "").trim() : "";
  }

  for (const name of boolFields) {
    const el = form.querySelector(`[name="${name}"]`);
    values[name] = el?.checked ? "true" : "false";
  }

  const response = await fetchJson("api/admin/bot-config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values })
  });

  setMessage("botConfigResult", response.message || "Bot config saved.");
}

async function backfillRequests() {
  const response = await fetchJson("api/admin/requests/backfill", {
    method: "POST"
  });

  setMessage("backfillResult", response.message || "Backfill complete.");
  await loadRequests();
}

async function checkSession() {
  try {
    const me = await fetchJson("api/auth/me");
    return me.user;
  } catch (error) {
    return null;
  }
}

async function loadSetupStatus() {
  return fetchJson("api/setup/status");
}

async function showDashboard(user) {
  showPanel("dashboardPanel");
  document.getElementById("sessionUser").textContent = `Logged in as ${user.username}`;

  wireForm();
  await Promise.all([loadHealth(), loadRequests(), loadLatest(), loadEnvSettings(), loadBotConfig()]);

  setInterval(() => {
    loadRequests().catch(console.error);
    loadLatest().catch(console.error);
  }, 30000);
}

function wireAuth() {
  const setupForm = document.getElementById("setupForm");
  const loginForm = document.getElementById("loginForm");
  const logoutBtn = document.getElementById("logoutBtn");
  const saveEnvBtn = document.getElementById("saveEnvBtn");
  const saveBotConfigBtn = document.getElementById("saveBotConfigBtn");
  const backfillRequestsBtn = document.getElementById("backfillRequestsBtn");
  const passwordForm = document.getElementById("passwordForm");

  setupForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(setupForm);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");

    if (password !== confirmPassword) {
      setMessage("setupResult", "Passwords do not match.", true);
      return;
    }

    const envValues = {};
    for (const [key, value] of formData.entries()) {
      if (!["username", "password", "confirmPassword"].includes(key)) {
        envValues[key] = String(value || "");
      }
    }

    try {
      const response = await fetchJson("api/setup/initialize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username: String(formData.get("username") || "").trim(),
          password,
          values: envValues
        })
      });

      setMessage(
        "setupResult",
        "First-run setup complete. Restart after changing Discord credentials if you filled them in now."
      );
      await showDashboard({ username: response.username });
    } catch (error) {
      setMessage("setupResult", error.message, true);
    }
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);

    try {
      const data = await fetchJson("api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username: String(formData.get("username") || "").trim(),
          password: String(formData.get("password") || "")
        })
      });

      setMessage("loginResult", "Login successful.");
      await showDashboard({ username: data.username });
    } catch (error) {
      setMessage("loginResult", error.message, true);
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try {
      await fetchJson("api/auth/logout", { method: "POST" });
      location.reload();
    } catch (error) {
      alert(error.message);
    }
  });

  saveEnvBtn.addEventListener("click", async () => {
    try {
      await saveEnvSettings();
    } catch (error) {
      setMessage("envResult", error.message, true);
    }
  });

  saveBotConfigBtn.addEventListener("click", async () => {
    try {
      await saveBotConfig();
    } catch (error) {
      setMessage("botConfigResult", error.message, true);
    }
  });

  backfillRequestsBtn.addEventListener("click", async () => {
    try {
      await backfillRequests();
    } catch (error) {
      setMessage("backfillResult", error.message, true);
    }
  });

  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(passwordForm);

    try {
      await fetchJson("api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          currentPassword: String(formData.get("currentPassword") || ""),
          newPassword: String(formData.get("newPassword") || "")
        })
      });

      passwordForm.reset();
      setMessage("passwordResult", "Password updated.");
    } catch (error) {
      setMessage("passwordResult", error.message, true);
    }
  });
}

async function init() {
  wireAuth();

  const setup = await loadSetupStatus();
  if (setup.setupRequired) {
    renderEnvForm("setupEnvForm", setup.allowedKeys, setup.values);
    showPanel("setupPanel");
    return;
  }

  showPanel("loginPanel");

  const user = await checkSession();
  if (user) {
    await showDashboard(user);
  }
}

init().catch((error) => {
  console.error(error);
  const box = document.getElementById("health");
  box.textContent = `Dashboard load failed: ${error.message}`;
});
