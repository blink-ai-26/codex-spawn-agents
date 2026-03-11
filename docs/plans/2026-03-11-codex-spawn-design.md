# codex-spawn CLI design

## Goal

Build a Bun CLI around `@openai/codex-sdk` that can run a single prompt or multiple prompts in parallel, surface live progress, and return machine-readable output when requested.

## Design

- Implement the CLI in `src/cli.ts`.
- Parse arguments with `node:util.parseArgs`.
- Support one positional prompt or repeated `-p` flags, but never both.
- Start one Codex thread per prompt with shared thread options for model, sandbox mode, and working directory.
- Stream human-readable progress to `stderr`.
- Emit raw JSONL event envelopes to `stdout` in `--json` mode.
- Render final text results to `stdout` in default mode.
- Persist final results to a file when `--output` is provided.
- Abort all running turns on `SIGINT` using `AbortController`.

## Verification plan

- Add Bun tests for argument parsing and result rendering.
- Run `bun test`.
- Run `bun run src/cli.ts --help`.
- Run `bun run build`.
