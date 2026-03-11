import { describe, expect, test } from "bun:test";
import { parseCliArgs, renderJsonResults, renderTextResults } from "./cli";

describe("parseCliArgs", () => {
  test("parses a positional prompt with defaults", () => {
    const parsed = parseCliArgs(["summarize the repo structure"]);

    expect(parsed.prompts).toEqual(["summarize the repo structure"]);
    expect(parsed.sandboxMode).toBe("read-only");
    expect(parsed.json).toBe(false);
    expect(parsed.cwd).toBe(process.cwd());
  });

  test("collects repeated -p flags", () => {
    const parsed = parseCliArgs(["-p", "review security", "-p", "review code quality"]);

    expect(parsed.prompts).toEqual(["review security", "review code quality"]);
  });

  test("rejects mixing positional prompts with -p flags", () => {
    expect(() => parseCliArgs(["repo summary", "-p", "review security"])).toThrow(
      "Cannot mix a positional prompt with -p/--prompt flags.",
    );
  });

  test("full-auto selects danger-full-access", () => {
    const parsed = parseCliArgs(["--full-auto", "inspect the project"]);

    expect(parsed.sandboxMode).toBe("danger-full-access");
  });
});

describe("result rendering", () => {
  test("renders text for multiple agents", () => {
    const output = renderTextResults([
      {
        index: 1,
        prompt: "review security",
        success: true,
        finalResponse: "Looks good.\n",
        usage: null,
        threadId: "thread-1",
      },
      {
        index: 2,
        prompt: "review code quality",
        success: false,
        finalResponse: "",
        usage: null,
        threadId: "thread-2",
        error: "agent failed",
      },
    ]);

    expect(output).toBe("Agent 1: review security\nLooks good.\n\nAgent 2: review code quality\nError: agent failed");
  });

  test("renders json results", () => {
    const output = renderJsonResults([
      {
        index: 1,
        prompt: "review security",
        success: true,
        finalResponse: "Looks good.",
        usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
        threadId: "thread-1",
      },
    ]);

    expect(JSON.parse(output)).toEqual([
      {
        agent: 1,
        prompt: "review security",
        status: "completed",
        threadId: "thread-1",
        usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
        error: null,
        finalResponse: "Looks good.",
      },
    ]);
  });
});
