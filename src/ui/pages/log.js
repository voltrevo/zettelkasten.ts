import { apiJson, h, registerPage, relTime, shortHash } from "../app.js";

registerPage("log", async () => {
  const root = h("div");
  root.append(h("h1", { class: "page-title" }, "Audit Log"));

  // Filters
  const filterBar = h("div", { class: "filter-bar" });
  const opSelect = h("select");
  opSelect.append(h("option", { value: "" }, "All operations"));
  for (
    const op of [
      "atom.create",
      "atom.delete",
      "atom.describe",
      "rel.create",
      "rel.delete",
      "prop.set",
      "prop.unset",
      "eval.set",
      "goal.create",
      "goal.update",
      "goal.delete",
      "goal.done",
      "goal.undone",
      "goal.comment",
    ]
  ) {
    opSelect.append(h("option", { value: op }, op));
  }
  const recentInput = h("input", {
    type: "text",
    placeholder: "Count (default 50)",
    style: "width:120px",
  });
  filterBar.append(
    opSelect,
    recentInput,
    h("button", { class: "btn btn-sm btn-ghost", onclick: loadLog }, "Refresh"),
  );
  root.append(filterBar);

  const tableWrap = h("div", { class: "table-wrap" });
  const table = h("table");
  table.append(
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", {}, "Time"),
        h("th", {}, "Operation"),
        h("th", {}, "Subject"),
        h("th", {}, "Detail"),
      ),
    ),
  );
  const tbody = h("tbody");
  table.append(tbody);
  tableWrap.append(table);
  root.append(tableWrap);

  async function loadLog() {
    const params = new URLSearchParams();
    const op = opSelect.value;
    if (op) params.set("op", op);
    const recent = recentInput.value.trim();
    params.set("recent", recent || "50");
    const qs = params.toString();

    tbody.replaceChildren(
      h("tr", {}, h("td", { colspan: "4", class: "loading" }, "Loading")),
    );
    const data = await apiJson(`/log?${qs}`);

    tbody.replaceChildren();
    if (data.length === 0) {
      tbody.append(
        h(
          "tr",
          {},
          h("td", { colspan: "4", class: "empty" }, "No log entries"),
        ),
      );
      return;
    }

    for (const entry of data) {
      const opColor = entry.op?.includes("delete")
        ? "var(--red)"
        : entry.op?.includes("create")
        ? "var(--green)"
        : entry.op?.includes("done")
        ? "var(--yellow)"
        : "var(--accent)";

      const tr = h("tr", {});
      tr.append(
        h(
          "td",
          { style: "white-space:nowrap;font-size:0.8rem" },
          relTime(entry.createdAt),
        ),
        h("td", {
          style: `color:${opColor};font-family:var(--mono);font-size:0.8rem`,
        }, entry.op ?? ""),
        h(
          "td",
          {},
          entry.subject
            ? h(
              "a",
              { href: `#/atom/${entry.subject}`, class: "hash" },
              shortHash(entry.subject),
            )
            : "",
        ),
        h(
          "td",
          {
            style:
              "font-size:0.8rem;color:var(--text-2);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
          },
          typeof entry.detail === "string"
            ? entry.detail
            : JSON.stringify(entry.detail ?? ""),
        ),
      );
      tbody.append(tr);
    }
  }

  opSelect.addEventListener("change", loadLog);
  await loadLog();

  return root;
});
