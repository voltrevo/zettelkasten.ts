import { apiJson, h, registerPage, relTime, shortHash } from "../app.js";

registerPage("search", async () => {
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
  });
  const searchBtn = h("button", { class: "btn btn-sm" }, "Search");
  const goalSelect = h("select", { style: "font-size:0.85rem" });
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
    const goals = await apiJson("/goals?all=1");
    for (const g of goals) {
      goalSelect.append(h("option", { value: g.name }, g.name));
    }
  } catch { /* ignore */ }

  function setMode(m) {
    mode = m;
    semanticTab.classList.toggle("active", m === "semantic");
    codeTab.classList.toggle("active", m === "code");
    input.placeholder = m === "semantic"
      ? "Search descriptions..."
      : "Search source code...";
  }

  searchBtn.addEventListener("click", doSearch);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });
  goalSelect.addEventListener("change", doSearch);
  row.querySelector(".broken-check").addEventListener("change", doSearch);

  async function doSearch() {
    const q = input.value.trim();
    const goal = goalSelect.value;
    const broken = row.querySelector(".broken-check").checked;

    results.innerHTML = '<div class="loading">Loading</div>';

    try {
      let data;
      if (!q) {
        // Browse mode — show recent atoms
        const params = new URLSearchParams();
        if (goal) params.set("goal", goal);
        if (broken) params.set("broken", "1");
        params.set("n", "50");
        data = await apiJson(`/recent?${params}`);
      } else if (mode === "code") {
        data = await apiJson(
          `/search?code=${encodeURIComponent(q)}&k=50`,
        );
      } else {
        data = await apiJson(
          `/search?q=${encodeURIComponent(q)}&k=50`,
        );
      }

      // Client-side filters for search results
      if (q && goal) data = data.filter((a) => a.goal === goal);
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
        if (item.score != null) {
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
        if (item.goal) {
          top.append(
            h("span", { class: "badge badge-blue" }, item.goal),
          );
        }
        if (item.createdAt) {
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
        if (item.snippet) {
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
      results.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
    }
  }

  // Default: show recent atoms
  await doSearch();
  return root;
});
