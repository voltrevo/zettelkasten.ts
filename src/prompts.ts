/** Default prompts for the agent loop. Reads from .md files on each call. */

const PROMPT_DIR = new URL(".", import.meta.url).pathname;

const PROMPT_FILES = {
  prompt: `${PROMPT_DIR}/worker-prompt.md`,
  retrospective: `${PROMPT_DIR}/worker-retrospective.md`,
} as const;

export const PROMPT_NAMES = [
  "prompt",
  "retrospective",
] as const;

export type PromptName = typeof PROMPT_NAMES[number];

/** Read the default prompt from disk (not cached — picks up edits). */
export function getDefaultPrompt(name: PromptName): string {
  return Deno.readTextFileSync(PROMPT_FILES[name]);
}
