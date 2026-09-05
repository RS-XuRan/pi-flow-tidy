const DECORATED = Symbol.for("pi.flowTidy.decorated");
const PATCHED = Symbol.for("pi.flowTidy.agentSessionPatched");
const STATE_STARTED_AT = "universalTidyStartedAt";
const STATE_TIMER = "universalTidyTimer";
const REASONING_DESCRIPTION =
  "Short phrase (12 words or fewer) stating the goal or intent. Do not restate the target, path, command, or query.";
const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|authorization|credential|cookie)/i;
const OMIT_KEY = /^(reasoning|content|data|body|payload|patch|oldText|newText|edits|tool_uses)$/i;
const MAX_INLINE_VALUE = 140;
const CLEANUP_DELAY_MS = 5 * 60 * 1000;

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

function bg(theme, color, text) {
  return safeThemeCall(theme, "bg", color, text);
}

function bold(theme, text) {
  return safeThemeCall(theme, "bold", text);
}

function renderValue(value) {
  if (typeof value === "string") return clipPlain(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const simple = value.filter((item) => ["string", "number", "boolean"].includes(typeof item)).slice(0, 3);
    if (simple.length > 0) return clipPlain(simple.join(", "));
    return `${value.length} items`;
  }
  if (isRecord(value)) return "object";
  return "";
}

function firstDefined(args, keys) {
  for (const key of keys) {
    if (!Object.hasOwn(args, key)) continue;
    const rendered = renderValue(args[key]);
    if (rendered) return { key, value: rendered };
  }
  return undefined;
}

