import { createCookieClient, type ZtsClient } from "@zts/api-client";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/themes/prism-tomorrow.css";
import "./ui.css";

// ---- Client ----

export const client: ZtsClient = createCookieClient();

// ---- Raw fetch for non-client operations (login/logout) ----

export async function api(path: string, opts: RequestInit = {}): Promise<Response> {
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

// ---- Utilities ----

export function $(sel: string, root: ParentNode = document): Element | null {
  return root.querySelector(sel);
}

export function $$(sel: string, root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(sel)];
}

type Attrs = Record<string, string | EventListener>;

export function h(
  tag: string,
  attrs: Attrs = {},
  ...children: (string | Node | null | undefined)[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v as string;
    else if (k.startsWith("on"))
      el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, v as string);
  }
  for (const c of children) {
    if (typeof c === "string") el.append(c);
    else if (c) el.append(c);
  }
  return el;
}

export function shortHash(hash: string): string {
  return hash?.slice(0, 8) ?? "";
}

export function relTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

export function highlightTs(code: string): string {
  return Prism.highlight(code, Prism.languages.typescript, "typescript");
}

// ---- Auth ----

$("#logout-btn")!.addEventListener("click", async () => {
  await fetch("/ui/logout", { method: "POST", credentials: "same-origin" });
  location.href = "/ui/login.html";
});

// ---- Router ----

type PageRenderer = (args: string[]) => Promise<HTMLElement> | HTMLElement;

const pages: Record<string, PageRenderer> = {};
const content = $("#page-content")!;

export function registerPage(name: string, renderFn: PageRenderer): void {
  pages[name] = renderFn;
}

function parseRoute(hash: string): { page: string; args: string[] } {
  const raw = hash.replace(/^#\/?/, "") || "dashboard";
  const parts = raw.split("/");
  return { page: parts[0], args: parts.slice(1) };
}

export async function navigate(hash: string): Promise<void> {
  const { page, args } = parseRoute(hash);

  for (const a of $$(".sidebar-nav a")) {
    (a as HTMLElement).classList.toggle(
      "active",
      (a as HTMLElement).dataset.page === page,
    );
  }

  ($("#sidebar") as HTMLElement).classList.remove("open");

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
    if ((e as Error).message === "auth") return;
    content.innerHTML = `<div class="empty">Error: ${(e as Error).message}</div>`;
  }
}

globalThis.addEventListener("hashchange", () => navigate(location.hash));

$("#menu-toggle")!.addEventListener("click", () => {
  ($("#sidebar") as HTMLElement).classList.toggle("open");
});

// ---- Init ----

async function init() {
  try {
    await Promise.all([
      import("./pages/dashboard"),
      import("./pages/atom"),
      import("./pages/search"),
      import("./pages/graph"),
      import("./pages/starred"),
      import("./pages/goals"),
      import("./pages/log"),
      import("./pages/prompts"),
    ]);
  } catch (e) {
    console.error("[zts-ui] page load failed:", e);
  }

  ($("#app") as HTMLElement).hidden = false;
  navigate(location.hash || "#/dashboard");
}

setTimeout(init, 0);
