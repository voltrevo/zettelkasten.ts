import { client, h, registerPage, relTime, shortHash } from "../app";
// Lazy-load marked to keep bundle small
let _marked: typeof import("marked") | null = null;
async function getMarked() {
  if (!_marked) _marked = await import("marked");
  return _marked;
}

registerPage("goals", async (args: string[]) => {
  // If subpath, show goal detail
  if (args.length > 0) return goalDetail(decodeURIComponent(args.join("/")));
  return goalList();
});

async function goalList(): Promise<HTMLElement> {
  const root = h("div");
  root.append(h("h1", { class: "page-title" }, "Goals"));

  const tabs = h("div", { class: "tabs" });
  let filter = "active";
  const activeTab = h("button", {
    class: "tab active",
    onclick: () => setFilter("active"),
  }, "Active");
  const doneTab = h("button", {
    class: "tab",
    onclick: () => setFilter("done"),
  }, "Done");
  const allTab = h(
    "button",
    { class: "tab", onclick: () => setFilter("all") },
    "All",
  );
  tabs.append(activeTab, doneTab, allTab);
  root.append(tabs);

  const list = h("div");
  root.append(list);

  async function setFilter(f: string): Promise<void> {
    filter = f;
    activeTab.classList.toggle("active", f === "active");
    doneTab.classList.toggle("active", f === "done");
    allTab.classList.toggle("active", f === "all");
    await renderList();
  }

  async function renderList(): Promise<void> {
    list.innerHTML = '<div class="loading">Loading</div>';
    const opts = filter === "done"
      ? { done: true }
      : filter === "all"
      ? { all: true }
      : {};
    const goals = await client.listGoals(opts);

    if (goals.length === 0) {
      list.innerHTML = '<div class="empty">No goals</div>';
      return;
    }

    const cards = h("div");
    for (const g of goals) {
      const card = h("div", {
        class: "card",
        style: "cursor:pointer",
        onclick: () => location.hash = `#/goals/${encodeURIComponent(g.name)}`,
      });
      const top = h("div", {
        style: "display:flex;align-items:baseline;gap:0.75rem",
      });
      top.append(
        h("a", {
          href: `#/goals/${encodeURIComponent(g.name)}`,
          style: "font-weight:600;font-size:0.9375rem",
        }, g.name),
      );
      top.append(
        h("span", { class: "badge badge-blue" }, `w:${g.weight ?? 1}`),
      );
      if (g.done) {
        top.append(h("span", { class: "badge badge-green" }, "done"));
      }
      if (g.atomCount) {
        top.append(
          h("span", {
            style:
              "color:var(--text-2);font-size:0.8rem;font-family:var(--mono)",
          }, `${g.atomCount} atoms`),
        );
      }
      card.append(top);
      if (g.body) {
        card.append(
          h("div", {
            style:
              "font-size:0.8rem;color:var(--text-1);margin-top:0.375rem;white-space:pre-wrap",
          }, g.body.slice(0, 200)),
        );
      }
      cards.append(card);
    }
    list.replaceChildren(cards);
  }

  await renderList();
  return root;
}

