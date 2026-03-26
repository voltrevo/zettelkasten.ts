/** Default prompts for the agent loop. Reads from .md files at import time. */

const PROMPT_DIR = new URL(".", import.meta.url).pathname;

// Read prompt files synchronously at module load
const DEFAULT_PROMPT = Deno.readTextFileSync(`${PROMPT_DIR}/worker-prompt.md`);
const DEFAULT_RETROSPECTIVE = Deno.readTextFileSync(
  `${PROMPT_DIR}/worker-retrospective.md`,
);

export { DEFAULT_PROMPT, DEFAULT_RETROSPECTIVE };

export const PROMPT_NAMES = [
  "prompt",
  "retrospective",
] as const;

export type PromptName = typeof PROMPT_NAMES[number];

export function getDefaultPrompt(name: PromptName): string {
  switch (name) {
    case "prompt":
      return DEFAULT_PROMPT;
    case "retrospective":
      return DEFAULT_RETROSPECTIVE;
  }
}
