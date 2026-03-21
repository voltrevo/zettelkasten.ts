// ---- API helper (cookie auth — no token in JS) ----

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...opts,
    headers: { "content-type": "application/json", ...opts.headers },
  });
  if (res.status === 401 || res.status === 403) {
    location.href = "/ui/login.html";
    throw new Error("auth");
  }
  return res;
}

export async function apiJson(path, opts) {
  const res = await api(path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ---- Utilities ----

export function $(sel, root = document) {
  return root.querySelector(sel);
}
export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children) {
    if (typeof c === "string") el.append(c);
    else if (c) el.append(c);
  }
  return el;
}

export function shortHash(hash) {
  return hash?.slice(0, 8) ?? "";
}

export function relTime(iso) {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

// ---- Auth ----

$("#logout-btn").addEventListener("click", async () => {
  await fetch("/ui/logout", { method: "POST", credentials: "same-origin" });
  location.href = "/ui/login.html";
});

// ---- Router ----

const pages = {};
const content = $("#page-content");

export function registerPage(name, renderFn) {
  pages[name] = renderFn;
}

function parseRoute(hash) {
  const raw = hash.replace(/^#\/?/, "") || "dashboard";
  const parts = raw.split("/");
  return { page: parts[0], args: parts.slice(1) };
}

export async function navigate(hash) {
  const { page, args } = parseRoute(hash);

  // Update active nav link
  for (const a of $$(".sidebar-nav a")) {
    a.classList.toggle("active", a.dataset.page === page);
  }

  // Close mobile sidebar
  $("#sidebar").classList.remove("open");

  // Render page
  content.innerHTML = '<div class="loading">Loading</div>';
  const render = pages[page];
  if (!render) {
    content.innerHTML = '<div class="empty">Page not found</div>';
    return;
  }
  try {
    const el = await render(args);
    content.replaceChildren(el);
  } catch (e) {
    if (e.message === "auth") return; // handled by api()
    content.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
}

window.addEventListener("hashchange", () => navigate(location.hash));

// Mobile menu toggle
$("#menu-toggle").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
});

// ---- Init: load pages ----
// Deferred to break circular module dependency (pages import from app.js)

async function init() {
  try {
    await Promise.all([
      import("./pages/dashboard.js"),
      import("./pages/atom.js"),
      import("./pages/search.js"),
      import("./pages/graph.js"),
      import("./pages/starred.js"),
      import("./pages/goals.js"),
      import("./pages/log.js"),
      import("./pages/prompts.js"),
    ]);
  } catch (e) {
    console.error("[zts-ui] page load failed:", e);
  }

  $("#app").hidden = false;
  navigate(location.hash || "#/dashboard");
}

setTimeout(init, 0);
