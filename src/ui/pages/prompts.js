import { api, h, registerPage } from "../app.js";

registerPage("prompts", async () => {
  const root = h("div");
  root.append(h("h1", { class: "page-title" }, "Agent Prompts"));

  // Prompt name tabs (context / iteration / retrospective)
  const promptTabs = h("div", { class: "tabs" });
  const names = ["context", "iteration", "retrospective"];
  const promptBtns = {};

  for (const name of names) {
    const btn = h(
      "button",
      { class: "tab", onclick: () => loadPrompt(name) },
      name,
    );
    promptBtns[name] = btn;
    promptTabs.append(btn);
  }
  root.append(promptTabs);

  const status = h("div", {
    style: "font-size:0.8rem;min-height:1.2em;margin-bottom:0.75rem",
  });
  root.append(status);

  // View mode tabs (current / diff / default)
  const viewTabs = h("div", {
    style:
      "display:flex;gap:0.25rem;margin-bottom:0.75rem;border-bottom:1px solid var(--border);padding-bottom:0.5rem",
  });
  const viewModes = ["default", "diff", "current"];
  const viewBtns = {};
  let activeView = "current";

  for (const mode of viewModes) {
    const btn = h("button", {
      class: "btn btn-sm btn-ghost",
      style: "font-size:0.75rem;text-transform:uppercase;letter-spacing:0.04em",
      onclick: () => switchView(mode),
    }, mode);
    viewBtns[mode] = btn;
    viewTabs.append(btn);
  }
  root.append(viewTabs);

  // Content area
  const editorArea = h("textarea", {
    style:
      "width:100%;min-height:500px;font-family:var(--mono);font-size:0.8rem",
  });
  const diffView = h("div", {
    style:
      "width:100%;min-height:500px;overflow:auto;font-family:var(--mono);font-size:0.8rem;white-space:pre-wrap;border:1px solid var(--border);border-radius:6px;padding:0.75rem;background:var(--bg-1)",
  });
  const contentWrap = h("div");
  contentWrap.append(editorArea);
  root.append(contentWrap);

  const actions = h("div", {
    style: "margin-top:1rem;display:flex;gap:0.75rem",
  });
  const saveBtn = h(
    "button",
    { class: "btn btn-sm btn-primary" },
    "Save Override",
  );
  const resetBtn = h(
    "button",
    { class: "btn btn-sm btn-ghost" },
    "Reset to Default",
  );
  actions.append(saveBtn, resetBtn);
  root.append(actions);

  let currentName = "";
  let currentText = "";
  let defaultText = "";

  function switchView(mode) {
    activeView = mode;
    for (const [m, btn] of Object.entries(viewBtns)) {
      btn.style.fontWeight = m === mode ? "700" : "400";
      btn.style.borderBottom = m === mode
        ? "2px solid var(--accent)"
        : "2px solid transparent";
    }
    contentWrap.replaceChildren();
    if (mode === "current") {
      editorArea.value = currentText;
      editorArea.readOnly = false;
      editorArea.style.opacity = "1";
      contentWrap.append(editorArea);
      saveBtn.hidden = false;
      resetBtn.hidden = false;
    } else if (mode === "default") {
      editorArea.value = defaultText;
      editorArea.readOnly = true;
      editorArea.style.opacity = "0.6";
      contentWrap.append(editorArea);
      saveBtn.hidden = true;
      resetBtn.hidden = false;
    } else {
      // diff
      diffView.replaceChildren();
      diffView.append(buildDiff(defaultText, currentText));
      contentWrap.append(diffView);
      saveBtn.hidden = true;
      resetBtn.hidden = true;
    }
  }

  function buildDiff(a, b) {
    const frag = document.createDocumentFragment();
    const aLines = a.split("\n");
    const bLines = b.split("\n");

    if (a === b) {
      const span = document.createElement("span");
      span.style.color = "var(--text-2)";
      span.textContent = "(no differences — using default)";
      frag.append(span);
      return frag;
    }

    // Simple line-by-line diff (LCS-based)
    const lcs = lcsLines(aLines, bLines);
    let ai = 0, bi = 0, li = 0;
    while (ai < aLines.length || bi < bLines.length) {
      if (
        li < lcs.length && ai < aLines.length && bi < bLines.length &&
        aLines[ai] === lcs[li] && bLines[bi] === lcs[li]
      ) {
        frag.append(diffLine(" ", aLines[ai]));
        ai++;
        bi++;
        li++;
      } else if (
        ai < aLines.length &&
        (li >= lcs.length || aLines[ai] !== lcs[li])
      ) {
        frag.append(diffLine("-", aLines[ai]));
        ai++;
      } else if (
        bi < bLines.length &&
        (li >= lcs.length || bLines[bi] !== lcs[li])
      ) {
        frag.append(diffLine("+", bLines[bi]));
        bi++;
      }
    }
    return frag;
  }

  function lcsLines(a, b) {
    const m = a.length, n = b.length;
    // For large prompts, limit to avoid perf issues
    if (m * n > 500000) return [];
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    const result = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        result.unshift(a[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    return result;
  }

  function diffLine(prefix, text) {
    const div = document.createElement("div");
    div.style.fontFamily = "var(--mono)";
    div.style.fontSize = "0.8rem";
    if (prefix === "-") {
      div.style.background = "rgba(255,80,80,0.12)";
      div.style.color = "var(--red, #f44)";
    } else if (prefix === "+") {
      div.style.background = "rgba(80,200,80,0.12)";
      div.style.color = "var(--green, #4a4)";
    } else {
      div.style.color = "var(--text-1)";
    }
    div.textContent = prefix + " " + text;
    return div;
  }

  async function loadPrompt(name) {
    currentName = name;
    for (const [n, btn] of Object.entries(promptBtns)) {
      btn.classList.toggle("active", n === name);
    }
    status.textContent = "";

    try {
      const [currentRes, defaultRes] = await Promise.all([
        fetch(`/prompts/${name}`, { credentials: "same-origin" }),
        fetch(`/prompts/${name}?default=1`, { credentials: "same-origin" }),
      ]);
      currentText = currentRes.ok ? await currentRes.text() : "";
      defaultText = defaultRes.ok ? await defaultRes.text() : "";
      if (!currentText) currentText = defaultText;
      switchView(activeView);
    } catch (e) {
      status.textContent = e.message;
      status.style.color = "var(--red)";
    }
  }

  // Save current text on view switch away from current
  editorArea.addEventListener("input", () => {
    if (activeView === "current") {
      currentText = editorArea.value;
    }
  });

  saveBtn.addEventListener("click", async () => {
    if (!currentName) return;
    currentText = editorArea.value;
    const res = await api(`/prompts/${currentName}`, {
      method: "PUT",
      body: currentText,
      headers: { "content-type": "text/plain" },
    });
    if (res.ok) {
      status.textContent = "Saved";
      status.style.color = "var(--green)";
      await loadPrompt(currentName);
    } else {
      status.textContent = await res.text();
      status.style.color = "var(--red)";
    }
  });

  resetBtn.addEventListener("click", async () => {
    if (!currentName) return;
    if (!confirm(`Reset ${currentName} prompt to default?`)) return;
    const res = await api(`/prompts/${currentName}`, { method: "DELETE" });
    if (res.ok) {
      status.textContent = "Reset to default";
      status.style.color = "var(--green)";
      await loadPrompt(currentName);
    } else {
      status.textContent = await res.text();
      status.style.color = "var(--red)";
    }
  });

  await loadPrompt("context");

  return root;
});
