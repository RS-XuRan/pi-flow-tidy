import test from "node:test";
import assert from "node:assert/strict";
import { createUniversalTidy, getToolVisual } from "../runtime/universal-tidy.mjs";

function visibleWidth(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, "").length;
}

function truncateToWidth(value, width, ellipsis = "") {
  const text = String(value);
  if (visibleWidth(text) <= width) return text;
  return `${text.slice(0, Math.max(0, width - ellipsis.length))}${ellipsis}`;
}

const theme = {
  fg(_color, text) { return text; },
  bg(_color, text) { return text; },
  bold(text) { return text; },
};

const annotatedTheme = {
  fg(color, text) { return `<${color}>${text}</${color}>`; },
  bg(_color, text) { return text; },
  bold(text) { return `<b>${text}</b>`; },
};

function renderCompletedTool(name) {
  const runtime = createUniversalTidy({ truncateToWidth, visibleWidth });
  const tool = runtime.decorateToolDefinition({
    name,
    label: name,
    description: "Test tool",
    parameters: { type: "object", properties: {} },
    async execute() { return { content: [{ type: "text", text: "ok" }], details: {} }; },
  });
  return tool.renderResult(
    { content: [{ type: "text", text: "ok" }], details: {} },
    { expanded: false, isPartial: false },
    annotatedTheme,
    { args: { reasoning: "test visual" }, toolCallId: `visual-${name}`, state: {}, isError: false },
  ).render(120);
}

test("assigns distinct icons and colors with a generic fallback", () => {
  assert.deepEqual(getToolVisual("edit"), { category: "edit", icon: "✎", color: "warning" });
  assert.deepEqual(getToolVisual("third_party_grep"), { category: "search", icon: "⌕", color: "accent" });
  assert.deepEqual(getToolVisual("todo_update"), { category: "task", icon: "☑", color: "customMessageLabel" });
  assert.deepEqual(getToolVisual("vendor_widget"), { category: "generic", icon: "◆", color: "toolTitle" });

  const editLines = renderCompletedTool("edit");
  const grepLines = renderCompletedTool("grep");
  const todoLines = renderCompletedTool("todo");
  assert.match(editLines[0], /<warning>✎<\/warning> <warning><b>edit<\/b><\/warning>/);
  assert.match(grepLines[0], /<accent>⌕<\/accent> <accent><b>grep<\/b><\/accent>/);
  assert.match(todoLines[0], /<customMessageLabel>☑<\/customMessageLabel> <customMessageLabel><b>todo<\/b><\/customMessageLabel>/);
  assert.match(editLines[1], /<warning>└<\/warning>/);
});

