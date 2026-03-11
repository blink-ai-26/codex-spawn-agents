#!/usr/bin/env bun

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Codex, type SandboxMode, type ThreadEvent, type ThreadOptions, type Usage } from "@openai/codex-sdk";

const SANDBOX_MODES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

const HELP = `\
codex-spawn - launch one or more Codex agents

Usage:
  codex-spawn "summarize the repo structure"
  codex-spawn -p "review security" -p "review code quality"

Options:
  -p <prompt>               Run an agent with the given prompt. Repeat for parallel agents.
  --model <model>           Model override
  --sandbox <mode>          read-only (default), workspace-write, danger-full-access
  --full-auto               Shorthand for --sandbox danger-full-access
  --json                    Output JSONL stream events to stdout
  --cwd <path>              Working directory for agents (default: current directory)
  -o, --output <path>       Write final results to file
  --help                    Show help`;

// -- Types --

export type CliConfig = {
  prompts: string[];
  model?: string;
  sandboxMode: SandboxMode;
  json: boolean;
  cwd: string;
  output?: string;
};

type AgentResult = {
  index: number;
  prompt: string;
  success: boolean;
  finalResponse: string;
  usage: Usage | null;
  threadId: string | null;
  error?: string;
};

// -- Arg parsing --

export function parseCliArgs(argv: string[]): CliConfig | "help" {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      prompt: { type: "string", short: "p", multiple: true },
      model: { type: "string" },
      sandbox: { type: "string" },
      "full-auto": { type: "boolean" },
      json: { type: "boolean" },
      cwd: { type: "string" },
      output: { type: "string", short: "o" },
      help: { type: "boolean" },
    },
  });

  if (values.help) return "help";

  const promptFlags = values.prompt ?? [];

  if (positionals.length > 0 && promptFlags.length > 0) {
    throw new Error("Cannot mix a positional prompt with -p/--prompt flags.");
  }
  if (positionals.length > 1) {
    throw new Error("Only one positional prompt is allowed.");
  }

  const prompts = positionals.length === 1 ? [positionals[0]!] : promptFlags;
  if (prompts.length === 0) {
    throw new Error("Provide a prompt as a positional argument or with one or more -p flags.");
  }

  const fullAuto = values["full-auto"] ?? false;
  const sandbox = values.sandbox;

  if (fullAuto && sandbox && sandbox !== "danger-full-access") {
    throw new Error("--full-auto cannot be combined with a different --sandbox value.");
  }

  const sandboxMode = (fullAuto ? "danger-full-access" : sandbox ?? "read-only") as SandboxMode;
  if (!SANDBOX_MODES.includes(sandboxMode)) {
    throw new Error(`Invalid sandbox mode: ${sandboxMode}`);
  }

  return {
    prompts,
    model: values.model,
    sandboxMode,
    json: values.json ?? false,
    cwd: resolve(values.cwd ?? process.cwd()),
    output: values.output,
  };
}

// -- Logging helpers --

const log = (s: string) => process.stderr.write(`${s}\n`);
const out = (s: string) => process.stdout.write(`${s}\n`);

// -- Event description --

function describeEvent(i: number, e: ThreadEvent): string | null {
  const tag = `[agent ${i}]`;
  switch (e.type) {
    case "thread.started": return `${tag} thread started: ${e.thread_id}`;
    case "turn.started": return `${tag} turn started`;
    case "turn.completed": {
      const u = e.usage;
      const usage = u ? `in=${u.input_tokens} cached=${u.cached_input_tokens} out=${u.output_tokens}` : "n/a";
      return `${tag} completed (${usage})`;
    }
    case "turn.failed": return `${tag} failed: ${e.error.message}`;
    case "error": return `${tag} stream error: ${e.message}`;
    case "item.started":
      switch (e.item.type) {
        case "reasoning": return `${tag} reasoning`;
        case "todo_list": return `${tag} planning`;
        case "command_execution": return `${tag} command: ${e.item.command}`;
        case "web_search": return `${tag} web search: ${e.item.query}`;
        case "mcp_tool_call": return `${tag} tool: ${e.item.server}/${e.item.tool}`;
        case "file_change": return `${tag} applying file changes`;
        case "agent_message": return `${tag} responding`;
        case "error": return `${tag} error: ${e.item.message}`;
      }
      break;
    case "item.completed":
      switch (e.item.type) {
        case "command_execution":
          return `${tag} command ${e.item.status}${e.item.exit_code != null ? ` (exit ${e.item.exit_code})` : ""}`;
        case "mcp_tool_call": return `${tag} tool ${e.item.status}: ${e.item.server}/${e.item.tool}`;
        case "file_change": return `${tag} file changes ${e.item.status}`;
        case "error": return `${tag} error: ${e.item.message}`;
        default: return null;
      }
    case "item.updated": return null;
  }
  return null;
}

