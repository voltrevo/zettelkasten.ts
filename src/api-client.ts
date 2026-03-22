/**
 * Typed API client for the zettelkasten server.
 * Works in both Deno (CLI, bearer auth) and browser (cookie auth).
 *
 * Subprocess operations (exec, test, script) require a DenoCap to be provided.
 */

export type { DenoCap } from "./cap.ts";
import type { DenoCap } from "./cap.ts";
import { parseZip } from "./bundle.ts";

// ---- Response types ----

export interface AtomSummary {
  hash: string;
  gzipSize: number;
  description: string;
  goal: string | null;
  createdAt: string;
}

export interface AtomInfo extends AtomSummary {
  url: string;
  source: string;
  imports: string[];
  importedBy: string[];
  tests: string[];
  testedBy: string[];
  properties: Property[];
}

export interface Property {
  key: string;
  value: string | null;
}

export interface SearchResult {
  hash: string;
  score: number;
  url: string;
  description: string;
}

export interface CodeSearchResult {
  hash: string;
  url: string;
  snippet: string;
  description: string;
}

export interface SimilarResult {
  hash: string;
  score: number;
  url: string;
  description: string;
}

export interface Relationship {
  kind: string;
  from: string;
  to: string;
}

export interface TestEvaluation {
  testAtom: string;
  targetAtom: string;
  expectedOutcome: string;
  commentary: string | null;
}

export interface TestRun {
  testAtom: string;
  result: string;
  durationMs: number | null;
  runBy: string;
  ranAt: string;
}

export interface LogEntry {
  id: number;
  op: string;
  subject: string | null;
  detail: string | null;
  actor: string | null;
  createdAt: string;
}

export interface Status {
  totalAtoms: number;
  defects: number;
  superseded: number;
  recentAtoms: number;
  recentRelationships: number;
  recentGoalsDone: number;
  since: string;
  goalStats: {
    name: string;
    total: number;
    recent: number;
    commentCount: number;
  }[];
  activeGoals: { name: string; weight: number }[];
}

export interface PromptResult {
  text: string;
  source: "override" | "default";
}

export interface TopsEntry {
  hash: string;
  depth: number;
  description: string;
}

export interface ExecResult {
  code: number;
}

export interface TestResult {
  testAtom: string;
  passed: boolean;
  error?: string;
}

export interface Goal {
  name: string;
  weight: number;
  body: string | null;
  done: boolean;
  atomCount?: number;
}

export interface GoalDetail extends Goal {
  createdAt: string;
  comments: GoalComment[];
}

export interface GoalComment {
  id: number;
  body: string;
  createdAt: string;
}

// ---- Request option types ----

export interface PostAtomOpts {
  description?: string;
  tests?: string;
  goal?: string;
  isTest?: boolean;
  noTests?: boolean;
  allowNoDescription?: boolean;
}

export interface RecentOpts {
  n?: number;
  goal?: string;
  broken?: boolean;
  prop?: string;
  all?: boolean;
}

export interface RelationshipQuery {
  from?: string;
  to?: string;
  kind?: string;
}

// ---- Error ----

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// ---- Client interface ----

export interface ZtsClient {
  // Atoms
  getAtom(hash: string): Promise<string>;
  postAtom(source: string, opts: PostAtomOpts): Promise<string>;
  deleteAtom(hash: string): Promise<void>;
  describeRead(hash: string): Promise<string>;
  describeUpdate(hash: string, description: string): Promise<void>;

  // Discovery
  recent(opts?: RecentOpts): Promise<AtomSummary[]>;
  info(hash: string): Promise<AtomInfo>;
  search(query: string, k?: number): Promise<SearchResult[]>;
  searchCode(query: string, k?: number): Promise<CodeSearchResult[]>;
  similar(hash: string, k?: number): Promise<SimilarResult[]>;

  // Relationships
  queryRelationships(query: RelationshipQuery): Promise<Relationship[]>;
  addRelationship(
    from: string,
    kind: string,
    to: string,
  ): Promise<"created" | "exists">;
  removeRelationship(
    from: string,
    kind: string,
    to: string,
  ): Promise<void>;
  dependents(hash: string): Promise<string[]>;
  tops(hash: string, opts?: { limit?: number; all?: boolean }): Promise<
    TopsEntry[]
  >;

