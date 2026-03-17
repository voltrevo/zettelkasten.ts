import { assertEquals } from "@std/assert";
import {
  checkEmbeddingService,
  cosineSimilarity,
  fetchEmbedding,
} from "./embed.ts";

// --- cosineSimilarity ---

Deno.test("cosineSimilarity: parallel vectors → 1.0", () => {
  const a = new Float32Array([1, 0, 0]);
  const b = new Float32Array([2, 0, 0]);
  const score = cosineSimilarity(a, b);
  assertEquals(Math.abs(score - 1.0) < 1e-6, true);
});

Deno.test("cosineSimilarity: orthogonal vectors → 0.0", () => {
  const a = new Float32Array([1, 0]);
  const b = new Float32Array([0, 1]);
  assertEquals(cosineSimilarity(a, b), 0);
});

Deno.test("cosineSimilarity: opposite vectors → -1.0", () => {
  const a = new Float32Array([1, 0]);
  const b = new Float32Array([-1, 0]);
  const score = cosineSimilarity(a, b);
  assertEquals(Math.abs(score + 1.0) < 1e-6, true);
});

Deno.test("cosineSimilarity: length mismatch → 0", () => {
  const a = new Float32Array([1, 2, 3]);
  const b = new Float32Array([1, 2]);
  assertEquals(cosineSimilarity(a, b), 0);
});

Deno.test("cosineSimilarity: zero vector → 0", () => {
  const a = new Float32Array([0, 0, 0]);
  const b = new Float32Array([1, 2, 3]);
  assertEquals(cosineSimilarity(a, b), 0);
});

// --- fetchEmbedding ---

Deno.test("fetchEmbedding: parses Ollama format", async () => {
  const embedding = [0.1, 0.2, 0.3];
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    () =>
      new Response(JSON.stringify({ embedding }), {
        headers: { "content-type": "application/json" },
      }),
  );
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const result = await fetchEmbedding("test", {
      url: `http://localhost:${port}/api/embeddings`,
      model: "test-model",
    });
    assertEquals(result?.length, 3);
    assertEquals(Math.abs(result![0] - 0.1) < 1e-6, true);
    assertEquals(Math.abs(result![2] - 0.3) < 1e-6, true);
  } finally {
    await server.shutdown();
  }
});

Deno.test("fetchEmbedding: parses OpenAI-compatible format", async () => {
  const embedding = [0.4, 0.5, 0.6];
  const server = Deno.serve({ port: 0, onListen: () => {} }, () =>
    new Response(
      JSON.stringify({ data: [{ embedding }] }),
      { headers: { "content-type": "application/json" } },
    ));
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const result = await fetchEmbedding("test", {
      url: `http://localhost:${port}/api/embeddings`,
      model: "test-model",
    });
    assertEquals(Math.abs(result![0] - 0.4) < 1e-6, true);
  } finally {
    await server.shutdown();
  }
});

Deno.test("fetchEmbedding: returns null on 500", async () => {
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    () => new Response("error", { status: 500 }),
  );
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const result = await fetchEmbedding("test", {
      url: `http://localhost:${port}/api/embeddings`,
      model: "test-model",
    });
    assertEquals(result, null);
  } finally {
    await server.shutdown();
  }
});

Deno.test("fetchEmbedding: returns null on connection refused", async () => {
  const result = await fetchEmbedding("test", {
    url: "http://localhost:19999/api/embeddings",
    model: "test-model",
  });
  assertEquals(result, null);
});

// --- checkEmbeddingService ---

Deno.test("checkEmbeddingService: returns true when /api/tags responds 200", async () => {
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
    if (new URL(req.url).pathname === "/api/tags") {
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  });
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const ok = await checkEmbeddingService({
      url: `http://localhost:${port}/api/embeddings`,
      model: "test",
    });
    assertEquals(ok, true);
  } finally {
    await server.shutdown();
  }
});

Deno.test("checkEmbeddingService: returns false when unreachable", async () => {
  const ok = await checkEmbeddingService({
    url: "http://localhost:19999/api/embeddings",
    model: "test",
  });
  assertEquals(ok, false);
});
