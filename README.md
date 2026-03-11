# codex-spawn-agents

`codex-spawn` is a Bun-based CLI for launching one or more Codex SDK agents from the terminal.

It supports:
- a single positional prompt
- multiple parallel agents with repeated `-p` flags
- sandbox and model overrides
- streamed progress to `stderr`
- JSONL event output for automation
- optional result file output

## Install

```bash
bun install
```

## Usage

```bash
# Single agent
bun run src/cli.ts "summarize the repo structure"

# Multiple parallel agents
bun run src/cli.ts -p "review security" -p "review code quality" -p "check test coverage"

# Installed binary name
codex-spawn "summarize the repo structure"
```

## Options

```text
-p <prompt>               Run an agent with the given prompt. Repeat for parallel agents.
--model <model>           Model override
--sandbox <mode>          read-only (default), workspace-write, danger-full-access
--full-auto               Shorthand for --sandbox danger-full-access
--json                    Output JSONL stream events to stdout
--cwd <path>              Working directory for agents (default: current directory)
-o, --output <path>       Write final results to file
--help                    Show help
```

## Behavior

- Positional prompt runs exactly one agent.
- Repeated `-p` flags run agents in parallel.
- Progress is written to `stderr` with agent indexes.
- Final results are written to `stdout`.
- `--json` streams JSONL events to `stdout` and writes a JSON summary when used with `--output`.
- The process exits with `0` when every agent succeeds, otherwise `1`.
- `SIGINT` aborts all running agents.

## Examples

```bash
# Read-only by default
codex-spawn "summarize the repo structure"

# Override model
codex-spawn --model gpt-5-codex -p "review security" -p "review performance"

# Allow workspace writes
codex-spawn --sandbox workspace-write "apply the requested refactor"

# Full auto shorthand
codex-spawn --full-auto "fix the failing tests"

# Save final results
codex-spawn -p "review security" -p "review code quality" -o reports/review.txt

# Stream JSONL for automation
codex-spawn --json -p "review security" -p "review code quality"
```

## Development

```bash
bun test
bun run src/cli.ts --help
bun run build
```

## License

MIT
