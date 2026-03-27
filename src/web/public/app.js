async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
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

async function loadHealth() {
  const data = await fetchJson("/api/health");
  const box = document.getElementById("health");
  box.textContent = JSON.stringify(data, null, 2);
}

async function loadRequests() {
  const data = await fetchJson("/api/requests/recent?limit=10");
  const el = document.getElementById("requests");

  renderList(
    el,
    data.rows,
    (item) =>
      `<li>#${item.request_id} ${item.title} - <strong>${item.status_text}</strong></li>`
  );
}

async function loadLatest() {
  const data = await fetchJson("/api/jellyfin/latest?limit=10");
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
      const data = await fetchJson("/api/request", {
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
  const data = await fetchJson("/api/admin/env");
  const form = document.getElementById("envForm");

  form.innerHTML = data.allowedKeys
    .map((key) => {
      const value = data.values[key] || "";
      const safeValue = value.replace(/"/g, "&quot;");
      return `
        <label>
          ${key}
          <input name="${key}" type="text" value="${safeValue}" />
        </label>
      `;
    })
    .join("");
}

async function saveEnvSettings() {
  const form = document.getElementById("envForm");
  const fields = Array.from(form.querySelectorAll("input[name]"));
  const values = {};

  for (const field of fields) {
    values[field.name] = field.value;
  }

  const response = await fetchJson("/api/admin/env", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values })
  });

  setMessage("envResult", response.message || "Saved.");
}

async function checkSession() {
  try {
    const me = await fetchJson("/api/auth/me");
    return me.user;
  } catch (error) {
    return null;
  }
}

async function showDashboard(user) {
  document.getElementById("loginPanel").classList.add("hidden");
  document.getElementById("dashboardPanel").classList.remove("hidden");
  document.getElementById("sessionUser").textContent = `Logged in as ${user.username}`;

  wireForm();
  await Promise.all([loadHealth(), loadRequests(), loadLatest(), loadEnvSettings()]);

  setInterval(() => {
    loadRequests().catch(console.error);
    loadLatest().catch(console.error);
  }, 30000);
}

function wireAuth() {
  const loginForm = document.getElementById("loginForm");
  const logoutBtn = document.getElementById("logoutBtn");
  const saveEnvBtn = document.getElementById("saveEnvBtn");
  const passwordForm = document.getElementById("passwordForm");

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);

    try {
      const data = await fetchJson("/api/auth/login", {
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
      await fetchJson("/api/auth/logout", { method: "POST" });
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

  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(passwordForm);

    try {
      await fetchJson("/api/auth/change-password", {
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
