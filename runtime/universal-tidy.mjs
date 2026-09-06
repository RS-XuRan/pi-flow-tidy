const DECORATED = Symbol.for("pi.flowTidy.decorated");
const PATCHED = Symbol.for("pi.flowTidy.agentSessionPatched");
const INTERACTIVE_PATCHED = Symbol.for("pi.flowTidy.interactiveModePatched");
const STATE_STARTED_AT = "universalTidyStartedAt";
const STATE_TIMER = "universalTidyTimer";
const STATE_ELAPSED_MS = "universalTidyElapsedMs";
const REASONING_DESCRIPTION =
  "Short phrase (12 words or fewer) stating the goal or intent. Use Chinese. Do not restate the target, path, command, or query.";
const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|authorization|credential|cookie)/i;
const OMIT_KEY = /^(reasoning|content|data|body|payload|patch|oldText|newText|edits|tool_uses)$/i;
const MAX_INLINE_VALUE = 140;
const CLEANUP_DELAY_MS = 5 * 60 * 1000;
const HORIZONTAL_PADDING = 1;
const DEFAULT_TOOL_VISUAL = Object.freeze({ category: "generic", icon: "🧩", color: "toolTitle" });
const TOOL_VISUAL_RULES = Object.freeze([
  { category: "orchestration", tokens: ["parallel", "batch", "multi", "orchestrate", "fanout"], icon: "🧬", color: "syntaxKeyword" },
  { category: "task", tokens: ["todo", "task", "plan", "checklist"], icon: "📋", color: "customMessageLabel" },
  { category: "edit", tokens: ["edit", "patch", "replace", "update", "modify", "mutate", "apply"], icon: "✏️", color: "warning" },
  { category: "search", tokens: ["grep", "search", "query", "match", "rg"], icon: "🔍", color: "accent" },
  { category: "discover", tokens: ["find", "glob", "locate", "list", "ls", "tree", "walk"], icon: "📂", color: "syntaxVariable" },
  { category: "read", tokens: ["read", "open", "fetch", "get", "inspect", "view"], icon: "📖", color: "mdLink" },
  { category: "write", tokens: ["write", "create", "save", "append"], icon: "💾", color: "syntaxString" },
  { category: "execute", tokens: ["bash", "shell", "exec", "execute", "run", "command", "terminal"], icon: "💻", color: "bashMode" },
  { category: "remove", tokens: ["delete", "remove", "unlink", "purge"], icon: "🗑️", color: "error" },
  { category: "interact", tokens: ["ask", "prompt", "confirm", "input", "question", "select"], icon: "💬", color: "mdHeading" },
  { category: "notify", tokens: ["notify", "notification", "alert", "message", "send"], icon: "🔔", color: "thinkingHigh" },
  { category: "web", tokens: ["web", "http", "browser", "click", "crawl", "scrape"], icon: "🌐", color: "borderAccent" },
  { category: "visual", tokens: ["image", "imagegen", "screenshot", "photo", "diagram"], icon: "🖼️", color: "syntaxType" },
  { category: "version", tokens: ["git", "commit", "branch", "merge", "rebase", "diff", "vcs"], icon: "🌿", color: "thinkingHigh" },
  { category: "data", tokens: ["time", "weather", "sports", "finance", "stock", "market"], icon: "📊", color: "syntaxNumber" },
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function oneLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clipPlain(value, max = MAX_INLINE_VALUE) {
  const text = oneLine(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function safeThemeCall(theme, method, keyOrText, maybeText) {
  try {
    if (maybeText === undefined) {
      const fn = theme?.[method];
      return typeof fn === "function" ? fn.call(theme, keyOrText) : String(keyOrText);
    }
    const fn = theme?.[method];
    return typeof fn === "function" ? fn.call(theme, keyOrText, maybeText) : String(maybeText);
  } catch {
    return String(maybeText === undefined ? keyOrText : maybeText);
  }
}

function fg(theme, color, text) {
  return safeThemeCall(theme, "fg", color, text);
}

function getForegroundAnsi(theme, color) {
  try {
    const direct = theme?.getFgAnsi;
    if (typeof direct === "function") {
      const value = direct.call(theme, color);
      if (typeof value === "string") return value;
    }
  } catch {}
  return "";
}

function emphasizeForegroundAnsi(theme, ansi) {
  const match = String(ansi).match(/^\x1b\[38;2;(\d+);(\d+);(\d+)m$/);
  if (!match) return ansi;
  const lightTheme = String(theme?.name ?? "").toLowerCase().includes("light");
  const target = lightTheme ? 0 : 255;
  const ratio = lightTheme ? 0.16 : 0.28;
  const channels = match.slice(1).map((value) => {
    const channel = Number(value);
    return Math.round(channel + (target - channel) * ratio);
  });
  return `\x1b[38;2;${channels.join(";")}m`;
}

function renderStatusBar(theme, color) {
  const ansi = getForegroundAnsi(theme, color);
  if (!ansi) return fg(theme, color, bold(theme, "▌"));
  return `${emphasizeForegroundAnsi(theme, ansi)}\x1b[1m▌\x1b[22m\x1b[39m`;
}

function bg(theme, color, text) {
  return safeThemeCall(theme, "bg", color, text);
}

function getBackgroundAnsi(theme, color) {
  try {
    const direct = theme?.getBgAnsi;
    if (typeof direct === "function") {
      const value = direct.call(theme, color);
      if (typeof value === "string") return value;
    }
  } catch {}

  try {
    const sample = theme?.bg;
    if (typeof sample === "function") {
      return String(sample.call(theme, color, "")).match(/^\x1b\[[0-9;]*m/)?.[0] ?? "";
    }
  } catch {}
  return "";
}

function paintBackground(theme, color, text) {
  const backgroundAnsi = getBackgroundAnsi(theme, color);
  const repaired = backgroundAnsi
    ? String(text).replace(/\x1b\[(?:0|00|49)?m/g, (reset) => `${reset}${backgroundAnsi}`)
    : text;
  return bg(theme, color, repaired);
}

function bold(theme, text) {
  return safeThemeCall(theme, "bold", text);
}

function renderValue(value, max = MAX_INLINE_VALUE) {
  if (typeof value === "string") return clipPlain(value, max);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const simple = value.filter((item) => ["string", "number", "boolean"].includes(typeof item)).slice(0, 3);
    if (simple.length > 0) return clipPlain(simple.join(", "), max);
    return `${value.length} items`;
  }
  if (isRecord(value)) return "object";
  return "";
}

function firstDefined(args, keys, max = MAX_INLINE_VALUE) {
  for (const key of keys) {
    if (!Object.hasOwn(args, key)) continue;
    const rendered = renderValue(args[key], max);
    if (rendered) return { key, value: rendered };
  }
  return undefined;
}

function targetDetail(name, args) {
  if (!isRecord(args)) return "";

  const fullWidth = Number.POSITIVE_INFINITY;
  const command = firstDefined(args, ["command", "cmd", "script"], fullWidth);
  if (command) return command.value;

  const pattern = firstDefined(args, ["pattern", "query", "search", "needle"], fullWidth);
  const path = firstDefined(args, ["path", "file", "filename", "directory", "cwd", "root"], fullWidth);
  if (pattern && path) return `${pattern.value} in ${path.value}`;
  if (pattern) return pattern.value;
  if (path) return path.value;

  const url = firstDefined(args, ["url", "uri", "endpoint"], fullWidth);
  if (url) return url.value;

  const action = firstDefined(args, ["action", "operation", "method", "fn"], fullWidth);
  const subject = firstDefined(args, ["name", "id", "ticker", "location", "team", "package", "model"], fullWidth);
  if (action && subject) return `${action.value} ${subject.value}`;
  if (subject) return subject.value;
  if (action) return action.value;

  const pairs = [];
  for (const [key, value] of Object.entries(args)) {
    if (OMIT_KEY.test(key) || SECRET_KEY.test(key)) continue;
    const rendered = renderValue(value, fullWidth);
    if (!rendered) continue;
    pairs.push(`${key}=${rendered}`);
    if (pairs.length >= 2) break;
  }
  return oneLine(pairs.join(" "));
}

function inferredIntent(name, args) {
  const target = targetDetail(name, args);
  const lower = String(name).toLowerCase();
  const action = isRecord(args) ? firstDefined(args, ["action", "operation", "method", "fn"])?.value : undefined;
  if (action) return clipPlain(`${action}${target && target !== action ? ` ${target}` : ""}`);
  if (/(grep|search)/.test(lower)) return clipPlain(`search${target ? ` for ${target}` : ""}`);
  if (/(find|glob)/.test(lower)) return clipPlain(`find${target ? ` ${target}` : " files"}`);
  if (/(read|open|fetch|get)/.test(lower)) return clipPlain(`inspect${target ? ` ${target}` : " requested data"}`);
  if (/(write|create|save)/.test(lower)) return clipPlain(`write${target ? ` ${target}` : " requested data"}`);
  if (/(edit|patch|replace|update)/.test(lower)) return clipPlain(`update${target ? ` ${target}` : " requested data"}`);
  if (/(bash|shell|exec|run)/.test(lower)) return clipPlain(`run${target ? ` ${target}` : " command"}`);
  if (/(delete|remove)/.test(lower)) return clipPlain(`remove${target ? ` ${target}` : " requested item"}`);
  if (/(notify|send|message)/.test(lower)) return clipPlain(`send${target ? ` ${target}` : " notification"}`);
  return clipPlain(target ? `use ${name} for ${target}` : `run ${name}`);
}

function reasoningHeadline(name, args) {
  if (isRecord(args) && typeof args.reasoning === "string" && args.reasoning.trim()) {
    return clipPlain(args.reasoning);
  }
  return inferredIntent(name, args);
}

function textFromResult(result) {
  const content = result?.content ?? result?.partialResult?.content;
  if (Array.isArray(content)) {
    const textParts = content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text);
    if (textParts.length > 0) return textParts.join("\n");
  }
  if (typeof result?.output === "string") return result.output;
  if (typeof result?.error === "string") return result.error;
  if (typeof result?.message === "string") return result.message;
  if (typeof result?.details?.error === "string") return result.details.error;
  return "";
}

function countNonEmptyLines(text) {
  return text.split("\n").filter((line) => line.trim()).length;
}

function plural(value, one, many = `${one}s`) {
  return `${value} ${value === 1 ? one : many}`;
}

function firstFinite(details, keys) {
  if (!isRecord(details)) return undefined;
  for (const key of keys) {
    const value = details[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function diffSummary(details) {
  const diff = isRecord(details) && typeof details.diff === "string" ? details.diff : "";
  if (!diff) return undefined;
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return `+${added}/-${removed}`;
}

function genericResultSummary(name, args, result, isError) {
  const text = textFromResult(result).trim();
  if (isError) return clipPlain(text.split("\n")[0] || "error");

  const details = result?.details;
  const diff = diffSummary(details);
  if (diff) return diff;

  const matches = firstFinite(details, ["totalMatched", "matches", "matchCount"]);
  const files = firstFinite(details, ["totalFiles", "files", "fileCount"]);
  if (matches !== undefined && files !== undefined) {
    return `${plural(matches, "match", "matches")} in ${plural(files, "file")}`;
  }
  if (matches !== undefined) return plural(matches, "match", "matches");

  const count = firstFinite(details, ["count", "total", "totalCount", "itemCount", "resultCount"]);
  if (count !== undefined) return plural(count, "result");

  if (/^no matches found/i.test(text) || /^no results/i.test(text) || /^no output/i.test(text)) return "no results";

  const lower = String(name).toLowerCase();
  const lineCount = countNonEmptyLines(text);
  if (/(read)/.test(lower) && text) return plural(text.split("\n").length, "line");
  if (/(find)/.test(lower) && text) return plural(lineCount, "file");
  if (/(grep|search)/.test(lower) && text) return plural(lineCount, "result");
  if (/(ls|list)/.test(lower) && text) return plural(lineCount, "entry", "entries");
  if (/(write|save|create)/.test(lower) && isRecord(args) && typeof args.content === "string") {
    const writtenLines = args.content.length === 0
      ? 0
      : (args.content.match(/\n/g)?.length ?? 0) + (args.content.endsWith("\n") ? 0 : 1);
    return plural(writtenLines, "line");
  }
  if (/(edit|patch|replace|update)/.test(lower)) return "applied";
  if (/(bash|shell|exec|run)/.test(lower)) {
    const exitCode = text.match(/exit code:\s*(\d+)/i)?.[1];
    return exitCode && exitCode !== "0" ? `exit ${exitCode}` : "done";
  }

  if (text) {
    const firstLine = clipPlain(text.split("\n")[0], 90);
    if (lineCount <= 1 && firstLine.length <= 72) return firstLine;
    return plural(lineCount, "line");
  }
  return "done";
}

export function formatElapsed(milliseconds) {
  const value = Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0);
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function expandedLines(args, result, theme, statusBar) {
  const lines = [];
  const details = result?.details;
  const diff = isRecord(details) && typeof details.diff === "string" ? details.diff.replace(/\s+$/, "") : "";
  if (diff) {
    for (const line of diff.split("\n")) {
      const color = line.startsWith("+") && !line.startsWith("+++")
        ? "toolDiffAdded"
        : line.startsWith("-") && !line.startsWith("---")
          ? "toolDiffRemoved"
          : "toolDiffContext";
      lines.push(`${statusBar}   ${fg(theme, color, line)}`);
    }
    return lines;
  }

  const text = textFromResult(result).replace(/\s+$/, "");
  if (text) {
    for (const line of text.split("\n")) lines.push(`${statusBar}   ${fg(theme, "toolOutput", line)}`);
    return lines;
  }

  if (isRecord(args) && typeof args.content === "string") {
    for (const line of args.content.split("\n")) lines.push(`${statusBar}   ${fg(theme, "toolOutput", line)}`);
  }
  return lines;
}

function fitToolLine(line, width, truncateToWidth, visibleWidth) {
  const max = Math.max(1, width);
  if (visibleWidth(line) <= max) return line;
  const arrowIndex = line.indexOf("→");
  if (arrowIndex < 0) return truncateToWidth(line, max, "…");
  const tail = line.slice(arrowIndex);
  const tailWidth = visibleWidth(tail);
  if (tailWidth >= max) return truncateToWidth(tail, max, "…");
  const head = line.slice(0, arrowIndex).trimEnd();
  return `${truncateToWidth(head, Math.max(1, max - tailWidth - 1), "…")} ${tail}`;
}

function fitLeftRightLine(left, right, width, truncateToWidth, visibleWidth) {
  const max = Math.max(1, width);
  if (!right) return fitToolLine(left, max, truncateToWidth, visibleWidth);
  const rightWidth = visibleWidth(right);
  if (rightWidth >= max) return truncateToWidth(right, max, "…");

  const leftBudget = max - rightWidth - 1;
  if (leftBudget <= 0) return `${" ".repeat(max - rightWidth)}${right}`;

  const fittedLeft = visibleWidth(left) <= leftBudget
    ? left
    : truncateToWidth(left, leftBudget, "…");
  const gap = Math.max(1, max - visibleWidth(fittedLeft) - rightWidth);
  return `${fittedLeft}${" ".repeat(gap)}${right}`;
}

function fitTrailingSegmentLine(left, right, width, truncateToWidth, visibleWidth) {
  const max = Math.max(1, width);
  if (!right) return fitToolLine(left, max, truncateToWidth, visibleWidth);
  const rightWidth = visibleWidth(right);
  if (rightWidth >= max) return truncateToWidth(right, max, "…");
  if (visibleWidth(left) + rightWidth + 1 <= max) return `${left} ${right}`;

  const leftBudget = max - rightWidth - 1;
  if (leftBudget <= 0) return `${" ".repeat(max - rightWidth)}${right}`;
  return `${truncateToWidth(left, leftBudget, "…")} ${right}`;
}

// Pi uses a plain Container for renderShell "self", so this component owns the full-row background.
class WidthAwareLines {
  constructor(source, background, truncateToWidth, visibleWidth) {
    this.source = source;
    this.background = background;
    this.truncateToWidth = truncateToWidth;
    this.visibleWidth = visibleWidth;
  }

  invalidate() {}

  render(width) {
    const max = Math.max(1, width);
    const horizontalPadding = max >= 3 ? HORIZONTAL_PADDING : 0;
    const contentWidth = Math.max(1, max - horizontalPadding * 2);
    const lines = typeof this.source === "function" ? this.source(contentWidth) : this.source;
    return lines.map((line) => {
      const fitted = fitToolLine(line, contentWidth, this.truncateToWidth, this.visibleWidth);
      const rightPadding = Math.max(
        horizontalPadding,
        max - horizontalPadding - this.visibleWidth(fitted),
      );
      const padded = `${" ".repeat(horizontalPadding)}${fitted}${" ".repeat(rightPadding)}`;
      return this.background(padded);
    });
  }
}

class EmptyComponent {
  invalidate() {}
  render() { return []; }
}

function clearTimer(state) {
  const timer = state?.[STATE_TIMER];
  if (timer) clearInterval(timer);
  if (state) state[STATE_TIMER] = undefined;
}

function ensureTimer(context) {
  if (!context?.state || context.state[STATE_TIMER]) return;
  const timer = setInterval(() => context.invalidate(), 1000);
  timer.unref?.();
  context.state[STATE_TIMER] = timer;
}

function getRunningElapsed(timings, toolCallId, context) {
  const tracked = timings.get(toolCallId);
  if (tracked) return Math.max(0, (tracked.endedAt ?? Date.now()) - tracked.startedAt);

  const stateStarted = context?.state?.[STATE_STARTED_AT];
  const startedAt = typeof stateStarted === "number" ? stateStarted : Date.now();
  if (context?.state && typeof stateStarted !== "number") context.state[STATE_STARTED_AT] = startedAt;
  return Math.max(0, Date.now() - startedAt);
}

function getCompletedElapsed(timings, toolCallId, context) {
  const stateElapsed = context?.state?.[STATE_ELAPSED_MS];
  if (typeof stateElapsed === "number" && Number.isFinite(stateElapsed) && stateElapsed >= 0) {
    return stateElapsed;
  }

  const tracked = timings.get(toolCallId);
  if (!tracked) return undefined;
  return Math.max(0, (tracked.endedAt ?? Date.now()) - tracked.startedAt);
}

export function getToolVisual(name) {
  const tokens = String(name ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (const token of tokens) {
    const matched = TOOL_VISUAL_RULES.find((rule) => rule.tokens.includes(token));
    if (matched) return Object.freeze({ category: matched.category, icon: matched.icon, color: matched.color });
  }
  return DEFAULT_TOOL_VISUAL;
}

function buildLines(name, args, result, options, theme, width, truncateToWidth, visibleWidth) {
  const isRunning = options.isRunning === true;
  const isError = options.isError === true;
  const statusColor = isRunning ? "warning" : isError ? "error" : "success";
  const statusBar = renderStatusBar(theme, statusColor);
  const visual = getToolVisual(name);
  const toolName = fg(theme, visual.color, bold(theme, name));
  const connector = fg(theme, visual.color, "╰");
  const headline = reasoningHeadline(name, args);
  const target = targetDetail(name, args);
  const summaryText = isRunning ? "running" : genericResultSummary(name, args, result, isError);
  const summary = fg(theme, isError ? "error" : "warning", summaryText);
  const elapsedText = Number.isFinite(options.elapsedMs)
    ? fg(theme, "warning", formatElapsed(options.elapsedMs))
    : "";
  const iconIndent = " ".repeat(Math.max(2, visibleWidth(visual.icon)));
  const firstLeft = `${statusBar} ${visual.icon} ${toolName}${headline ? ` ${fg(theme, "text", headline)}` : ""}`;
  const secondLeft = `${statusBar} ${iconIndent} ${connector}${target ? ` ${fg(theme, "dim", target)}` : ""}`;
  const secondRight = `${fg(theme, "dim", "→")} ${summary}`;
  const lines = [
    fitLeftRightLine(firstLeft, elapsedText, width, truncateToWidth, visibleWidth),
    fitTrailingSegmentLine(secondLeft, secondRight, width, truncateToWidth, visibleWidth),
  ];
  if (options.expanded && !isRunning) lines.push(...expandedLines(args, result, theme, statusBar));
  return lines;
}

function canInjectReasoning(parameters) {
  return isRecord(parameters)
    && parameters.type === "object"
    && isRecord(parameters.properties)
    && !Object.hasOwn(parameters.properties, "reasoning");
}

function injectReasoning(parameters) {
  return {
    ...parameters,
    properties: {
      reasoning: {
        type: "string",
        description: REASONING_DESCRIPTION,
      },
      ...parameters.properties,
    },
  };
}

function stripReasoning(params) {
  if (!isRecord(params) || !Object.hasOwn(params, "reasoning")) return params;
  const { reasoning: _reasoning, ...rest } = params;
  return rest;
}

function reattachReasoning(raw, prepared) {
  if (!isRecord(raw) || typeof raw.reasoning !== "string" || !isRecord(prepared)) return prepared;
  return { reasoning: raw.reasoning, ...prepared };
}

export function createUniversalTidy(options) {
  const { truncateToWidth, visibleWidth } = options;
  if (typeof truncateToWidth !== "function" || typeof visibleWidth !== "function") {
    throw new TypeError("pi-flow-tidy requires truncateToWidth and visibleWidth functions");
  }

  const timings = new Map();
  const decoratedNames = new Set();
  const historicalRenderers = new Map();
  let patchInstalled = false;
  let interactivePatchInstalled = false;
  let patchFailure = undefined;

  function scheduleTimingCleanup(toolCallId, timing) {
    const timer = setTimeout(() => {
      if (timings.get(toolCallId) === timing) timings.delete(toolCallId);
    }, CLEANUP_DELAY_MS);
    timer.unref?.();
  }

  function createTidyRenderers(toolName) {
    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        if (!context?.isPartial) return new EmptyComponent();
        ensureTimer(context);
        return new WidthAwareLines(
          (width) => buildLines(toolName, args ?? {}, {}, {
            isRunning: true,
            elapsedMs: getRunningElapsed(timings, context.toolCallId, context),
          }, theme, width, truncateToWidth, visibleWidth),
          (text) => paintBackground(theme, "toolPendingBg", text),
          truncateToWidth,
          visibleWidth,
        );
      },
      renderResult(result, renderOptions, theme, context) {
        if (renderOptions?.isPartial) return new EmptyComponent();
        clearTimer(context?.state);
        const elapsedMs = getCompletedElapsed(timings, context?.toolCallId, context);
        if (context?.state && elapsedMs !== undefined) context.state[STATE_ELAPSED_MS] = elapsedMs;
        if (context?.state) delete context.state[STATE_STARTED_AT];
        if (context?.toolCallId) timings.delete(context.toolCallId);
        const isError = context?.isError ?? result?.isError ?? false;
        return new WidthAwareLines(
          (width) => buildLines(toolName, context?.args ?? {}, result, {
            isError,
            expanded: renderOptions?.expanded === true,
            elapsedMs,
          }, theme, width, truncateToWidth, visibleWidth),
          (text) => paintBackground(theme, isError ? "toolErrorBg" : "toolSuccessBg", text),
          truncateToWidth,
          visibleWidth,
        );
      },
    };
  }

  function getHistoricalRenderer(toolName) {
    if (typeof toolName !== "string" || !toolName) return undefined;
    const cached = historicalRenderers.get(toolName);
    if (cached) return cached;
    const renderer = createTidyRenderers(toolName);
    historicalRenderers.set(toolName, renderer);
    decoratedNames.add(toolName);
    return renderer;
  }

  function decorateToolDefinition(source) {
    if (!source || typeof source !== "object" || source[DECORATED]) return source;
    if (typeof source.name !== "string" || typeof source.execute !== "function") return source;

    const inject = canInjectReasoning(source.parameters);
    const sourcePrepare = source.prepareArguments;
    const sourceExecute = source.execute;
    const guideline = `For ${source.name}, pass reasoning as a concise Chinese goal or intent, not a restatement of the target.`;
    const wrapped = {
      ...source,
      parameters: inject ? injectReasoning(source.parameters) : source.parameters,
      promptGuidelines: inject
        ? [...(Array.isArray(source.promptGuidelines) ? source.promptGuidelines : []), guideline]
        : source.promptGuidelines,
      prepareArguments: inject
        ? (rawArgs) => {
            const stripped = stripReasoning(rawArgs);
            const prepared = typeof sourcePrepare === "function"
              ? sourcePrepare.call(source, stripped)
              : stripped;
            return reattachReasoning(rawArgs, prepared);
          }
        : sourcePrepare,
      async execute(toolCallId, params, signal, onUpdate, context) {
        const timing = { startedAt: Date.now(), endedAt: undefined };
        timings.set(toolCallId, timing);
        try {
          const delegated = inject ? stripReasoning(params) : params;
          return await sourceExecute.call(source, toolCallId, delegated, signal, onUpdate, context);
        } finally {
          timing.endedAt = Date.now();
          scheduleTimingCleanup(toolCallId, timing);
        }
      },
      ...createTidyRenderers(source.name),
    };

    Object.defineProperty(wrapped, DECORATED, { value: true, enumerable: false });
    decoratedNames.add(source.name);
    return wrapped;
  }

  function decorateSessionDefinitions(session) {
    const base = session?._baseToolDefinitions;
    if (base instanceof Map) {
      for (const [name, definition] of base.entries()) base.set(name, decorateToolDefinition(definition));
    }

    const extensions = session?._extensionRunner?.extensions;
    if (Array.isArray(extensions)) {
      for (const extension of extensions) {
        if (!(extension?.tools instanceof Map)) continue;
        for (const registered of extension.tools.values()) {
          if (registered?.definition) registered.definition = decorateToolDefinition(registered.definition);
        }
      }
    }

    if (Array.isArray(session?._customTools)) {
      session._customTools = session._customTools.map((definition) => decorateToolDefinition(definition));
    }
  }

  function installAgentSessionPatch(AgentSession) {
    const prototype = AgentSession?.prototype;
    if (!prototype || prototype[PATCHED]) {
      patchInstalled = Boolean(prototype?.[PATCHED]);
      return patchInstalled;
    }
    const originalRefresh = prototype._refreshToolRegistry;
    if (typeof originalRefresh !== "function") {
      patchFailure = "AgentSession._refreshToolRegistry is unavailable";
      return false;
    }

    prototype._refreshToolRegistry = function flowTidyRefresh(options) {
      try {
        decorateSessionDefinitions(this);
      } catch (error) {
        patchFailure = error instanceof Error ? error.message : String(error);
      }
      return originalRefresh.call(this, options);
    };
    Object.defineProperty(prototype, PATCHED, { value: true, enumerable: false });
    patchInstalled = true;
    return true;
  }

  function installInteractiveModePatch(InteractiveMode) {
    const prototype = InteractiveMode?.prototype;
    if (!prototype || prototype[INTERACTIVE_PATCHED]) {
      interactivePatchInstalled = Boolean(prototype?.[INTERACTIVE_PATCHED]);
      return interactivePatchInstalled;
    }
    const originalGetDefinition = prototype.getRegisteredToolDefinition;
    if (typeof originalGetDefinition !== "function") {
      patchFailure = "InteractiveMode.getRegisteredToolDefinition is unavailable";
      return false;
    }

    prototype.getRegisteredToolDefinition = function flowTidyGetRegisteredToolDefinition(toolName) {
      return originalGetDefinition.call(this, toolName) ?? getHistoricalRenderer(toolName);
    };
    Object.defineProperty(prototype, INTERACTIVE_PATCHED, { value: true, enumerable: false });
    interactivePatchInstalled = true;
    return true;
  }

  function getStatus() {
    return {
      patchInstalled: patchInstalled && interactivePatchInstalled,
      agentSessionPatchInstalled: patchInstalled,
      interactiveModePatchInstalled: interactivePatchInstalled,
      patchFailure,
      decoratedNames: [...decoratedNames].sort(),
      decoratedCount: decoratedNames.size,
    };
  }

  return {
    decorateToolDefinition,
    installAgentSessionPatch,
    installInteractiveModePatch,
    getStatus,
  };
}