  // Properties
  listProperties(hash: string): Promise<Property[]>;
  setProperty(hash: string, key: string, value?: string): Promise<void>;
  unsetProperty(hash: string, key: string): Promise<void>;

  // Testing
  getTestEvaluation(
    test: string,
    target: string,
  ): Promise<TestEvaluation | null>;
  setTestEvaluation(opts: {
    test: string;
    target: string;
    expectedOutcome: string;
    commentary?: string;
  }): Promise<void>;
  updateTestEvaluation(opts: {
    test: string;
    target: string;
    commentary?: string;
  }): Promise<void>;
  getTestRuns(
    opts: { target?: string; test?: string; recent?: number },
  ): Promise<TestRun[]>;

  // Goals
  listGoals(opts?: { done?: boolean; all?: boolean }): Promise<Goal[]>;
  getGoal(name: string): Promise<GoalDetail>;
  createGoal(
    name: string,
    opts?: { weight?: number; body?: string },
  ): Promise<Goal>;
  updateGoal(
    name: string,
    opts: { weight?: number; body?: string },
  ): Promise<void>;
  deleteGoal(name: string): Promise<void>;
  markGoalDone(name: string): Promise<void>;
  markGoalUndone(name: string): Promise<void>;
  addGoalComment(name: string, text: string): Promise<void>;
  getGoalComments(
    name: string,
    opts?: { recent?: number },
  ): Promise<GoalComment[]>;
  deleteGoalComment(name: string, id: number): Promise<void>;

  // Prompts
  getPrompt(name: string, defaultOnly?: boolean): Promise<PromptResult>;
  setPrompt(name: string, body: string): Promise<void>;
  resetPrompt(name: string): Promise<void>;

  // Status & logs
  getStatus(since?: string): Promise<Status>;
  getLog(
    opts?: { recent?: number; op?: string; subject?: string },
  ): Promise<LogEntry[]>;

  // Bundle
  getBundle(hash: string): Promise<Uint8Array>;

  // Subprocess operations (require DenoCap)
  exec(
    hash: string,
    scriptArgs?: string[],
  ): Promise<ExecResult>;
  runTests(hash: string): Promise<TestResult[]>;

  execBundle(zipData: Uint8Array): Promise<ExecResult>;

  // Scripting
  scriptTypes(): Promise<string>;
  script(fileOrCode: string, opts?: { file?: boolean }): Promise<ExecResult>;
}

// ---- Transport abstraction ----

interface Transport {
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

// ---- Implementation ----

function buildClient(
  transport: Transport,
  opts?: { deno?: DenoCap; baseUrl?: string; tmpDir?: string },
): ZtsClient {
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await transport.fetch(path, init);
    if (!res.ok) {
      throw new ApiError(res.status, await res.text());
    }
    return res.json();
  }

  async function text(path: string, init?: RequestInit): Promise<string> {
    const res = await transport.fetch(path, init);
    if (!res.ok) {
      throw new ApiError(res.status, await res.text());
    }
    return res.text();
  }

  async function ok(path: string, init?: RequestInit): Promise<void> {
    const res = await transport.fetch(path, init);
    if (!res.ok && res.status !== 204) {
      throw new ApiError(res.status, await res.text());
    }
    // Consume body to avoid resource leak
    await res.body?.cancel();
  }

