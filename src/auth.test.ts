import { assertEquals } from "@std/assert";
import {
  type AuthConfig,
  type AuthTier,
  checkAuth,
  resolveAuthTier,
} from "./auth.ts";

const config: AuthConfig = {
  devToken: "dev-secret",
  adminToken: "admin-secret",
};

// --- resolveAuthTier ---

Deno.test("auth: no header → unauthed", () => {
  assertEquals(resolveAuthTier(null, config), "unauthed");
});

Deno.test("auth: dev token → dev", () => {
  assertEquals(
    resolveAuthTier("Bearer dev-secret", config),
    "dev",
  );
});

Deno.test("auth: admin token → admin", () => {
  assertEquals(
    resolveAuthTier("Bearer admin-secret", config),
    "admin",
  );
});

Deno.test("auth: wrong token → null", () => {
  assertEquals(
    resolveAuthTier("Bearer wrong-token", config),
    null,
  );
});

Deno.test("auth: malformed header → null", () => {
  assertEquals(resolveAuthTier("Basic abc123", config), null);
});

Deno.test("auth: admin token also matches when devToken is same", () => {
  const sameConfig: AuthConfig = {
    devToken: "shared",
    adminToken: "shared",
  };
  // admin is checked first, so it wins
  assertEquals(resolveAuthTier("Bearer shared", sameConfig), "admin");
});

Deno.test("auth: no tokens configured → any bearer is invalid", () => {
  const noTokens: AuthConfig = {
    devToken: undefined,
    adminToken: undefined,
  };
  assertEquals(resolveAuthTier(null, noTokens), "unauthed");
  assertEquals(resolveAuthTier("Bearer anything", noTokens), null);
});

// --- checkAuth ---

Deno.test("auth: unauthed route always passes", () => {
  assertEquals(checkAuth("unauthed", "unauthed"), null);
  assertEquals(checkAuth("dev", "unauthed"), null);
  assertEquals(checkAuth("admin", "unauthed"), null);
  assertEquals(checkAuth(null, "unauthed"), null);
});

Deno.test("auth: dev route requires dev or admin", () => {
  assertEquals(checkAuth("dev", "dev"), null);
  assertEquals(checkAuth("admin", "dev"), null);
  const unauthed = checkAuth("unauthed", "dev");
  assertEquals(unauthed?.status, 401);
  const invalid = checkAuth(null, "dev");
  assertEquals(invalid?.status, 401);
});

Deno.test("auth: admin route requires admin", () => {
  assertEquals(checkAuth("admin", "admin"), null);
  const devOnAdmin = checkAuth("dev", "admin");
  assertEquals(devOnAdmin?.status, 403);
  const unauthed = checkAuth("unauthed", "admin");
  assertEquals(unauthed?.status, 401);
});

// --- ADMIN_ONLY_PROPERTIES ---

Deno.test("auth: starred property would need admin check", () => {
  // This tests the pattern, not the server wiring
  const ADMIN_ONLY_PROPS = new Set(["starred"]);
  const key = "starred";
  const tier: AuthTier = "dev";
  const required = ADMIN_ONLY_PROPS.has(key) ? "admin" : "dev";
  const result = checkAuth(tier, required as AuthTier);
  assertEquals(result?.status, 403);
});