async function goalDetail(name: string): Promise<HTMLElement> {
  const goal = await client.getGoal(name);
  const marked = await getMarked();
  const root = h("div");

  root.append(
    h(
      "div",
      { class: "breadcrumb" },
      h("a", { href: "#/goals" }, "Goals"),
      h("span", { class: "sep" }, "/"),
      name,
    ),
  );

  const header = h("div", {
    style: "display:flex;align-items:baseline;gap:0.75rem;margin-bottom:1rem",
  });
  header.append(h("h1", { class: "page-title", style: "margin:0" }, name));
  header.append(
    h("span", { class: "badge badge-blue" }, `w:${goal.weight ?? 1}`),
  );
  if (goal.done) {
    header.append(h("span", { class: "badge badge-green" }, "done"));
  }
  if (goal.hasFiles) {
    header.append(h("span", { class: "badge" }, "directory"));
  }
  root.append(header);

  // Body / file browser
  if (goal.hasFiles) {
    let fileList: string[] = [];
    try {
      fileList = await client.goalFiles(name);
    } catch { /* no files */ }

    const browser = h("div", {
      style: "display:flex;gap:1rem;margin-bottom:1.5rem",
    });

    const sidebar = h("div", {
      style:
        "min-width:10rem;max-width:14rem;border-right:1px solid var(--border);padding-right:1rem",
    });
    sidebar.append(
      h("div", {
        style: "font-size:0.75rem;color:var(--text-2);margin-bottom:0.5rem",
      }, "Files"),
    );

    const contentArea = h("div", {
      class: "markdown-body",
      style:
        "flex:1;font-size:0.875rem;line-height:1.5;min-width:0;max-height:70vh;overflow-y:auto",
    });

    async function showFile(path: string) {
      try {
        const text = await client.goalFile(name, path);
        contentArea.innerHTML = marked.marked.parse(text, {
          async: false,
        }) as string;
        // Intercept relative links to navigate within goal files
        contentArea.querySelectorAll("a").forEach((a: HTMLAnchorElement) => {
          const href = a.getAttribute("href");
          if (href && !href.startsWith("http") && !href.startsWith("#")) {
            a.addEventListener("click", (e: Event) => {
              e.preventDefault();
              showFile(href);
              // Update active state in sidebar
              sidebar.querySelectorAll("a").forEach((s: Element) =>
                (s as HTMLElement).style.fontWeight = s.textContent === href
                  ? "600"
                  : ""
              );
            });
          }
        });
      } catch {
        contentArea.textContent = `Failed to load ${path}`;
      }
      // Update active state
      sidebar.querySelectorAll("a").forEach((s: Element) =>
        (s as HTMLElement).style.fontWeight = s.textContent === path
          ? "600"
          : ""
      );
    }

    for (const f of fileList) {
      const link = h("a", {
        href: "javascript:void(0)",
        style:
          "display:block;font-size:0.8rem;font-family:var(--mono);padding:0.2rem 0;color:var(--link)",
        onclick: () => showFile(f),
      }, f);
      sidebar.append(link);
    }

    browser.append(sidebar, contentArea);
    root.append(h("div", { class: "card" }, browser));

    // Load README.md by default
    if (fileList.includes("README.md")) {
      await showFile("README.md");
    } else if (fileList.length > 0) {
      await showFile(fileList[0]);
    }
  } else {
    // Simple text goal — just render body
    const bodySection = h("div", {
      class: "card",
      style: "margin-bottom:1rem",
    });
    const rendered = h("div", {
      class: "markdown-body",
      style:
        "font-size:0.875rem;line-height:1.5;max-height:70vh;overflow-y:auto",
    });
    rendered.innerHTML = marked.marked.parse(goal.body ?? "", {
      async: false,
    }) as string;
    bodySection.append(rendered);
    root.append(bodySection);
  }

  // Atoms contributing to this goal
  const atoms = await client.recent({ goal: name, all: true });
  if (atoms.length > 0) {
    root.append(
      h("h2", {
        style:
          "font-size:1.1rem;font-family:var(--mono);font-weight:600;margin-bottom:1rem",
      }, `Atoms (${atoms.length})`),
    );
    const atomList = h("div", { class: "card" });
    for (const a of atoms) {
      const row = h("div", {
        style:
          "display:flex;align-items:baseline;gap:0.75rem;padding:0.375rem 0;border-bottom:1px solid var(--border)",
      });
      row.append(
        h("a", {
          href: `#/atom/${a.hash}`,
          class: "hash",
          style: "font-family:var(--mono);font-size:0.8rem",
        }, shortHash(a.hash)),
      );
      row.append(
        h("span", {
          style: "flex:1;font-size:0.875rem;color:var(--text-1)",
        }, a.description || ""),
      );
      row.append(
        h("span", {
          style: "font-size:0.75rem;color:var(--text-2);white-space:nowrap",
        }, relTime(a.createdAt)),
      );
      atomList.append(row);
    }
    root.append(atomList);
  }

  root.append(h("div", { style: "margin-top:2rem" }));

  // Comments
  root.append(
    h("h2", {
      style:
        "font-size:1.1rem;font-family:var(--mono);font-weight:600;margin-bottom:1rem",
    }, "Comments"),
  );

  const comments = goal.comments ?? [];
  const commentList = h("div");
  if (comments.length === 0) {
    commentList.append(h("div", { class: "empty" }, "No comments yet"));
  } else {
    for (const c of comments) {
      const item = h("div", {
        style: "padding:0.5rem 0;border-bottom:1px solid var(--border)",
      });
      item.append(
        h("div", {
          style: "font-size:0.75rem;color:var(--text-2);margin-bottom:0.25rem",
        }, relTime(c.createdAt)),
      );
      item.append(
        h("div", {
          style: "font-size:0.875rem;color:var(--text-1);white-space:pre-wrap",
        }, c.body),
      );
      commentList.append(item);
    }
  }
  root.append(h("div", { class: "card" }, commentList));

  return root;
}