  function qs(
    params: Record<string, string | number | boolean | undefined>,
  ): string {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== false) {
        sp.set(k, String(v === true ? "1" : v));
      }
    }
    const s = sp.toString();
    return s ? `?${s}` : "";
  }

  return {
    // Atoms
    async getAtom(hash) {
      // Try structured path first (full 25-char hash)
      // Fall back to /info/ + source for prefix resolution
      if (hash.length === 25) {
        return text(
          `/a/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4)}.ts`,
        );
      }
      const info: AtomInfo = await json(`/info/${hash}`);
      return info.source;
    },

    async postAtom(source, opts) {
      const headers: Record<string, string> = {};
      if (opts.description) headers["x-description"] = opts.description;
      if (opts.allowNoDescription) headers["x-allow-no-description"] = "true";
      if (opts.tests) headers["x-require-tests"] = opts.tests;
      if (opts.isTest) headers["x-is-test"] = "true";
      if (opts.noTests) headers["x-no-tests"] = "true";
      if (opts.goal) headers["x-goal"] = opts.goal;
      const urlPath = (await text("/a", {
        method: "POST",
        headers,
        body: source,
      })).trim();
      // Server returns /a/xx/yy/rest.ts — extract hash
      const m = urlPath.match(
        /\/a\/([a-z0-9]{2})\/([a-z0-9]{2})\/([a-z0-9]+)\.ts/,
      );
      return m ? m[1] + m[2] + m[3] : urlPath;
    },

    deleteAtom: (hash) => ok(`/a/${hash}`, { method: "DELETE" }),

    describeRead: (hash) => text(`/a/${hash}/description`),

    describeUpdate: (hash, description) =>
      ok(`/a/${hash}/description`, {
        method: "POST",
        body: description,
        headers: { "content-type": "text/plain" },
      }),

    // Discovery
    recent: (opts = {}) =>
      json(`/recent${
        qs({
          n: opts.n,
          goal: opts.goal,
          broken: opts.broken,
          prop: opts.prop,
          all: opts.all,
        })
      }`),

    info: (hash) => json(`/info/${hash}`),

    search: (query, k) => json(`/search${qs({ q: query, k })}`),

    searchCode: (query, k) => json(`/search${qs({ code: query, k })}`),

    similar: (hash, k) => json(`/similar/${hash}${qs({ k })}`),

    // Relationships
    queryRelationships: (query) =>
      json(`/relationships${
        qs({
          from: query.from,
          to: query.to,
          kind: query.kind,
        })
      }`),

    async addRelationship(from, kind, to) {
      const res = await transport.fetch("/relationships", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, kind, to }),
      });
      if (!res.ok) throw new ApiError(res.status, await res.text());
      await res.body?.cancel();
      return res.status === 201 ? "created" : "exists";
    },

    removeRelationship: (from, kind, to) =>
      ok("/relationships", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, kind, to }),
      }),

    async dependents(hash) {
      const rels: Relationship[] = await json(
        `/relationships${qs({ to: hash, kind: "imports" })}`,
      );
      return rels.map((r) => r.from);
    },

    tops: (hash, opts = {}) =>
      json(`/tops/${hash}${
        qs({
          limit: opts.limit,
          all: opts.all,
        })
      }`),

    // Properties
    listProperties: (hash) => json(`/properties${qs({ hash })}`),

    setProperty: (hash, key, value) =>
      ok("/properties", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hash, key, value }),
      }),

    unsetProperty: (hash, key) =>
      ok("/properties", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hash, key }),
      }),

    // Testing
    async getTestEvaluation(test, target) {
      try {
        return await json(`/test-evaluation${qs({ test, target })}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },

    setTestEvaluation: (opts) =>
      ok("/test-evaluation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          test: opts.test,
          target: opts.target,
          expected_outcome: opts.expectedOutcome,
          commentary: opts.commentary,
        }),
      }),

    updateTestEvaluation: (opts) =>
      ok("/test-evaluation", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          test: opts.test,
          target: opts.target,
          commentary: opts.commentary,
        }),
      }),

    getTestRuns: (opts) =>
      json(`/test-runs${
        qs({
          target: opts.target,
          test: opts.test,
          recent: opts.recent,
        })
      }`),

    // Goals
    listGoals: (opts = {}) =>
      json(`/goals${qs({ done: opts.done, all: opts.all })}`),

    getGoal: (name) => json(`/goals/${encodeURIComponent(name)}`),

    createGoal: (name, opts = {}) =>
      json("/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, weight: opts.weight, body: opts.body }),
      }),

    updateGoal: (name, opts) =>
      ok(`/goals/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts),
      }),

    deleteGoal: (name) =>
      ok(`/goals/${encodeURIComponent(name)}`, { method: "DELETE" }),

    markGoalDone: (name) =>
      ok(`/goals/${encodeURIComponent(name)}/done`, { method: "POST" }),

    markGoalUndone: (name) =>
      ok(`/goals/${encodeURIComponent(name)}/undone`, { method: "POST" }),

    addGoalComment: (name, body) =>
      ok(`/goals/${encodeURIComponent(name)}/comments`, {
        method: "POST",
        body,
        headers: { "content-type": "text/plain" },
      }),

    getGoalComments: (name, opts = {}) =>
      json(
        `/goals/${encodeURIComponent(name)}/comments${
          qs({ recent: opts.recent })
        }`,
      ),

    deleteGoalComment: (name, id) =>
      ok(`/goals/${encodeURIComponent(name)}/comments/${id}`, {
        method: "DELETE",
      }),

    // Prompts
    async getPrompt(name, defaultOnly) {
      const res = await transport.fetch(
        `/prompts/${name}${qs({ default: defaultOnly })}`,
      );
      if (!res.ok) throw new ApiError(res.status, await res.text());
      const source = res.headers.get("x-prompt-source") === "override"
        ? "override" as const
        : "default" as const;
      return { text: await res.text(), source };
    },

    setPrompt: (name, body) =>
      ok(`/prompts/${name}`, {
        method: "PUT",
        body,
        headers: { "content-type": "text/plain" },
      }),

    resetPrompt: (name) => ok(`/prompts/${name}`, { method: "DELETE" }),

    // Status & logs
    getStatus: (since) => json(`/status${qs({ since })}`),

    getLog: (opts = {}) =>
      json(`/log${
        qs({
          recent: opts.recent,
          op: opts.op,
          subject: opts.subject,
        })
      }`),

    // Bundle
    async getBundle(hash) {
      const res = await transport.fetch(`/bundle/${hash}`);
      if (!res.ok) {
        throw new ApiError(res.status, await res.text());
      }
      return new Uint8Array(await res.arrayBuffer());
    },

    // Subprocess operations
    async exec(hash, scriptArgs = []) {
      const d = opts?.deno;
      const base = opts?.baseUrl;
      if (!d || !base) {
        throw new Error("exec requires DenoCap and baseUrl");
      }
      const atomUrl = `${base}/a/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${
        hash.slice(4)
      }.ts`;
      const runTs = new URL("../run.ts", import.meta.url).pathname;
      const proc = new d.Command(d.execPath(), {
        args: ["run", "--allow-all", "--no-lock", runTs, ...scriptArgs],
        env: { ...d.env.toObject(), ZTS_EXEC_URL: atomUrl },
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      });
      const { code } = await proc.output();
      return { code };
    },

    async execBundle(zipData) {
      const d = opts?.deno;
      if (!d) throw new Error("execBundle requires DenoCap");
      const files = parseZip(zipData);
      const tmpDir = await d.makeTempDir({ prefix: "zts-" });
      try {
        for (const [path, data] of files) {
          const fullPath = `${tmpDir}/${path}`;
          await d.mkdir(fullPath.replace(/\/[^/]+$/, ""), { recursive: true });
          await d.writeFile(fullPath, data);
        }
        const runTsRel = [...files.keys()].find((p) => p.endsWith("/run.ts"));
        if (!runTsRel) throw new Error("bundle has no run.ts entry point");
        const proc = new d.Command(d.execPath(), {
          args: ["run", "--allow-all", "--no-lock", `${tmpDir}/${runTsRel}`],
          env: { ...d.env.toObject(), ZTS_EXEC_URL: "" },
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
        });
        const { code } = await proc.output();
        return { code };
      } finally {
        await d.remove(tmpDir, { recursive: true });
      }
    },

    async scriptTypes() {
      const d = opts?.deno;
      if (!d) throw new Error("scriptTypes requires DenoCap");
      const clientMod = new URL("./api-client.ts", import.meta.url).pathname;
      const src = await d.readTextFile(clientMod);
      const cutoff = src.indexOf("\n// ---- Transport");
      return cutoff > 0 ? src.slice(0, cutoff).trim() : src;
    },

    async script(fileOrCode, scriptOpts) {
      const d = opts?.deno;
      const base = opts?.baseUrl;
      if (!d || !base) throw new Error("script requires DenoCap and baseUrl");
      const isFile = scriptOpts?.file ?? false;
      const clientMod = new URL("./api-client.ts", import.meta.url).pathname;
      let scriptBody: string;
      if (isFile) {
        const scriptPath = fileOrCode.startsWith("/")
          ? fileOrCode
          : `${d.cwd()}/${fileOrCode}`;
        scriptBody = `await import("${scriptPath}");`;
      } else {
        // Write inline code to a temp file, import that
        const codeTmp = await d.makeTempFile({
          suffix: ".ts",
          dir: opts?.tmpDir,
        });
        await d.writeTextFile(codeTmp, fileOrCode);
        scriptBody = `await import("${codeTmp}");`;
      }
      const wrapper = `\
import { createBearerClient, type ZtsClient } from "${clientMod}";
declare global { var zts: ZtsClient; }
globalThis.zts = createBearerClient(
  Deno.env.get("ZTS_URL")!,
  { dev: Deno.env.get("ZTS_DEV_TOKEN"), admin: Deno.env.get("ZTS_ADMIN_TOKEN") },
  Deno,
);
${scriptBody}
`;
      const tmpFile = await d.makeTempFile({
        suffix: ".ts",
        dir: opts?.tmpDir,
      });
      await d.writeTextFile(tmpFile, wrapper);
      try {
        // Type-check
        const check = new d.Command(d.execPath(), {
          args: ["check", tmpFile],
          stdout: "inherit",
          stderr: "inherit",
        });
        const checkResult = await check.output();
        if (checkResult.code !== 0) {
          return { code: checkResult.code };
        }
        // Run
        const run = new d.Command(d.execPath(), {
          args: ["run", "--allow-all", "--no-lock", tmpFile],
          env: { ...d.env.toObject(), ZTS_URL: base },
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
        });
        const runResult = await run.output();
        return { code: runResult.code };
      } finally {
        await d.remove(tmpFile);
      }
    },

    async runTests(hash) {
      const d = opts?.deno;
      const base = opts?.baseUrl;
      if (!d || !base) {
        throw new Error("runTests requires DenoCap and baseUrl");
      }
      const rels: Relationship[] = await json(
        `/relationships${qs({ to: hash, kind: "tests" })}`,
      );
      if (rels.length === 0) return [];
      const testHashes = rels.map((r) => r.from);
      const serverHost = new URL(base).host;
      const runnerPath = new URL(
        "../src/test-runner.ts",
        import.meta.url,
      ).pathname;
      const proc = new d.Command(d.execPath(), {
        args: [
          "test",
          `--allow-import=${serverHost}`,
          "--no-lock",
          runnerPath,
          "--",
          base,
          hash,
          testHashes.join(","),
        ],
        stdout: "piped",
        stderr: "piped",
      });
      const output = await proc.output();
      const passed = output.code === 0;
      return testHashes.map((t) => ({
        testAtom: t,
        passed,
        error: passed ? undefined : new TextDecoder().decode(output.stderr),
      }));
    },
  };
}

// ---- Constructors ----

/** Create a client using bearer token auth (for CLI / Deno). */
export function createBearerClient(
  baseUrl: string,
  tokens: { dev?: string; admin?: string },
  deno?: DenoCap,
  opts?: { tmpDir?: string },
): ZtsClient {
  return buildClient({
    fetch(path, init = {}) {
      const token = tokens.admin ?? tokens.dev;
      const headers: Record<string, string> = {
        ...(init.headers as Record<string, string> ?? {}),
      };
      if (token) headers["authorization"] = `Bearer ${token}`;
      return fetch(`${baseUrl}${path}`, { ...init, headers });
    },
  }, { deno, baseUrl, tmpDir: opts?.tmpDir });
}

/** Create a client using cookie auth (for browser UI). */
export function createCookieClient(): ZtsClient {
  return buildClient({
    fetch(path, init = {}) {
      return fetch(path, { ...init, credentials: "same-origin" as const });
    },
  });
}
