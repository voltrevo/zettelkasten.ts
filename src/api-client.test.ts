import { assertEquals, assertRejects } from "@std/assert";
import {
  ApiError,
  createBearerClient,
  type DenoCap,
  type ZtsClient,
} from "./api-client.ts";

// ---- Mock transport via globalThis.fetch override ----

type Handler = (
  path: string,
  init?: RequestInit,
) => Response | Promise<Response>;

function mockClient(
  handler: Handler,
  deno?: DenoCap,
): ZtsClient {
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    const path = url.replace("http://test:9999", "");
    return Promise.resolve(handler(path, init));
  }) as typeof globalThis.fetch;

  const client = createBearerClient("http://test:9999", {
    dev: "dev-tok",
    admin: "admin-tok",
  }, deno);

  // Wrap to restore fetch after each call
  const restore = () => {
    globalThis.fetch = origFetch;
  };

  return new Proxy(client, {
    get(target, prop) {
      const val = target[prop as keyof ZtsClient];
      if (typeof val !== "function") return val;
      return (...args: unknown[]) => {
        globalThis.fetch =
          ((input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === "string"
              ? input
              : input instanceof URL
              ? input.href
              : input.url;
            const path = url.replace("http://test:9999", "");
            return Promise.resolve(handler(path, init));
          }) as typeof globalThis.fetch;
        const result = (val as (...a: unknown[]) => unknown).apply(
          target,
          args,
        );
        if (result instanceof Promise) {
          return result.finally(restore);
        }
        restore();
        return result;
      };
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(
  body: string,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain", ...headers },
  });
}

// ---- Tests ----

Deno.test("getAtom returns source text (full hash)", async () => {
  const hash = "ab12345678901234567890123";
  const client = mockClient((path) => {
    assertEquals(
      path,
      `/a/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4)}.ts`,
    );
    return textResponse("export const x = 1;");
  });
  const src = await client.getAtom(hash);
  assertEquals(src, "export const x = 1;");
});

Deno.test("getAtom with prefix falls back to info", async () => {
  const client = mockClient((path) => {
    assertEquals(path, "/info/abc12");
    return jsonResponse({
      hash: "abc12defghijklmnopqrstuvw",
      source: "export const x = 1;",
      gzipSize: 50,
      description: "",
      goal: null,
      createdAt: "",
      url: "",
      imports: [],
      importedBy: [],
      tests: [],
      testedBy: [],
      properties: [],
    });
  });
  const src = await client.getAtom("abc12");
  assertEquals(src, "export const x = 1;");
});

Deno.test("getAtom throws ApiError on 404", async () => {
  const hash = "zz99999999999999999999999";
  const client = mockClient(() => textResponse("not found", 404));
  await assertRejects(
    () => client.getAtom(hash),
    ApiError,
  );
});

Deno.test("draft sends POST and returns result", async () => {
  const client = mockClient((path, init) => {
    assertEquals(path, "/draft");
    assertEquals(init?.method, "POST");
    return jsonResponse({
      hash: "abc1234567890abcdefghijkl",
      url: "/a/ab/c1/234567890abcdefghijkl.ts",
      existing: false,
    });
  });
  const result = await client.draft("export const x = 1;");
  assertEquals(result.hash, "abc1234567890abcdefghijkl");
  assertEquals(result.existing, false);
});

Deno.test("publish sends description header", async () => {
  const client = mockClient((path, init) => {
    assertEquals(path, "/publish/abc1234567890abcdefghijkl");
    assertEquals(init?.method, "POST");
    const h = init?.headers as Record<string, string>;
    assertEquals(h["x-description-encoding"], "base64utf8");
    assertEquals(h["x-goal"], "mygoal");
    return jsonResponse({
      hash: "abc1234567890abcdefghijkl",
      url: "/a/ab/c1/234567890abcdefghijkl.ts",
      autoPublished: [],
    });
  });
  const result = await client.publish("abc1234567890abcdefghijkl", {
    description: "test desc",
    goal: "mygoal",
  });
  assertEquals(result.hash, "abc1234567890abcdefghijkl");
});

Deno.test("deleteAtom sends DELETE", async () => {
  const client = mockClient((path, init) => {
    assertEquals(path, "/a/abc123");
    assertEquals(init?.method, "DELETE");
    return new Response(null, { status: 204 });
  });
  await client.deleteAtom("abc123");
});

Deno.test("recent passes query params", async () => {
  const client = mockClient((path) => {
    assertEquals(path.startsWith("/recent"), true);
    assertEquals(path.includes("n=5"), true);
    assertEquals(path.includes("goal=crypto"), true);
    return jsonResponse([]);
  });
  const result = await client.recent({ n: 5, goal: "crypto" });
  assertEquals(result, []);
});

Deno.test("recent with all flag", async () => {
  const client = mockClient((path) => {
    assertEquals(path.includes("all=1"), true);
    return jsonResponse([]);
  });
  await client.recent({ all: true });
});

Deno.test("info returns atom info", async () => {
  const info = {
    hash: "abc123",
    gzipSize: 100,
    description: "test",
    goal: null,
    createdAt: "2026-01-01",
    url: "/a/ab/c1/23.ts",
    source: "export const x = 1;",
    imports: [],
    importedBy: [],
    tests: [],
    testedBy: [],
    properties: [],
  };
  const client = mockClient((path) => {
    assertEquals(path, "/info/abc123");
    return jsonResponse(info);
  });
  const result = await client.info("abc123");
  assertEquals(result.hash, "abc123");
  assertEquals(result.source, "export const x = 1;");
});

Deno.test("search passes query and k", async () => {
  const client = mockClient((path) => {
    assertEquals(path.includes("q=gcd"), true);
    assertEquals(path.includes("k=5"), true);
    return jsonResponse([{
      hash: "a",
      score: 0.9,
      url: "/a/a",
      description: "gcd",
    }]);
  });
  const results = await client.search("gcd", 5);
  assertEquals(results.length, 1);
  assertEquals(results[0].score, 0.9);
});

Deno.test("searchCode passes code param", async () => {
  const client = mockClient((path) => {
    assertEquals(path.includes("code=test"), true);
    return jsonResponse([]);
  });
  await client.searchCode("test");
});

Deno.test("similar passes hash and k", async () => {
  const client = mockClient((path) => {
    assertEquals(path.startsWith("/similar/abc123"), true);
    return jsonResponse([]);
  });
  await client.similar("abc123", 10);
});

Deno.test("addRelationship sends POST with JSON body", async () => {
  const client = mockClient((_path, init) => {
    assertEquals(init?.method, "POST");
    const body = JSON.parse(init?.body as string);
    assertEquals(body, { from: "a", kind: "tests", to: "b" });
    return new Response("ok", { status: 201 });
  });
  await client.addRelationship("a", "tests", "b");
});

Deno.test("removeRelationship sends DELETE", async () => {
  const client = mockClient((_path, init) => {
    assertEquals(init?.method, "DELETE");
    return new Response(null, { status: 204 });
  });
  await client.removeRelationship("a", "tests", "b");
});

Deno.test("dependents returns list of hashes", async () => {
  const client = mockClient((path) => {
    assertEquals(path.includes("to=abc"), true);
    assertEquals(path.includes("kind=imports"), true);
    return jsonResponse([
      { from: "dep1", kind: "imports", to: "abc" },
      { from: "dep2", kind: "imports", to: "abc" },
    ]);
  });
  const deps = await client.dependents("abc");
  assertEquals(deps, ["dep1", "dep2"]);
});

Deno.test("tops passes limit and all", async () => {
  const client = mockClient((path) => {
    assertEquals(path.includes("limit=5"), true);
    assertEquals(path.includes("all=1"), true);
    return jsonResponse([]);
  });
  await client.tops("abc", { limit: 5, all: true });
});

Deno.test("setProperty sends POST", async () => {
  const client = mockClient((_path, init) => {
    const body = JSON.parse(init?.body as string);
    assertEquals(body, { hash: "abc", key: "starred", value: "true" });
    return new Response("ok");
  });
  await client.setProperty("abc", "starred", "true");
});

Deno.test("unsetProperty sends DELETE", async () => {
  const client = mockClient((_path, init) => {
    assertEquals(init?.method, "DELETE");
    const body = JSON.parse(init?.body as string);
    assertEquals(body, { hash: "abc", key: "starred" });
    return new Response(null, { status: 204 });
  });
  await client.unsetProperty("abc", "starred");
});

Deno.test("getTestEvaluation returns eval or null on 404", async () => {
  const client = mockClient((path) => {
    if (path.includes("target=exists")) {
      return jsonResponse({
        testAtom: "t1",
        targetAtom: "exists",
        expectedOutcome: "pass",
        commentary: null,
      });
    }
    return textResponse("not found", 404);
  });
  const ev = await client.getTestEvaluation("t1", "exists");
  assertEquals(ev?.expectedOutcome, "pass");
  const missing = await client.getTestEvaluation("t1", "missing");
  assertEquals(missing, null);
});

Deno.test("setTestEvaluation sends POST", async () => {
  const client = mockClient((_path, init) => {
    assertEquals(init?.method, "POST");
    const body = JSON.parse(init?.body as string);
    assertEquals(body.expected_outcome, "violates_intent");
    return new Response("ok");
  });
  await client.setTestEvaluation({
    test: "t1",
    target: "a1",
    expectedOutcome: "violates_intent",
  });
});

Deno.test("updateTestEvaluation sends PATCH", async () => {
  const client = mockClient((_path, init) => {
    assertEquals(init?.method, "PATCH");
    const body = JSON.parse(init?.body as string);
    assertEquals(body.commentary, "updated note");
    return new Response("ok");
  });
  await client.updateTestEvaluation({
    test: "t1",
    target: "a1",
    commentary: "updated note",
  });
});

Deno.test("listGoals passes done and all", async () => {
  const client = mockClient((path) => {
    assertEquals(path.includes("done=1"), true);
    assertEquals(path.includes("all=1"), true);
    return jsonResponse([]);
  });
  await client.listGoals({ done: true, all: true });
});

Deno.test("getGoal encodes name", async () => {
  const client = mockClient((path) => {
    assertEquals(path, "/goals/my-goal");
    return jsonResponse({
      name: "my-goal",
      weight: 1,
      body: null,
      done: false,
      createdAt: "2026-01-01",
      comments: [],
    });
  });
  const goal = await client.getGoal("my-goal");
  assertEquals(goal.name, "my-goal");
});

Deno.test("createGoal sends POST", async () => {
  const client = mockClient((_path, init) => {
    assertEquals(init?.method, "POST");
    const body = JSON.parse(init?.body as string);
    assertEquals(body.name, "new-goal");
    assertEquals(body.weight, 5);
    return jsonResponse({
      name: "new-goal",
      weight: 5,
      body: null,
      done: false,
    }, 201);
  });
  const goal = await client.createGoal("new-goal", { weight: 5 });
  assertEquals(goal.name, "new-goal");
});

Deno.test("markGoalDone sends POST to /done", async () => {
  const client = mockClient((path, init) => {
    assertEquals(path, "/goals/g1/done");
    assertEquals(init?.method, "POST");
    return new Response("ok");
  });
  await client.markGoalDone("g1");
});

Deno.test("addGoalComment sends body as text", async () => {
  const client = mockClient((_path, init) => {
    assertEquals(init?.method, "POST");
    assertEquals(init?.body, "my comment");
    const h = init?.headers as Record<string, string>;
    assertEquals(h["content-type"], "text/plain");
    return new Response("ok");
  });
  await client.addGoalComment("g1", "my comment");
});

Deno.test("deleteGoalComment sends DELETE", async () => {
  const client = mockClient((path, init) => {
    assertEquals(path, "/goals/g1/comments/42");
    assertEquals(init?.method, "DELETE");
    return new Response(null, { status: 204 });
  });
  await client.deleteGoalComment("g1", 42);
});

Deno.test("getPrompt returns text and source", async () => {
  const client = mockClient(() =>
    textResponse("prompt content", 200, { "x-prompt-source": "override" })
  );
  const result = await client.getPrompt("context");
  assertEquals(result.text, "prompt content");
  assertEquals(result.source, "override");
});

Deno.test("getPrompt defaults to 'default' source", async () => {
  const client = mockClient(() => textResponse("default prompt"));
  const result = await client.getPrompt("iteration");
  assertEquals(result.text, "default prompt");
  assertEquals(result.source, "default");
});

Deno.test("setPrompt sends PUT", async () => {
  const client = mockClient((_path, init) => {
    assertEquals(init?.method, "PUT");
    assertEquals(init?.body, "new prompt");
    return new Response("ok");
  });
  await client.setPrompt("context", "new prompt");
});

Deno.test("resetPrompt sends DELETE", async () => {
  const client = mockClient((_path, init) => {
    assertEquals(init?.method, "DELETE");
    return new Response(null, { status: 204 });
  });
  await client.resetPrompt("context");
});

Deno.test("getStatus passes since param", async () => {
  const client = mockClient((path) => {
    assertEquals(path.includes("since=2026-01-01"), true);
    return jsonResponse({
      totalAtoms: 100,
      defects: 2,
      superseded: 5,
      recentAtoms: 10,
      recentRelationships: 20,
      recentGoalsDone: 1,
      since: "2026-01-01",
      goalStats: [],
      activeGoals: [],
    });
  });
  const status = await client.getStatus("2026-01-01");
  assertEquals(status.totalAtoms, 100);
});

Deno.test("getLog passes filters", async () => {
  const client = mockClient((path) => {
    assertEquals(path.includes("recent=10"), true);
    assertEquals(path.includes("op=atom.create"), true);
    return jsonResponse([]);
  });
  await client.getLog({ recent: 10, op: "atom.create" });
});

Deno.test("getBundle returns Uint8Array", async () => {
  const data = new Uint8Array([1, 2, 3, 4]);
  const client = mockClient(() => new Response(data, { status: 200 }));
  const result = await client.getBundle("abc");
  assertEquals(result, data);
});

Deno.test("describeRead returns description text", async () => {
  const client = mockClient((path) => {
    assertEquals(path, "/a/abc/description");
    return textResponse("my description");
  });
  const desc = await client.describeRead("abc");
  assertEquals(desc, "my description");
});

Deno.test("describeUpdate sends POST", async () => {
  const client = mockClient((path, init) => {
    assertEquals(path, "/a/abc/description");
    assertEquals(init?.method, "POST");
    assertEquals(init?.body, "new desc");
    return new Response("ok");
  });
  await client.describeUpdate("abc", "new desc");
});

Deno.test("bearer auth header is set", async () => {
  const client = mockClient((_path, init) => {
    const h = init?.headers as Record<string, string>;
    assertEquals(h["authorization"], "Bearer admin-tok");
    return jsonResponse([]);
  });
  await client.recent();
});

Deno.test("ApiError includes status and message", async () => {
  const client = mockClient(() => textResponse("bad request", 400));
  try {
    await client.getAtom("x");
  } catch (e) {
    assertEquals(e instanceof ApiError, true);
    assertEquals((e as ApiError).status, 400);
    assertEquals((e as ApiError).message, "bad request");
    return;
  }
  throw new Error("should have thrown");
});
