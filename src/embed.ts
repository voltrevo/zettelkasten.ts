export interface EmbedConfig {
  url: string;
  model: string;
}

export function defaultEmbedConfig(): EmbedConfig {
  return {
    url: Deno.env.get("ZTS_EMBED_URL") ??
      "http://localhost:11434/api/embeddings",
    model: Deno.env.get("ZTS_EMBED_MODEL") ?? "nomic-embed-text",
  };
}

// Returns null if the service is unavailable or returns an error — never throws.
export async function fetchEmbedding(
  text: string,
  config: EmbedConfig,
): Promise<Float32Array | null> {
  try {
    const t0 = performance.now();
    const res = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: config.model, prompt: text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const json = await res.json();
    const ms = Math.round(performance.now() - t0);
    console.log(`[embed] ${ms}ms (${text.length} chars)`);
    // Ollama format
    if (Array.isArray(json.embedding)) {
      return new Float32Array(json.embedding);
    }
    // OpenAI-compatible format
    if (Array.isArray(json.data?.[0]?.embedding)) {
      return new Float32Array(json.data[0].embedding);
    }
    return null;
  } catch {
    return null;
  }
}

// Returns true if the embedding service responds to a lightweight ping.
export async function checkEmbeddingService(
  config: EmbedConfig,
): Promise<boolean> {
  try {
    // Derive base URL: strip path to get the root
    const base = new URL(config.url).origin;
    const res = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(2_000),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

// dot(a,b) / (|a| * |b|); returns 0 if lengths differ or either has zero magnitude.
// Used in tests; HNSW handles similarity internally for search.
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