// -- Agent runner --

function result(
  index: number, prompt: string, success: boolean,
  finalResponse: string, usage: Usage | null, threadId: string | null,
  error?: string,
): AgentResult {
  return { index, prompt, success, finalResponse, usage, threadId, ...(error ? { error } : {}) };
}

async function runAgent(
  codex: Codex, index: number, prompt: string,
  opts: ThreadOptions, signal: AbortSignal, json: boolean,
): Promise<AgentResult> {
  const thread = codex.startThread(opts);
  let finalResponse = "";
  let usage: Usage | null = null;
  let threadId: string | null = null;

  const emitJson = (payload: unknown) => json && out(JSON.stringify(payload));

  try {
    log(`[agent ${index}] starting`);
    const { events } = await thread.runStreamed(prompt, { signal });

    for await (const event of events) {
      // Track agent message text
      if ("item" in event && event.item.type === "agent_message") {
        finalResponse = event.item.text;
      }

      if (event.type === "thread.started") threadId = event.thread_id;

      // Terminal failure events
      if (event.type === "turn.failed" || event.type === "error") {
        const msg = describeEvent(index, event);
        if (msg) log(msg);
        const errMsg = event.type === "turn.failed" ? event.error.message : event.message;
        emitJson({ agent: index, prompt, event });
        return result(index, prompt, false, finalResponse, usage, threadId, errMsg);
      }

      if (event.type === "turn.completed") usage = event.usage;

      const msg = describeEvent(index, event);
      if (msg) log(msg);
      emitJson({ agent: index, prompt, event });
    }

    const success = usage !== null; // turn.completed sets usage
    if (!success) {
      const err = signal.aborted ? "aborted" : "stream ended before completion";
      return result(index, prompt, false, finalResponse, usage, threadId, err);
    }

    return result(index, prompt, true, finalResponse, usage, threadId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`[agent ${index}] failed: ${message}`);
    return result(index, prompt, false, finalResponse, usage, threadId, message);
  }
}

// -- Output formatting --

function renderText(results: AgentResult[]): string {
  if (results.length === 1) {
    const r = results[0]!;
    return r.success ? r.finalResponse.trimEnd() : `Error: ${r.error ?? "agent failed"}`;
  }
  return results
    .map((r) => `Agent ${r.index}: ${r.prompt}\n${r.success ? r.finalResponse.trimEnd() : `Error: ${r.error ?? "agent failed"}`}`)
    .join("\n\n");
}

// -- Main --

async function main(argv: string[]): Promise<number> {
  let config: CliConfig;
  try {
    const parsed = parseCliArgs(argv);
    if (parsed === "help") { out(HELP); return 0; }
    config = parsed;
  } catch (err) {
    log(err instanceof Error ? err.message : String(err));
    log("");
    log(HELP);
    return 1;
  }

  const controller = new AbortController();
  let interrupted = false;
  process.once("SIGINT", () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    log("Received SIGINT, aborting all agents...");
    controller.abort();
  });

  const codex = new Codex();
  const opts: ThreadOptions = {
    model: config.model,
    sandboxMode: config.sandboxMode,
    workingDirectory: config.cwd,
  };

  const results = await Promise.all(
    config.prompts.map((prompt, i) =>
      runAgent(codex, i + 1, prompt, opts, controller.signal, config.json),
    ),
  );

  if (!config.json) {
    const text = renderText(results);
    if (text) out(text);
  }

  if (config.output) {
    const content = config.json
      ? JSON.stringify(results, null, 2)
      : `${renderText(results)}\n`;
    await writeFile(resolve(config.output), content, "utf8");
    log(`Wrote results to ${resolve(config.output)}`);
  }

  return results.every((r) => r.success) ? 0 : 1;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
