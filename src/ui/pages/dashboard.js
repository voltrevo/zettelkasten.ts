import { apiJson, h, registerPage, relTime, shortHash } from "../app.js";

registerPage("dashboard", async () => {
  const [status, logData, goals] = await Promise.all([
    apiJson("/status"),
    apiJson("/log?recent=20"),
    apiJson("/goals"),
  ]);

  const root = h("div");

  // Title
  root.append(h("h1", { class: "page-title" }, "Dashboard"));

  // Stat cards
  const grid = h("div", { class: "stat-grid" });
  const stats = [
    [status.totalAtoms ?? 0, "atoms"],
    [status.activeGoals?.length ?? 0, "active goals"],
    [status.defects ?? 0, "defects"],
    [status.superseded ?? 0, "superseded"],
    [status.recentAtoms ?? 0, "this week"],
  ];
  for (const [val, label] of stats) {
    grid.append(
      h(
        "div",
        { class: "stat-card" },
        h("div", { class: "stat-value" }, String(val)),
        h("div", { class: "stat-label" }, label),
      ),
    );
  }
  root.append(grid);

  // Goals progress
  const activeGoals = goals.filter((g) => !g.done);
  if (activeGoals.length > 0) {
    root.append(
      h("h2", {
        class: "page-title",
        style: "font-size:1.1rem;margin-top:1rem",
      }, "Goals"),
    );
    const goalsCard = h("div", { class: "card" });
    for (const g of activeGoals) {
      const row = h("div", {
        style: "display:flex;align-items:center;gap:0.75rem;padding:0.375rem 0",
      });
      const link = h("a", {
        href: `#/goals/${g.name}`,
        style: "flex:1;font-size:0.875rem",
      }, g.name);
      const weight = h(
        "span",
        { class: "badge badge-blue" },
        `w:${g.weight ?? 1}`,
      );
      const count = h("span", {
        style: "color:var(--text-2);font-size:0.8rem;font-family:var(--mono)",
      }, `${g.atomCount ?? 0} atoms`);
      row.append(link, weight, count);
      goalsCard.append(row);
    }
    root.append(goalsCard);
  }

  // Recent activity
  root.append(
    h(
      "h2",
      { class: "page-title", style: "font-size:1.1rem;margin-top:2rem" },
      "Recent Activity",
    ),
  );
  if (logData.length === 0) {
    root.append(h("div", { class: "empty" }, "No recent activity"));
  } else {
    const list = h("ul", { class: "timeline" });
    for (const entry of logData) {
      const item = h("li", { class: "timeline-item" });
      item.append(
        h("span", { class: "timeline-time" }, relTime(entry.createdAt)),
      );

      const opColor = entry.op?.includes("delete")
        ? "var(--red)"
        : entry.op?.includes("create")
        ? "var(--green)"
        : "var(--accent)";
      item.append(
        h(
          "span",
          { class: "timeline-op", style: `color:${opColor}` },
          entry.op ?? "",
        ),
      );

      const detail = h("span", { class: "timeline-detail" });
      if (entry.subject) {
        const link = h(
          "a",
          { href: `#/atom/${entry.subject}`, class: "hash" },
          shortHash(entry.subject),
        );
        detail.append(link);
      }
      if (entry.detail) {
        detail.append(
          " " +
            (typeof entry.detail === "string"
              ? entry.detail
              : JSON.stringify(entry.detail)),
        );
      }
      item.append(detail);
      list.append(item);
    }
    root.append(h("div", { class: "card" }, list));
  }

  return root;
});
