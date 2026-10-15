/* Guaranteed structured JSON from Claude (Anthropic only).
 *
 * Prefer Anthropic structured outputs (output_format / output_config.format
 * with type json_schema) when the model supports it. Otherwise force a tool
 * call (tools + tool_choice { type: "tool", name }) and read tool_use.input.
 *
 * Validate the payload; on failure retry once; then a friendly error.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.tinkerClaudeStructured = api;
  } else if (root) {
    root.tinkerClaudeStructured = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FRIENDLY_ERROR =
    "Claude's reply came back in a shape we couldn't use. Try again.";

  // Models known to support JSON schema structured outputs on the Messages API.
  // claude-opus-5-5 is the exercise evaluate/refactor pin and appears in
  // Anthropic's structured-outputs examples.
  const JSON_SCHEMA_MODEL_PREFIXES = [
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-sonnet-5",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    "claude-fable-5",
    "claude-mythos-5",
  ];

  const EVALUATE_SCHEMA = {
    type: "object",
    properties: {
      feedback: { type: "string" },
      summary: { type: "string" },
      nextStepPath: { type: "string" },
      nextStepContent: { type: "string" },
      aggressiveness: {
        type: "object",
        properties: {
          struggle: { type: "string", enum: ["hard", "ok", "easy"] },
          action: { type: "string", enum: ["finer", "keep", "skip_ahead"] },
        },
        required: ["struggle", "action"],
        additionalProperties: false,
      },
    },
    required: [
      "feedback",
      "summary",
      "nextStepPath",
      "nextStepContent",
      "aggressiveness",
    ],
    additionalProperties: false,
  };

  const REFACTOR_SCHEMA = {
    type: "object",
    properties: {
      replacement: { type: "string" },
      summary: { type: "string" },
    },
    required: ["replacement", "summary"],
    additionalProperties: false,
  };

  const REVISE_SCHEMA = {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: { type: "string" },
      },
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
          additionalProperties: false,
        },
      },
    },
    required: ["steps", "files"],
    additionalProperties: false,
  };

  function supportsJsonSchemaOutput(model) {
    const id = String(model || "")
      .trim()
      .toLowerCase();
    if (!id) return false;
    for (let i = 0; i < JSON_SCHEMA_MODEL_PREFIXES.length; i += 1) {
      const prefix = JSON_SCHEMA_MODEL_PREFIXES[i];
      if (id === prefix || id.indexOf(prefix + "-") === 0 || id.indexOf(prefix) === 0) {
        return true;
      }
    }
    return false;
  }

  function cloneSchema(schema) {
    return JSON.parse(JSON.stringify(schema));
  }

  /** Build Anthropic request extras for guaranteed structured JSON. */
  function buildStructuredRequest(opts) {
    const options = opts || {};
    const model = options.model;
    const schema = options.schema;
    const toolName = String(options.toolName || "submit_structured_json").trim();
    if (!schema || typeof schema !== "object") {
      throw new Error("schema is required");
    }
    if (supportsJsonSchemaOutput(model)) {
      // GA field is output_config.format. Keep output_format on the helper
      // result so callers/tests can assert the json_schema shape the user asked for.
      // Opus 5.5 always thinks; effort "low" leaves room in max_tokens for the
      // JSON body (That's everything rewrites a full next-step README).
      const format = {
        type: "json_schema",
        schema: cloneSchema(schema),
      };
      const effort =
        options.effort != null && String(options.effort).trim()
          ? String(options.effort).trim()
          : "low";
      return {
        mechanism: "json_schema",
        output_format: format,
        output_config: { format: format, effort: effort },
        tools: null,
        tool_choice: null,
      };
    }
    // Note: Claude Opus 5.5 rejects tool_choice type "tool"/"any". Those
    // models must stay on the json_schema path above.
    return {
      mechanism: "tool",
      output_format: null,
      output_config: null,
      tools: [
        {
          name: toolName,
          description:
            options.toolDescription ||
            "Return the result as structured JSON matching the input schema.",
          input_schema: cloneSchema(schema),
        },
      ],
      tool_choice: { type: "tool", name: toolName },
    };
  }

  function parseJsonText(text) {
    const raw = String(text || "").trim();
    if (!raw) {
      throw Object.assign(new Error("Empty model reply."), { status: 502 });
    }
    let candidate = raw;
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) candidate = fenced[1].trim();
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw Object.assign(new Error("Model reply was not JSON."), { status: 502 });
    }
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      throw Object.assign(new Error("Model reply was not valid JSON."), {
        status: 502,
      });
    }
  }

  /** Prefer tool_use.input, then structured, then parse text. */
  function extractStructuredPayload(result) {
    if (!result || typeof result !== "object") {
      throw Object.assign(new Error("Empty model reply."), { status: 502 });
    }
    if (result.toolUse && result.toolUse.input && typeof result.toolUse.input === "object") {
      return result.toolUse.input;
    }
    if (result.structured && typeof result.structured === "object") {
      return result.structured;
    }
    if (Array.isArray(result.content)) {
      for (let i = 0; i < result.content.length; i += 1) {
        const block = result.content[i];
        if (block && block.type === "tool_use" && block.input && typeof block.input === "object") {
          return block.input;
        }
      }
    }
    return parseJsonText(result.text);
  }

  function isRetryableStructuredError(err) {
    if (!err) return true;
    if (err.status === 401 || err.status === 403) return false;
    if (err.code === "SESSION_EXPIRED" || err.code === "MISSING_TOKEN") return false;
    if (err.code === "TIMEOUT") return false;
    // Truncation: retrying the same max_tokens will not help.
    if (err.code === "MAX_TOKENS") return false;
    // Client validation before the model call (empty answer, etc.).
    if (err.status === 400) return false;
    return true;
  }

  function assertCompleteStructuredResult(result) {
    if (!result || typeof result !== "object") return;
    const reason = String(result.stop_reason || "");
    if (reason === "max_tokens") {
      throw Object.assign(
        new Error(
          "Claude's reply was cut off before the JSON finished. Try again."
        ),
        { status: 502, code: "MAX_TOKENS" }
      );
    }
    if (reason === "refusal") {
      throw Object.assign(
        new Error("Claude declined to answer that request."),
        { status: 502, code: "REFUSAL" }
      );
    }
  }

  function toClaudeCallArgs(base, structuredReq) {
    const args = Object.assign({}, base || {});
    if (structuredReq.mechanism === "json_schema") {
      // Send both spellings: converse/anthropic prefer output_config; tests
      // and the bug brief look for output_format + json_schema.
      args.output_format = structuredReq.output_format;
      args.output_config = structuredReq.output_config;
    } else if (structuredReq.mechanism === "tool") {
      args.tools = structuredReq.tools;
      args.tool_choice = structuredReq.tool_choice;
    }
    return args;
  }

  /**
   * Call Claude with guaranteed structured output, validate, retry once.
   *
   * @param {object} opts
   * @param {function} opts.callFn  async (payload) => { text, toolUse?, structured? }
   * @param {object} opts.schema
   * @param {string} opts.toolName
   * @param {function} opts.validate  (payload) => value  (throws on bad shape)
   * @param {string} [opts.friendlyError]
   */
  async function runStructuredJsonCall(opts) {
    const options = opts || {};
    const callFn = options.callFn;
    if (typeof callFn !== "function") {
      throw new Error("callFn is required");
    }
    if (typeof options.validate !== "function") {
      throw new Error("validate is required");
    }
    const structuredReq = buildStructuredRequest({
      model: options.model,
      schema: options.schema,
      toolName: options.toolName,
      toolDescription: options.toolDescription,
      effort: options.effort,
    });
    const base = {
      system: options.system,
      messages: options.messages,
      model: options.model,
      maxTokens: options.maxTokens,
    };
    const friendly = options.friendlyError || FRIENDLY_ERROR;
    let lastErr = null;
    const attempts = options.attempts != null ? Number(options.attempts) : 2;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const result = await callFn(toClaudeCallArgs(base, structuredReq));
        assertCompleteStructuredResult(result);
        const payload = extractStructuredPayload(result);
        const value = options.validate(payload);
        return {
          value: value,
          mechanism: structuredReq.mechanism,
          usage: result && result.usage ? result.usage : null,
          stop_reason: result && result.stop_reason ? result.stop_reason : null,
          attempt: i + 1,
        };
      } catch (err) {
        lastErr = err;
        if (!isRetryableStructuredError(err) || i + 1 >= attempts) {
          if (!isRetryableStructuredError(err)) throw err;
          break;
        }
      }
    }
    throw Object.assign(new Error(friendly), {
      status: 502,
      code: "STRUCTURED_JSON_FAILED",
      cause: lastErr,
      mechanism: structuredReq.mechanism,
    });
  }

  return {
    FRIENDLY_ERROR: FRIENDLY_ERROR,
    EVALUATE_SCHEMA: EVALUATE_SCHEMA,
    REFACTOR_SCHEMA: REFACTOR_SCHEMA,
    REVISE_SCHEMA: REVISE_SCHEMA,
    JSON_SCHEMA_MODEL_PREFIXES: JSON_SCHEMA_MODEL_PREFIXES,
    supportsJsonSchemaOutput: supportsJsonSchemaOutput,
    buildStructuredRequest: buildStructuredRequest,
    parseJsonText: parseJsonText,
    extractStructuredPayload: extractStructuredPayload,
    isRetryableStructuredError: isRetryableStructuredError,
    assertCompleteStructuredResult: assertCompleteStructuredResult,
    toClaudeCallArgs: toClaudeCallArgs,
    runStructuredJsonCall: runStructuredJsonCall,
  };
});