test("keeps full-row backgrounds active after truncation resets ANSI styles", () => {
  const backgroundAnsi = "\x1b[48;2;60;40;40m";
  const resetAll = "\x1b[0m";
  const resetBackground = "\x1b[49m";
  const backgroundCalls = [];
  const shellTheme = {
    fg(_color, text) { return text; },
    bg(color, text) {
      backgroundCalls.push(color);
      return `${backgroundAnsi}${text}${resetBackground}`;
    },
    getBgAnsi() { return backgroundAnsi; },
    bold(text) { return text; },
  };
  const truncateWithReset = (value, width, ellipsis = "") => {
    const plain = String(value).replace(/\x1b\[[0-9;]*m/g, "");
    if (visibleWidth(plain) <= width) return plain;
    const prefix = plain.slice(0, Math.max(0, width - visibleWidth(ellipsis)));
    return `${prefix}${resetAll}${ellipsis}${resetAll}`;
  };
  const runtime = createUniversalTidy({ truncateToWidth: truncateWithReset, visibleWidth });
  const tool = runtime.decorateToolDefinition({
    name: "edit",
    label: "edit",
    description: "Test tool",
    parameters: { type: "object", properties: { path: { type: "string" } } },
    async execute() { return { content: [{ type: "text", text: "ok" }], details: {} }; },
  });
  const args = {
    reasoning: "update a lock file with a deliberately long rendering headline",
    path: "C:/Users/test/project/with/a/very/long/path/package-lock.json",
  };
  const state = {};
  const runningLines = tool.renderCall(args, shellTheme, {
    args,
    toolCallId: "background-gap",
    invalidate() {},
    state,
    isPartial: true,
  }).render(48);
  const errorLines = tool.renderResult(
    { content: [{ type: "text", text: "Found 2 occurrences of the text. The text must be unique." }], isError: true },
    { expanded: false, isPartial: false },
    shellTheme,
    { args, toolCallId: "background-gap", state, isPartial: false, isError: true },
  ).render(48);

  assert.equal(tool.renderShell, "self");
  assert.equal(backgroundCalls.length, 4);
  assert.ok([...runningLines, ...errorLines].every((line) => visibleWidth(line) === 48));
  assert.ok([...runningLines, ...errorLines].every((line) => line.startsWith(backgroundAnsi)));
  assert.ok([...runningLines, ...errorLines].every((line) => line.endsWith(resetBackground)));
  const truncatedLines = [...runningLines, ...errorLines].filter((line) => line.includes(resetAll));
  assert.ok(truncatedLines.length > 0);
  for (const line of truncatedLines) {
    for (const match of line.matchAll(/\x1b\[0m/g)) {
      const next = match.index + resetAll.length;
      assert.equal(line.slice(next, next + backgroundAnsi.length), backgroundAnsi);
    }
  }
});

test("decorates raw tool names and strips injected reasoning", async () => {
  const runtime = createUniversalTidy({ truncateToWidth, visibleWidth });
  let preparedArgs;
  let executedArgs;
  const source = {
    name: "third_party_search",
    label: "third_party_search",
    description: "Test tool",
    promptGuidelines: ["Keep the query narrow."],
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    prepareArguments(args) {
      preparedArgs = args;
      return { ...args, path: args.path ?? "." };
    },
    async execute(_id, args) {
      executedArgs = args;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        content: [{ type: "text", text: "src/a.ts:1:match\nsrc/b.ts:2:match" }],
        details: { totalMatched: 2, totalFiles: 2 },
      };
    },
  };

  const tool = runtime.decorateToolDefinition(source);
  assert.equal(tool.name, "third_party_search");
  assert.equal(tool.label, "third_party_search");
  assert.equal(tool.renderShell, "self");
  assert.equal(tool.parameters.properties.reasoning.type, "string");
  assert.deepEqual(tool.parameters.required, ["pattern"]);

  const rawArgs = { reasoning: "locate matching source files", pattern: "match", path: "src" };
  const prepared = tool.prepareArguments(rawArgs);
  assert.deepEqual(preparedArgs, { pattern: "match", path: "src" });
  assert.deepEqual(prepared, rawArgs);

  const state = {};
  const context = {
    args: rawArgs,
    toolCallId: "call-1",
    invalidate() {},
    lastComponent: undefined,
    state,
    cwd: process.cwd(),
    executionStarted: true,
    argsComplete: true,
    isPartial: true,
    expanded: false,
    showImages: false,
    isError: false,
  };
  const callLines = tool.renderCall(rawArgs, theme, context).render(120);
  assert.equal(callLines.length, 2);
  assert.match(callLines[0], /third_party_search locate matching source files/);

  const result = await tool.execute("call-1", prepared, undefined, undefined, {});
  assert.deepEqual(executedArgs, { pattern: "match", path: "src" });

  const resultLines = tool.renderResult(
    result,
    { expanded: false, isPartial: false },
    theme,
    { ...context, isPartial: false },
  ).render(120);
  assert.equal(resultLines.length, 2);
  assert.match(resultLines[1], /2 matches in 2 files · \d+(?:ms|s)/);
});

test("preserves an existing reasoning parameter", async () => {
  const runtime = createUniversalTidy({ truncateToWidth, visibleWidth });
  let executedArgs;
  const source = {
    name: "semantic_reasoning",
    label: "semantic_reasoning",
    description: "Test tool",
    parameters: {
      type: "object",
      properties: {
        reasoning: { type: "string" },
        value: { type: "string" },
      },
      required: ["reasoning", "value"],
    },
    async execute(_id, args) {
      executedArgs = args;
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  };
  const tool = runtime.decorateToolDefinition(source);
  const args = { reasoning: "preserve semantic input", value: "x" };
  await tool.execute("call-2", args, undefined, undefined, {});
  assert.deepEqual(executedArgs, args);
});

test("decorates built-in, SDK, and dynamically registered tools", () => {
  const runtime = createUniversalTidy({ truncateToWidth, visibleWidth });
  const makeTool = (name) => ({
    name,
    label: name,
    description: "Test tool",
    parameters: { type: "object", properties: { value: { type: "string" } } },
    async execute() { return { content: [{ type: "text", text: "ok" }], details: {} }; },
  });

  class FakeAgentSession {
    constructor() {
      this._baseToolDefinitions = new Map([["read", makeTool("read")]]);
      this._extensionRunner = {
        extensions: [{ tools: new Map([["late", { definition: makeTool("late_tool") }]]) }],
      };
      this._customTools = [makeTool("sdk_tool")];
    }
    _refreshToolRegistry() { this.refreshed = true; }
  }

  assert.equal(runtime.installAgentSessionPatch(FakeAgentSession), true);
  const session = new FakeAgentSession();
  session._refreshToolRegistry();
  assert.equal(session.refreshed, true);
  assert.equal(session._baseToolDefinitions.get("read").renderShell, "self");
  assert.equal(session._extensionRunner.extensions[0].tools.get("late").definition.renderShell, "self");
  assert.equal(session._customTools[0].renderShell, "self");
});
