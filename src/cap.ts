/**
 * Capability interface for operations requiring platform APIs.
 * Pass `Deno` as the real implementation; mock in tests.
 */
export interface DenoCap {
  execPath(): string;
  cwd(): string;
  env: {
    get(key: string): string | undefined;
    toObject(): Record<string, string>;
  };
  Command: typeof Deno.Command;
  readFile(path: string | URL): Promise<Uint8Array>;
  readTextFile(path: string | URL): Promise<string>;
  writeFile(path: string | URL, data: Uint8Array): Promise<void>;
  writeTextFile(path: string | URL, data: string): Promise<void>;
  makeTempFile(options?: { suffix?: string; dir?: string }): Promise<string>;
  makeTempDir(options?: { prefix?: string }): Promise<string>;
  mkdir(path: string | URL, options?: { recursive?: boolean }): Promise<void>;
  remove(path: string | URL, options?: { recursive?: boolean }): Promise<void>;
}
