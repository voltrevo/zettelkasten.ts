// Minimal type shim so api-client.ts compiles in browser context.
// The browser never uses DenoCap — this just satisfies the type checker.
declare namespace Deno {
  class Command {
    constructor(cmd: string, opts?: unknown);
    output(): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }>;
    spawn(): unknown;
  }
}
