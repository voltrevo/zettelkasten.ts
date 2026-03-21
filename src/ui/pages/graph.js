import { apiJson, h, registerPage, shortHash } from "../app.js";

registerPage("graph", async () => {
  const root = h("div");
  root.append(h("h1", { class: "page-title" }, "Dependency Graph"));

  const controls = h("div", { class: "filter-bar" });
  const kindSelect = h("select");
  kindSelect.append(
    h("option", { value: "imports" }, "imports"),
    h("option", { value: "tests" }, "tests"),
    h("option", { value: "supersedes" }, "supersedes"),
    h("option", { value: "" }, "all"),
  );
  const sizeSelect = h("select");
  for (const [val, label] of [
    ["200", "200 atoms"],
    ["500", "500 atoms"],
    ["1000", "1000 atoms"],
    ["2000", "2000 atoms"],
    ["custom", "custom..."],
    ["all", "all"],
  ]) {
    sizeSelect.append(h("option", { value: val }, label));
  }
  const customInput = h("input", {
    type: "number",
    min: "1",
    placeholder: "N",
    style: "width:5rem;display:none",
  });
  const labelStyle =
    "font-size:0.8rem;color:var(--text-2);display:flex;align-items:center;gap:0.5rem";
  const generateBtn = h("button", { class: "btn btn-sm btn-primary" }, "Generate");
  controls.append(
    h("label", { style: labelStyle }, "Relationship:", kindSelect),
    h("label", { style: labelStyle }, "Size:", sizeSelect, customInput),
    generateBtn,
  );
  root.append(controls);

  const container = h("div", {
    style:
      "background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius);position:relative;overflow:hidden",
  });
  container.style.height = "600px";
  root.append(container);

  // Load data
  let atoms, rels;

  function getLimit() {
    const val = sizeSelect.value;
    if (val === "all") return "all";
    if (val === "custom") return customInput.value || "200";
    return val;
  }

  async function loadAtoms() {
    const limit = getLimit();
    const q = limit === "all" ? "all=1" : `n=${limit}`;
    return await apiJson(`/recent?${q}`);
  }

  try {
    [atoms, rels] = await Promise.all([
      loadAtoms(),
      apiJson("/relationships?kind=imports"),
    ]);
  } catch (e) {
    return h(
      "div",
      { class: "empty" },
      `Could not load graph data: ${e.message}`,
    );
  }

  const kindColors = {
    imports: "#6e8efa",
    tests: "#4ade80",
    supersedes: "#f87171",
  };

  async function render(filterKind) {
    let edges = rels;
    if (filterKind) {
      edges = await apiJson(`/relationships?kind=${filterKind}`);
    } else {
      const [imp, tst, sup] = await Promise.all([
        apiJson("/relationships?kind=imports"),
        apiJson("/relationships?kind=tests"),
        apiJson("/relationships?kind=supersedes"),
      ]);
      edges = [...imp, ...tst, ...sup];
    }

    // Build node set from recent atoms, filter edges to match
    const atomSet = new Set(atoms.map((a) => a.hash));
    edges = edges.filter((e) => atomSet.has(e.from) || atomSet.has(e.to));
    const nodeSet = new Set(atomSet);
    for (const e of edges) {
      nodeSet.add(e.from);
      nodeSet.add(e.to);
    }

    const nodeArr = [...nodeSet];
    const nodeMap = new Map(nodeArr.map((id, i) => [id, i]));

    // SVG
    container.innerHTML = "";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.display = "block";
    container.append(svg);

    const w = container.clientWidth;
    const ht = container.clientHeight;

    // Simple force simulation (no D3 dependency — basic Fruchterman-Reingold)
    const nodes = nodeArr.map((id) => ({
      id,
      x: w / 2 + (Math.random() - 0.5) * w * 0.6,
      y: ht / 2 + (Math.random() - 0.5) * ht * 0.6,
      vx: 0,
      vy: 0,
    }));

    const links = edges
      .filter((e) => nodeMap.has(e.from) && nodeMap.has(e.to))
      .map((e) => ({
        source: nodeMap.get(e.from),
        target: nodeMap.get(e.to),
        kind: e.kind,
      }));

    // Simulate
    const ITERS = 120;
    const k = Math.sqrt((w * ht) / nodes.length) * 0.8;
    for (let iter = 0; iter < ITERS; iter++) {
      const temp = 1 - iter / ITERS;
      // Repulsion
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].vx = 0;
        nodes[i].vy = 0;
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const f = (k * k) / dist;
          nodes[i].vx += (dx / dist) * f;
          nodes[i].vy += (dy / dist) * f;
        }
      }
      // Attraction
      for (const l of links) {
        const s = nodes[l.source], t = nodes[l.target];
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const f = (dist * dist) / k;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        s.vx += fx;
        s.vy += fy;
        t.vx -= fx;
        t.vy -= fy;
      }
      // Center gravity
      for (const n of nodes) {
        n.vx += (w / 2 - n.x) * 0.01;
        n.vy += (ht / 2 - n.y) * 0.01;
      }
      // Apply
      for (const n of nodes) {
        const disp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        if (disp > 0) {
          const maxDisp = Math.max(1, temp * 10);
          const scale = Math.min(maxDisp, disp) / disp;
          n.x += n.vx * scale;
          n.y += n.vy * scale;
        }
        n.x = Math.max(20, Math.min(w - 20, n.x));
        n.y = Math.max(20, Math.min(ht - 20, n.y));
      }
    }

    // Draw edges
    for (const l of links) {
      const s = nodes[l.source], t = nodes[l.target];
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      line.setAttribute("x1", s.x);
      line.setAttribute("y1", s.y);
      line.setAttribute("x2", t.x);
      line.setAttribute("y2", t.y);
      line.setAttribute("stroke", kindColors[l.kind] ?? "#606078");
      line.setAttribute("stroke-width", "1");
      line.setAttribute("stroke-opacity", "0.4");
      svg.append(line);
    }

    // Draw nodes
    const tooltip = h("div", {
      style:
        "position:absolute;background:var(--bg-2);border:1px solid var(--border);border-radius:4px;padding:0.375rem 0.625rem;font-size:0.75rem;pointer-events:none;display:none;z-index:10;max-width:300px;color:var(--text-1)",
    });
    container.append(tooltip);

    const atomMap = new Map(atoms.map((a) => [a.hash, a]));

    for (const n of nodes) {
      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      circle.setAttribute("cx", n.x);
      circle.setAttribute("cy", n.y);
      circle.setAttribute("r", "4");
      circle.setAttribute(
        "fill",
        atomMap.get(n.id)?.description?.startsWith("BROKEN:")
          ? "#f87171"
          : "#6e8efa",
      );
      circle.style.cursor = "pointer";
      circle.addEventListener("click", () => {
        location.hash = `#/atom/${n.id}`;
      });
      circle.addEventListener("mouseenter", (e) => {
        const a = atomMap.get(n.id);
        tooltip.textContent = `${shortHash(n.id)} ${
          a?.description?.slice(0, 80) ?? ""
        }`;
        tooltip.style.display = "block";
        tooltip.style.left = (n.x + 10) + "px";
        tooltip.style.top = (n.y - 10) + "px";
        circle.setAttribute("r", "6");
      });
      circle.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
        circle.setAttribute("r", "4");
      });
      svg.append(circle);
    }

    // Legend
    const legend = h("div", {
      style:
        "position:absolute;bottom:0.75rem;left:0.75rem;font-size:0.7rem;color:var(--text-2);display:flex;gap:1rem",
    });
    for (const [kind, color] of Object.entries(kindColors)) {
      legend.append(
        h(
          "span",
          { style: `display:flex;align-items:center;gap:0.25rem` },
          h("span", {
            style:
              `width:12px;height:2px;background:${color};display:inline-block`,
          }),
          kind,
        ),
      );
    }
    legend.append(
      h("span", {}, `${nodes.length} nodes, ${links.length} edges`),
    );
    container.append(legend);
  }

  function markStale() {
    container.style.opacity = "0.35";
    container.style.pointerEvents = "none";
  }

  async function generate() {
    generateBtn.disabled = true;
    generateBtn.textContent = "Loading...";
    try {
      atoms = await loadAtoms();
      await render(kindSelect.value);
      container.style.opacity = "1";
      container.style.pointerEvents = "";
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = "Generate";
    }
  }

  kindSelect.addEventListener("change", markStale);
  sizeSelect.addEventListener("change", () => {
    customInput.style.display = sizeSelect.value === "custom" ? "" : "none";
    markStale();
  });
  customInput.addEventListener("input", markStale);
  generateBtn.addEventListener("click", generate);
  await generate();

  return root;
});