function targetDetail(name, args) {
  if (!isRecord(args)) return "";

  const command = firstDefined(args, ["command", "cmd", "script"]);
  if (command) return command.value;

  const pattern = firstDefined(args, ["pattern", "query", "search", "needle"]);
  const path = firstDefined(args, ["path", "file", "filename", "directory", "cwd", "root"]);
  if (pattern && path) return `${pattern.value} in ${path.value}`;
  if (pattern) return pattern.value;
  if (path) return path.value;

  const url = firstDefined(args, ["url", "uri", "endpoint"]);
  if (url) return url.value;

  const action = firstDefined(args, ["action", "operation", "method", "fn"]);
  const subject = firstDefined(args, ["name", "id", "ticker", "location", "team", "package", "model"]);
  if (action && subject) return `${action.value} ${subject.value}`;
  if (subject) return subject.value;
  if (action) return action.value;

  const pairs = [];
  for (const [key, value] of Object.entries(args)) {
    if (OMIT_KEY.test(key) || SECRET_KEY.test(key)) continue;
    const rendered = renderValue(value);
    if (!rendered) continue;
    pairs.push(`${key}=${rendered}`);
    if (pairs.length >= 2) break;
  }
  return clipPlain(pairs.join(" "));
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

function expandedLines(args, result, theme) {
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
      lines.push(`  ${fg(theme, color, line)}`);
    }
    return lines;
  }

  const text = textFromResult(result).replace(/\s+$/, "");
  if (text) {
    for (const line of text.split("\n")) lines.push(`  ${fg(theme, "toolOutput", line)}`);
    return lines;
  }

  if (isRecord(args) && typeof args.content === "string") {
    for (const line of args.content.split("\n")) lines.push(`  ${fg(theme, "toolOutput", line)}`);
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
    const lines = typeof this.source === "function" ? this.source() : this.source;
    return lines.map((line) => {
      const fitted = fitToolLine(line, max, this.truncateToWidth, this.visibleWidth);
      if (!this.background) return fitted;
      const padded = fitted + " ".repeat(Math.max(0, max - this.visibleWidth(fitted)));
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

function getTiming(timings, toolCallId, context) {
  const tracked = timings.get(toolCallId);
  const stateStarted = context?.state?.[STATE_STARTED_AT];
  const startedAt = tracked?.startedAt ?? (typeof stateStarted === "number" ? stateStarted : Date.now());
  if (context?.state && typeof stateStarted !== "number") context.state[STATE_STARTED_AT] = startedAt;
  const endedAt = tracked?.endedAt ?? Date.now();
  return { startedAt, endedAt, elapsedMs: Math.max(0, endedAt - startedAt) };
}

function buildLines(name, args, result, options, theme) {
  const isRunning = options.isRunning === true;
  const isError = options.isError === true;
  const elapsed = formatElapsed(options.elapsedMs ?? 0);
  const mark = isRunning
    ? fg(theme, "dim", "·")
    : isError
      ? fg(theme, "error", "✗")
      : fg(theme, "success", "✓");
  const toolName = fg(theme, "toolTitle", bold(theme, name));
  const headline = reasoningHeadline(name, args);
  const target = targetDetail(name, args);
  const summaryText = isRunning ? "running" : genericResultSummary(name, args, result, isError);
  const summary = fg(theme, isError ? "error" : isRunning ? "dim" : "success", summaryText);
  const elapsedText = fg(theme, "dim", `· ${elapsed}`);
  const detail = target ? `${fg(theme, "dim", target)} ${fg(theme, "dim", "→")} ` : `${fg(theme, "dim", "→")} `;
  const lines = [
    `${mark} ${toolName}${headline ? ` ${fg(theme, "text", headline)}` : ""}`,
    `  ${detail}${summary} ${elapsedText}`,
  ];
  if (options.expanded && !isRunning) lines.push(...expandedLines(args, result, theme));
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
  let patchInstalled = false;
  let patchFailure = undefined;

  function scheduleTimingCleanup(toolCallId, timing) {
    const timer = setTimeout(() => {
      if (timings.get(toolCallId) === timing) timings.delete(toolCallId);
    }, CLEANUP_DELAY_MS);
    timer.unref?.();
  }

  function decorateToolDefinition(source) {
    if (!source || typeof source !== "object" || source[DECORATED]) return source;
    if (typeof source.name !== "string" || typeof source.execute !== "function") return source;

    const inject = canInjectReasoning(source.parameters);
    const sourcePrepare = source.prepareArguments;
    const sourceExecute = source.execute;
    const guideline = `For ${source.name}, pass reasoning as a concise goal or intent, not a restatement of the target.`;
    const wrapped = {
      ...source,
      parameters: inject ? injectReasoning(source.parameters) : source.parameters,
      promptGuidelines: inject
        ? [...(Array.isArray(source.promptGuidelines) ? source.promptGuidelines : []), guideline]
        : source.promptGuidelines,
      renderShell: "self",
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
      renderCall(args, theme, context) {
        if (!context?.isPartial) return new EmptyComponent();
        ensureTimer(context);
        const timing = getTiming(timings, context.toolCallId, context);
        return new WidthAwareLines(
          () => buildLines(source.name, args ?? {}, {}, {
            isRunning: true,
            elapsedMs: getTiming(timings, context.toolCallId, context).elapsedMs,
          }, theme),
          (text) => bg(theme, "toolPendingBg", text),
          truncateToWidth,
          visibleWidth,
        );
      },
      renderResult(result, renderOptions, theme, context) {
        if (renderOptions?.isPartial) return new EmptyComponent();
        clearTimer(context?.state);
        const timing = getTiming(timings, context?.toolCallId, context);
        if (context?.toolCallId) timings.delete(context.toolCallId);
        const isError = context?.isError ?? result?.isError ?? false;
        const lines = buildLines(source.name, context?.args ?? {}, result, {
          isError,
          expanded: renderOptions?.expanded === true,
          elapsedMs: timing.elapsedMs,
        }, theme);
        return new WidthAwareLines(
          lines,
          (text) => bg(theme, isError ? "toolErrorBg" : "toolSuccessBg", text),
          truncateToWidth,
          visibleWidth,
        );
      },
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

  function getStatus() {
    return {
      patchInstalled,
      patchFailure,
      decoratedNames: [...decoratedNames].sort(),
      decoratedCount: decoratedNames.size,
    };
  }

  return {
    decorateToolDefinition,
    installAgentSessionPatch,
    getStatus,
  };
}
