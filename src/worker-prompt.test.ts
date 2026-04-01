import { assertEquals } from "@std/assert";
import { buildPrompt, formatGoalText, type PromptCap } from "./worker.ts";

function stubCap(files: Record<string, string> = {}): PromptCap {
  return {
    readTextFile: (path) => {
      if (path in files) return Promise.resolve(files[path]);
      return Promise.reject(new Deno.errors.NotFound(`not found: ${path}`));
    },
    readDir: (path) => {
      const prefix = path.endsWith("/") ? path : path + "/";
      const entries = Object.keys(files)
        .filter((f) =>
          f.startsWith(prefix) && !f.slice(prefix.length).includes("/")
        )
        .map((f) => ({ name: f.slice(prefix.length) }));
      return (async function* () {
        for (const e of entries) yield e;
      })();
    },
    fetchPrompt: () => Promise.reject(new Error("not expected")),
  };
}

const TEMPLATE =
  "server={{server-url}} workspace={{workspace}} summary={{summary}} goal={{goal}}";

const RETRO_TEMPLATE =
  "retro summary={{summary}} goal={{goal}}\n\n{{retrospective-context}}";

Deno.test("buildPrompt: expands all template variables for build iteration", async () => {
  const cap = stubCap({});
  const result = await buildPrompt(cap, {
    rawPrompt: TEMPLATE,
    serverUrl: "http://localhost:7493",
    workspaceDir: "/work",
    goalText: "build foo",
    taskText: "test task",
    iter: 5,
    channel: "test",
    isRetrospective: false,
  });
  assertEquals(result.includes("server=http://localhost:7493"), true);
  assertEquals(result.includes("workspace=/work"), true);
  assertEquals(result.includes("goal=build foo"), true);
  assertEquals(result.includes("no prior summaries"), true);
  assertEquals(result.includes("Current iteration: 5"), true);
  assertEquals(result.includes("Channel: test"), true);
  assertEquals(result.includes("{{"), false);
});

Deno.test("buildPrompt: summary ref includes count when history exists", async () => {
  const cap = stubCap({
    "/work/summary/history/1.md": "built atom A",
    "/work/summary/history/2.md": "built atom B",
    "/work/summary/history/3.md": "built atom C",
  });
  const result = await buildPrompt(cap, {
    rawPrompt: TEMPLATE,
    serverUrl: "http://localhost:7493",
    workspaceDir: "/work",
    goalText: "test",
    taskText: "test task",
    iter: 4,
    channel: "ch",
    isRetrospective: false,
  });
  assertEquals(result.includes("3 files"), true);
  assertEquals(result.includes("/work/summary/history/"), true);
});

Deno.test("buildPrompt: retrospective inlines summaries and retros", async () => {
  const cap = stubCap({
    "/work/summary/history/8.md": "summary eight",
    "/work/summary/history/9.md": "summary nine",
    "/work/retrospectives/retro-0005.md": "past retro content",
  });
  const result = await buildPrompt(cap, {
    rawPrompt: RETRO_TEMPLATE,
    serverUrl: "http://localhost:7493",
    workspaceDir: "/work",
    goalText: "retro goal",
    taskText: "test task",
    iter: 10,
    channel: "ch",
    isRetrospective: true,
  });
  assertEquals(result.includes("summary eight"), true);
  assertEquals(result.includes("summary nine"), true);
  assertEquals(result.includes("iteration 8"), true);
  assertEquals(result.includes("iteration 9"), true);
  assertEquals(result.includes("past retro content"), true);
  assertEquals(result.includes("retro-0005.md"), true);
  assertEquals(result.includes("retrospectives/retro-0010.md"), true);
  assertEquals(result.includes("{{"), false);
});

Deno.test("buildPrompt: retrospective with no context", async () => {
  const cap = stubCap({});
  const result = await buildPrompt(cap, {
    rawPrompt: RETRO_TEMPLATE,
    serverUrl: "http://localhost:7493",
    workspaceDir: "/work",
    goalText: "test",
    taskText: "test task",
    iter: 30,
    channel: "ch",
    isRetrospective: true,
  });
  assertEquals(result.includes("No prior context available"), true);
  assertEquals(result.includes("{{"), false);
});

Deno.test("buildPrompt: summaries sorted by iteration number not lexicographic", async () => {
  const cap = stubCap({
    "/work/summary/history/2.md": "two",
    "/work/summary/history/10.md": "ten",
    "/work/summary/history/1.md": "one",
  });
  const result = await buildPrompt(cap, {
    rawPrompt: RETRO_TEMPLATE,
    serverUrl: "http://localhost:7493",
    workspaceDir: "/work",
    goalText: "test",
    taskText: "test task",
    iter: 11,
    channel: "ch",
    isRetrospective: true,
  });
  const idx1 = result.indexOf("iteration 1");
  const idx2 = result.indexOf("iteration 2");
  const idx10 = result.indexOf("iteration 10");
  assertEquals(idx1 < idx2, true);
  assertEquals(idx2 < idx10, true);
});

Deno.test("formatGoalText: simple goal", () => {
  const text = formatGoalText({
    name: "my-goal",
    weight: 2,
    body: "# Goal\nDo stuff.",
    hasFiles: false,
  });
  assertEquals(text.includes("**my-goal** (weight 2)"), true);
  assertEquals(text.includes("# Goal\nDo stuff."), true);
  assertEquals(text.includes("directory goal"), false);
});

Deno.test("formatGoalText: directory goal", () => {
  const text = formatGoalText({
    name: "dir-goal",
    weight: 1,
    body: "# README",
    hasFiles: true,
  });
  assertEquals(text.includes("**dir-goal**"), true);
  assertEquals(text.includes("directory goal"), true);
  assertEquals(text.includes("zts goal files dir-goal"), true);
  assertEquals(text.includes("zts goal file dir-goal"), true);
});
