import { client, h, navigate, registerPage, relTime, shortHash } from "../app";
import { ApiError } from "@zts/api-client";
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
  if (goal.done) {
    header.append(h("span", { class: "badge badge-green" }, "done"));
  }
  root.append(header);

  // Editable fields
  const editSection = h("div", { class: "card", style: "margin-bottom:1rem" });

  const weightRow = h("div", {
    style: "display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem",
  });
  weightRow.append(
    h(
      "label",
      { style: "font-size:0.8rem;color:var(--text-2);width:4rem" },
      "Weight",
    ),
  );
  const weightInput = h("input", {
    type: "number",
    value: String(goal.weight ?? 1),
    min: "0",
    style: "width:5rem",
  }) as HTMLInputElement;
  weightRow.append(weightInput);
  editSection.append(weightRow);

  // Body: render/edit toggle
  const bodyRow = h("div", { style: "margin-bottom:0.75rem" });
  const bodyHeader = h("div", {
    style: "display:flex;align-items:center;gap:0.5rem;margin-bottom:0.375rem",
  });
  bodyHeader.append(
    h("label", {
      style: "font-size:0.8rem;color:var(--text-2)",
    }, "Body"),
  );
  let editing = false;
  const toggleBtn = h("button", {
    class: "btn btn-sm btn-ghost",
    style: "font-size:0.75rem;padding:0.1rem 0.5rem",
  }, "Edit");
  bodyHeader.append(toggleBtn);
  bodyRow.append(bodyHeader);

  const rendered = h("div", {
    class: "markdown-body",
    style: "font-size:0.875rem;line-height:1.5",
  });
  rendered.innerHTML = (await getMarked()).marked.parse(goal.body ?? "", {
    async: false,
  }) as string;

  const bodyInput = h("textarea", {
    style:
      "width:100%;min-height:12rem;font-family:var(--mono);font-size:0.8rem;display:none",
    placeholder: "Goal description (markdown)...",
  }) as HTMLTextAreaElement;
  bodyInput.value = goal.body ?? "";

  const editActions = h("div", {
    style: "display:none;gap:0.5rem;align-items:center;margin-top:0.5rem",
  });
  const saveBtn = h("button", { class: "btn btn-sm btn-primary" }, "Save");
  const editStatus = h("span", { style: "font-size:0.8rem" });

  toggleBtn.addEventListener("click", async () => {
    editing = !editing;
    if (editing) {
      rendered.style.display = "none";
      bodyInput.style.display = "";
      editActions.style.display = "flex";
      toggleBtn.textContent = "Preview";
      bodyInput.focus();
    } else {
      rendered.innerHTML = (await getMarked()).marked.parse(bodyInput.value, {
        async: false,
      }) as string;
      rendered.style.display = "";
      bodyInput.style.display = "none";
      editActions.style.display = "none";
      toggleBtn.textContent = "Edit";
    }
  });

  saveBtn.addEventListener("click", async () => {
    try {
      await client.updateGoal(name, {
        weight: parseInt(weightInput.value, 10) || 1,
        body: bodyInput.value,
      });
      rendered.innerHTML = (await getMarked()).marked.parse(bodyInput.value, {
        async: false,
      }) as string;
      editing = false;
      rendered.style.display = "";
      bodyInput.style.display = "none";
      editActions.style.display = "none";
      toggleBtn.textContent = "Edit";
      editStatus.textContent = "Saved";
      editStatus.style.color = "var(--green)";
      setTimeout(() => editStatus.textContent = "", 2000);
    } catch (e) {
      if (e instanceof ApiError) {
        editStatus.textContent = e.message;
      } else {
        editStatus.textContent = (e as Error).message;
      }
      editStatus.style.color = "var(--red)";
    }
  });
  editActions.append(saveBtn, editStatus);

  bodyRow.append(rendered, bodyInput, editActions);
  editSection.append(bodyRow);

  // Weight save (separate from body)
  const weightActions = h("div", {
    style: "display:flex;gap:0.5rem;align-items:center",
  });
  const weightSaveBtn = h(
    "button",
    { class: "btn btn-sm btn-ghost" },
    "Update Weight",
  );
  const weightStatus = h("span", { style: "font-size:0.8rem" });
  weightSaveBtn.addEventListener("click", async () => {
    try {
      await client.updateGoal(name, {
        weight: parseInt(weightInput.value, 10) || 1,
      });
      weightStatus.textContent = "Saved";
      weightStatus.style.color = "var(--green)";
      setTimeout(() => weightStatus.textContent = "", 2000);
    } catch (e) {
      weightStatus.textContent = (e as Error).message;
      weightStatus.style.color = "var(--red)";
    }
  });
  weightActions.append(weightSaveBtn, weightStatus);
  editSection.append(weightActions);
  root.append(editSection);

  // Actions
  const actions = h("div", {
    style: "display:flex;gap:0.75rem;margin-bottom:1.5rem",
  });
  const actionStatus = h("span", { style: "font-size:0.8rem" });

  if (!goal.done) {
    const doneBtn = h(
      "button",
      { class: "btn btn-sm btn-primary" },
      "Mark Done",
    );
    doneBtn.addEventListener("click", async () => {
      try {
        await client.markGoalDone(name);
        await navigate(`#/goals/${encodeURIComponent(name)}`);
      } catch (e) {
        if (e instanceof ApiError) {
          actionStatus.textContent = e.message;
        } else {
          actionStatus.textContent = (e as Error).message;
        }
        actionStatus.style.color = "var(--red)";
      }
    });
    actions.append(doneBtn);
  } else {
    const undoneBtn = h(
      "button",
      { class: "btn btn-sm btn-ghost" },
      "Mark Undone",
    );
    undoneBtn.addEventListener("click", async () => {
      try {
        await client.markGoalUndone(name);
        await navigate(`#/goals/${encodeURIComponent(name)}`);
      } catch (e) {
        if (e instanceof ApiError) {
          actionStatus.textContent = e.message;
        } else {
          actionStatus.textContent = (e as Error).message;
        }
        actionStatus.style.color = "var(--red)";
      }
    });
    actions.append(undoneBtn);
  }

  const deleteBtn = h(
    "button",
    { class: "btn btn-sm btn-danger" },
    "Delete Goal",
  );
  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`Delete goal "${name}"? This cannot be undone.`)) return;
    try {
      await client.deleteGoal(name);
      location.hash = "#/goals";
    } catch (e) {
      if (e instanceof ApiError) {
        actionStatus.textContent = e.message;
      } else {
        actionStatus.textContent = (e as Error).message;
      }
      actionStatus.style.color = "var(--red)";
    }
  });
  actions.append(deleteBtn, actionStatus);
  root.append(actions);

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
        style:
          "padding:0.5rem 0;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:0.5rem",
      });
      const content = h("div", { style: "flex:1" });
      content.append(
        h("div", {
          style: "font-size:0.75rem;color:var(--text-2);margin-bottom:0.25rem",
        }, relTime(c.createdAt)),
      );
      content.append(
        h("div", {
          style: "font-size:0.875rem;color:var(--text-1);white-space:pre-wrap",
        }, c.body),
      );
      const delBtn = h("button", {
        class: "btn btn-sm btn-ghost",
        style:
          "font-size:1rem;color:var(--red);padding:0.2rem 0.5rem;flex-shrink:0;opacity:0.6",
        title: "Delete comment",
        onclick: async () => {
          try {
            await client.deleteGoalComment(name, c.id);
            await navigate(`#/goals/${encodeURIComponent(name)}`);
          } catch { /* ignore */ }
        },
      }, "\u00d7");
      item.append(content, delBtn);
      commentList.append(item);
    }
  }
  root.append(h("div", { class: "card" }, commentList));

  // Add comment
  const commentForm = h("div", {
    style: "margin-top:1rem;display:flex;gap:0.5rem",
  });
  const commentInput = h("input", {
    type: "text",
    placeholder: "Add a comment...",
    style: "flex:1",
  }) as HTMLInputElement;
  async function submitComment(): Promise<void> {
    const text = commentInput.value.trim();
    if (!text) return;
    try {
      await client.addGoalComment(name, text);
      commentInput.value = "";
      await navigate(`#/goals/${encodeURIComponent(name)}`);
    } catch { /* ignore */ }
  }
  commentInput.addEventListener("keydown", (e: Event) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      submitComment();
    }
  });
  const commentBtn = h("button", { class: "btn btn-sm btn-primary" }, "Post");
  commentBtn.addEventListener("click", submitComment);
  commentForm.append(commentInput, commentBtn);
  root.append(commentForm);

  return root;
}
