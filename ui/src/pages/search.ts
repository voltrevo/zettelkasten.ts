import { client, h, registerPage, relTime, shortHash } from "../app";
import type { AtomSummary, CodeSearchResult, SearchResult } from "@zts/api-client";

let cached: HTMLElement | null = null;

registerPage("search", async () => {
  if (cached) return cached;
  const root = h("div");
  root.append(h("h1", { class: "page-title" }, "Search"));

  // Tabs
  const tabs = h("div", { class: "tabs" });
  const semanticTab = h("button", {
    class: "tab active",
    onclick: () => setMode("semantic"),
  }, "Semantic");
  const codeTab = h(
    "button",
    { class: "tab", onclick: () => setMode("code") },
    "Source Code",
  );
  tabs.append(semanticTab, codeTab);
  root.append(tabs);

  let mode = "semantic";
  const row = h("div", {
    style: "display:flex;gap:0.5rem;margin-bottom:1rem;align-items:center",
  });
  const input = h("input", {
    type: "search",
    placeholder: "Search descriptions...",
    style: "flex:1",
  }) as HTMLInputElement;
  const searchBtn = h("button", { class: "btn btn-sm" }, "Search");
  const goalSelect = h("select", { style: "font-size:0.85rem" }) as HTMLSelectElement;
  goalSelect.append(h("option", { value: "" }, "All goals"));
  const brokenToggle = h(
    "label",
    {
      style:
        "display:flex;align-items:center;gap:0.375rem;font-size:0.8rem;color:var(--text-1);cursor:pointer;white-space:nowrap",
    },
    h("input", { type: "checkbox", class: "broken-check" }),
    "Broken",
  );
  row.append(input, goalSelect, brokenToggle, searchBtn);
  root.append(row);

  const results = h("div");
  root.append(results);

  // Load goals for filter
  try {
    const goals = await client.listGoals({ all: true });
    for (const g of goals) {
      goalSelect.append(h("option", { value: g.name }, g.name));
    }
  } catch { /* ignore */ }

  function setMode(m: string): void {
    mode = m;
    semanticTab.classList.toggle("active", m === "semantic");
    codeTab.classList.toggle("active", m === "code");
    input.placeholder = m === "semantic"
      ? "Search descriptions..."
      : "Search source code...";
  }

  searchBtn.addEventListener("click", doSearch);
  input.addEventListener("keydown", (e: Event) => {
    if ((e as KeyboardEvent).key === "Enter") doSearch();
  });
  goalSelect.addEventListener("change", doSearch);
  (row.querySelector(".broken-check") as HTMLInputElement).addEventListener("change", doSearch);

  async function doSearch(): Promise<void> {
    const q = input.value.trim();
    const goal = goalSelect.value;
    const broken = (row.querySelector(".broken-check") as HTMLInputElement).checked;

    results.innerHTML = '<div class="loading">Loading</div>';

    try {
      let data: (AtomSummary | SearchResult | CodeSearchResult)[];
      if (!q) {
        // Browse mode -- show recent atoms
        data = await client.recent({ n: 50, goal: goal || undefined, broken: broken || undefined });
      } else if (mode === "code") {
        data = await client.searchCode(q, 50);
      } else {
        data = await client.search(q, 50);
      }

      // Client-side filters for search results
      if (q && goal) data = data.filter((a) => (a as AtomSummary).goal === goal);
      if (q && broken) {
        data = data.filter((a) => a.description?.startsWith("BROKEN:"));
      }

      if (data.length === 0) {
        results.innerHTML = '<div class="empty">No results</div>';
        return;
      }

      const list = h("div");
      for (const item of data) {
        const isBroken = item.description?.startsWith("BROKEN:");
        const card = h("div", {
          class: "card",
          style: "cursor:pointer",
          onclick: () => location.hash = `#/atom/${item.hash}`,
        });
        const top = h("div", {
          style:
            "display:flex;align-items:baseline;gap:0.75rem;margin-bottom:0.375rem",
        });
        top.append(
          h(
            "a",
            { href: `#/atom/${item.hash}`, class: "hash" },
            shortHash(item.hash),
          ),
        );
        if ("score" in item && item.score != null) {
          top.append(
            h("span", {
              style:
                "font-family:var(--mono);font-size:0.75rem;color:var(--text-2)",
            }, item.score.toFixed(3)),
          );
        }
        if (isBroken) {
          top.append(
            h("span", { class: "badge badge-red" }, "BROKEN"),
          );
        }
        if ("goal" in item && item.goal) {
          top.append(
            h("span", { class: "badge badge-blue" }, item.goal),
          );
        }
        if ("createdAt" in item && item.createdAt) {
          top.append(
            h("span", {
              style: "font-size:0.75rem;color:var(--text-2)",
            }, relTime(item.createdAt)),
          );
        }
        card.append(top);

        if (item.description) {
          card.append(
            h(
              "div",
              { style: "font-size:0.875rem;color:var(--text-1)" },
              item.description?.replace(/^BROKEN:\s*/, "")?.slice(0, 120) ?? "",
            ),
          );
        }
        if ("snippet" in item && item.snippet) {
          const snip = h("div", {
            class: "code-block",
            style:
              "margin-top:0.5rem;font-size:0.75rem;max-height:120px;overflow:hidden",
          });
          snip.innerHTML = item.snippet;
          card.append(snip);
        }
        list.append(card);
      }
      results.replaceChildren(list);
    } catch (e) {
      results.innerHTML = `<div class="empty">Error: ${(e as Error).message}</div>`;
    }
  }

  // Default: show recent atoms
  await doSearch();
  cached = root;
  return root;
});
