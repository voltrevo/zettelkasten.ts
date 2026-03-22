import { client, h, registerPage, relTime, shortHash } from "../app";

registerPage("starred", async () => {
  const root = h("div");
  root.append(h("h1", { class: "page-title" }, "Starred"));

  const list = h("div");
  root.append(list);

  list.innerHTML = '<div class="loading">Loading</div>';
  const atoms = await client.recent({ prop: "starred", all: true });

  if (atoms.length === 0) {
    list.innerHTML = '<div class="empty">No starred atoms</div>';
    return root;
  }

  const cards = h("div");
  for (const a of atoms) {
    const card = h("div", {
      class: "card",
      style: "cursor:pointer",
      onclick: () => location.hash = `#/atom/${a.hash}`,
    });
    const top = h("div", {
      style:
        "display:flex;align-items:baseline;gap:0.75rem;margin-bottom:0.375rem",
    });
    top.append(
      h("a", { href: `#/atom/${a.hash}`, class: "hash" }, shortHash(a.hash)),
    );
    if (a.goal) {
      top.append(h("span", { class: "badge badge-blue" }, a.goal));
    }
    if (a.createdAt) {
      top.append(
        h("span", {
          style: "font-size:0.75rem;color:var(--text-2)",
        }, relTime(a.createdAt)),
      );
    }
    card.append(top);
    if (a.description) {
      card.append(
        h("div", {
          style: "font-size:0.875rem;color:var(--text-1)",
        }, a.description.slice(0, 120)),
      );
    }
    cards.append(card);
  }
  list.replaceChildren(cards);

  return root;
});
