/** Default prompts for the agent loop. Reads from .md files at import time. */

const PROMPT_DIR = new URL(".", import.meta.url).pathname;

// Read prompt files synchronously at module load
const DEFAULT_PROMPT = Deno.readTextFileSync(`${PROMPT_DIR}/worker-prompt.md`);

const DEFAULT_RETROSPECTIVE = `\
# Retrospective instructions

This is a retrospective iteration. Instead of building atoms, reflect on the
last 30 iterations.

The recent summary history and any previous retrospectives are included below
in this prompt. Do not read summary or retrospective files from disk — that
content is already in your context. You may use zts CLI commands (status, list,
search, goal show, etc.) if you want additional context.

Write a retrospective file to the path specified below (retrospectives/retro-NNNN.md).
The retrospective should cover:

## Wins
The most significant atoms, goals, or capabilities added. What compounded?
What unlocked further work?

## Friction
Recurring problems, tooling gaps, workflow pain points. What slowed you down
or caused rework? Be specific — name the commands, error messages, or
patterns that caused trouble.

## Suggestions
Concrete improvements to zts (CLI, server, validation, search) or to the
agent workflow (summary format, goal structure, testing patterns). Prioritize
by impact.

## Observations
Anything else worth noting: patterns in the corpus, surprising discoveries,
quality trends, or meta-observations about the process.

Be terse and precise. This is written for the operator and for future agents.
Do not build atoms in this iteration.
`;

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
