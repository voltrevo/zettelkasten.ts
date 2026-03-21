import {
  api,
  apiJson,
  h,
  navigate,
  registerPage,
  relTime,
  shortHash,
} from "../app.js";

registerPage("atom", async (args) => {
  const hash = args[0];
  if (!hash) return h("div", { class: "empty" }, "No hash specified");

  const info = await apiJson(`/info/${hash}`);
  const root = h("div");

  // Breadcrumb
  root.append(
    h(
      "div",
      { class: "breadcrumb" },
      h("a", { href: "#/corpus" }, "Corpus"),
      h("span", { class: "sep" }, "/"),
      shortHash(info.hash),
    ),
  );

  // Header
  const header = h("div", {
    style:
      "display:flex;flex-wrap:wrap;align-items:baseline;gap:1rem;margin-bottom:1.5rem",
  });
  header.append(
    h(
      "h1",
      { class: "page-title", style: "margin:0" },
      h("span", { class: "hash" }, info.hash),
    ),
  );
  if (info.goal) {
    header.append(h("span", { class: "badge badge-blue" }, info.goal));
  }
  if (info.description?.startsWith("BROKEN:")) {
    header.append(h("span", { class: "badge badge-red" }, "BROKEN"));
  }

  const meta = h("div", {
    style:
      "font-size:0.8rem;color:var(--text-2);display:flex;gap:1rem;flex-wrap:wrap",
  });
  if (info.createdAt) {
    meta.append(h("span", {}, `Created ${relTime(info.createdAt)}`));
  }
  if (info.gzipSize != null) {
    const pct = Math.min(100, Math.round(info.gzipSize / 1024 * 100));
    meta.append(
      h(
        "span",
        { class: "size-meter" },
        `${info.gzipSize}/1024B `,
        h(
          "span",
          { class: "progress", style: "width:60px" },
          h("span", { class: "progress-fill", style: `width:${pct}%` }),
        ),
      ),
    );
  }
  header.append(meta);
  root.append(header);

  // Description
  const descSection = h("div", { class: "card", style: "margin-bottom:1rem" });
  const descLabel = h("div", {
    style:
      "font-size:0.75rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.5rem",
  }, "Description");
  const descText = h("textarea", {
    style: "width:100%;min-height:120px",
  });
  descText.value = info.description ?? "";
  const descSave = h("button", {
    class: "btn btn-sm btn-ghost",
    style: "margin-top:0.5rem",
  }, "Save");
  const descStatus = h("span", {
    style: "font-size:0.8rem;color:var(--text-2);margin-left:0.5rem",
  });
  descSave.addEventListener("click", async () => {
    try {
      const res = await api(`/a/${info.hash}/description`, {
        method: "POST",
        body: descText.value,
        headers: { "content-type": "text/plain" },
      });
      if (res.ok) {
        await navigate(`#/atom/${info.hash}`);
      } else {
        descStatus.textContent = await res.text();
        descStatus.style.color = "var(--red)";
      }
    } catch (e) {
      descStatus.textContent = e.message;
      descStatus.style.color = "var(--red)";
    }
  });
  descSection.append(descLabel, descText, h("div", {}, descSave, descStatus));
  root.append(descSection);

  // Source code
  const sourceSection = h("div", { style: "margin-bottom:1rem" });
  if (info.source) {
    const pre = h("pre", {
      class: "code-block",
      style: "margin:0;overflow-x:auto",
    });
    const code = h("code", { class: "language-typescript" });
    code.textContent = info.source;
    pre.append(code);
    // deno-lint-ignore no-window
    if (window.Prism) window.Prism.highlightElement(code);
    // Make import paths clickable
    for (const str of code.querySelectorAll(".token.string")) {
      const m = str.textContent.match(
        /["']\.\.\/\.\.\/([a-z0-9]{2})\/([a-z0-9]{2})\/([a-z0-9]{21})\.ts["']/,
      );
      if (m) {
        const hash = m[1] + m[2] + m[3];
        const link = document.createElement("a");
        link.href = `#/atom/${hash}`;
        link.textContent = str.textContent;
        link.style.color = "inherit";
        link.style.textDecoration = "none";
        str.replaceChildren(link);
      }
    }
    sourceSection.append(pre);
  } else {
    sourceSection.append(
      h("div", { class: "code-block" }, "(no source)"),
    );
  }
  // Imported By (above source code)
  const headingStyle =
    "font-size:0.75rem;color:var(--text-2);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.25rem";

  function hashList(title, hashes) {
    const section = h("div", { style: "margin-bottom:0.75rem" });
    const count = hashes?.length ?? 0;
    section.append(h("div", { style: headingStyle }, `${title} (${count})`));
    if (count > 0) {
      const list = h("div", {
        style: "display:flex;flex-wrap:wrap;gap:0.5rem",
      });
      for (const hash of hashes) {
        list.append(
          h("a", { href: `#/atom/${hash}`, class: "hash" }, shortHash(hash)),
        );
      }
      section.append(list);
    }
    return section;
  }

  const importedByBox = h("div", { class: "card", style: "margin-bottom:1rem" });
  importedByBox.append(hashList("Imported By", info.importedBy));
  root.append(importedByBox);

  root.append(sourceSection);

  // Relationships
  const tabSection = h("div", { class: "card" });
  tabSection.append(hashList("Tests", info.tests));
  tabSection.append(hashList("Tested By", info.testedBy));

  // Properties
  const props = info.properties ?? [];
  const propsSection = h("div", { style: "margin-bottom:0.75rem" });
  propsSection.append(
    h("div", { style: headingStyle }, `Properties (${props.length})`),
  );
  if (props.length > 0) {
    for (const p of props) {
      propsSection.append(
        h(
          "div",
          { style: "padding:0.15rem 0;font-size:0.875rem" },
          h(
            "span",
            { style: "color:var(--accent);font-family:var(--mono)" },
            p.key,
          ),
          p.value
            ? h(
              "span",
              { style: "color:var(--text-2);margin-left:0.5rem" },
              `= ${p.value}`,
            )
            : "",
        ),
      );
    }
  }
  tabSection.append(propsSection);

  // Test runs
  const runsSection = h("div", { style: "margin-bottom:0.75rem" });
  try {
    const runs = await apiJson(`/test-runs?target=${info.hash}&recent=10`);
    runsSection.append(h("div", {
      style: headingStyle,
    }, `Test Runs (${runs.length})`));
    if (runs.length > 0) {
      const runTable = h("table");
      runTable.append(
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", {}, "Test"),
            h("th", {}, "Result"),
            h("th", {}, "Duration"),
            h("th", {}, "When"),
          ),
        ),
      );
      const runTbody = h("tbody");
      for (const run of runs) {
        runTbody.append(
          h(
            "tr",
            {},
            h(
              "td",
              {},
              h(
                "a",
                { href: `#/atom/${run.testAtom}`, class: "hash" },
                shortHash(run.testAtom),
              ),
            ),
            h(
              "td",
              {},
              h("span", {
                class: run.result === "pass"
                  ? "badge badge-green"
                  : "badge badge-red",
              }, run.result === "pass" ? "PASS" : "FAIL"),
            ),
            h(
              "td",
              { style: "font-family:var(--mono);font-size:0.8rem" },
              run.durationMs != null ? `${run.durationMs}ms` : "",
            ),
            h("td", {}, relTime(run.ranAt)),
          ),
        );
      }
      runTable.append(runTbody);
      runsSection.append(h("div", { class: "table-wrap" }, runTable));
    }
  } catch {
    runsSection.append(h("div", { style: headingStyle }, "Test Runs (0)"));
  }
  tabSection.append(runsSection);

  root.append(tabSection);

  // Similar atoms
  const similarSection = h("div", { class: "card", style: "margin-top:1rem" });
  similarSection.append(h("div", { style: headingStyle }, "Similar"));
  try {
    const hits = await apiJson(`/similar/${info.hash}?k=10`);
    if (hits.length === 0) {
      similarSection.append(
        h("div", { style: "font-size:0.8rem;color:var(--text-2)" }, "none"),
      );
    } else {
      for (const hit of hits) {
        const row = h("div", {
          style:
            "display:flex;align-items:baseline;gap:0.75rem;padding:0.375rem 0;border-bottom:1px solid var(--border)",
        });
        row.append(
          h("span", {
            style:
              "color:var(--text-2);font-family:var(--mono);font-size:0.75rem;flex-shrink:0",
          }, hit.score.toFixed(3)),
          h("a", {
            href: `#/atom/${hit.hash}`,
            class: "hash",
            style: "flex-shrink:0",
          }, shortHash(hit.hash)),
          h("span", {
            style: "font-size:0.875rem;color:var(--text-1)",
          }, hit.description?.slice(0, 80) ?? ""),
        );
        similarSection.append(row);
      }
    }
  } catch { /* no embedding */ }
  root.append(similarSection);

  // Actions
  const actions = h("div", {
    style: "margin-top:1.5rem;display:flex;gap:0.75rem;flex-wrap:wrap",
  });
  actions.append(
    h("a", {
      href: `/bundle/${info.hash}`,
      class: "btn btn-ghost btn-sm",
      download: "",
    }, "Download Bundle"),
  );

  const deleteBtn = h("button", { class: "btn btn-sm btn-danger" }, "Delete");
  const deleteStatus = h("span", {
    style: "font-size:0.8rem;margin-left:0.5rem",
  });
  deleteBtn.addEventListener("click", async () => {
    if (
      !confirm(`Delete atom ${shortHash(info.hash)}? This cannot be undone.`)
    ) return;
    const res = await api(`/a/${info.hash}`, { method: "DELETE" });
    if (res.ok) {
      location.hash = "#/corpus";
    } else {
      deleteStatus.textContent = await res.text();
      deleteStatus.style.color = "var(--red)";
    }
  });
  actions.append(deleteBtn, deleteStatus);
  root.append(actions);

  return root;
});
