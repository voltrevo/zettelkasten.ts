import { client, h, registerPage, relTime, shortHash } from "../app";

registerPage("dashboard", async () => {
  const [status, logData, goals] = await Promise.all([
    client.getStatus(),
    client.getLog({ recent: 20 }),
    client.listGoals(),
  ]);

  const root = h("div");

  root.append(h("h1", { class: "page-title" }, "Dashboard"));

  const grid = h("div", { class: "stat-grid" });
  const stats: [number, string][] = [
    [status.totalAtoms, "atoms"],
    [status.activeGoals.length, "active goals"],
    [status.defects, "defects"],
    [status.superseded, "superseded"],
    [status.recentAtoms, "this week"],
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
      row.append(
        h("a", {
          href: `#/goals/${g.name}`,
          style: "flex:1;font-size:0.875rem",
        }, g.name),
        h("span", { class: "badge badge-blue" }, `w:${g.weight}`),
        h("span", {
          style: "color:var(--text-2);font-size:0.8rem;font-family:var(--mono)",
        }, `${g.atomCount ?? 0} atoms`),
      );
      goalsCard.append(row);
    }
    root.append(goalsCard);
  }

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

      const opColor = entry.op.includes("delete")
        ? "var(--red)"
        : entry.op.includes("create")
        ? "var(--green)"
        : "var(--accent)";
      item.append(
        h(
          "span",
          { class: "timeline-op", style: `color:${opColor}` },
          entry.op,
        ),
      );

      const detail = h("span", { class: "timeline-detail" });
      if (entry.subject) {
        detail.append(
          h(
            "a",
            { href: `#/atom/${entry.subject}`, class: "hash" },
            shortHash(entry.subject),
          ),
        );
      }
      if (entry.detail) {
        detail.append(` ${entry.detail}`);
      }
      item.append(detail);
      list.append(item);
    }
    root.append(h("div", { class: "card" }, list));
  }

  return root;
});
