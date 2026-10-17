const FENCE = String.fromCharCode(96).repeat(3);
const INVALID_OUTPUT_MESSAGE = "The model returned invalid JSON.";

export class ModelOutputParseError extends Error {
  constructor() {
    super(INVALID_OUTPUT_MESSAGE);
    this.name = "ModelOutputParseError";
    this.code = "INVALID_MODEL_OUTPUT";
  }
}

function invalidOutput() {
  return new ModelOutputParseError();
}

function parseCompleteJson(document) {
  try {
    return JSON.parse(document);
  } catch {
    throw invalidOutput();
  }
}

/**
 * Parse one complete model-output JSON value.
 *
 * Accepted input is plain JSON, or a single complete Markdown code fence with
 * no language label or the exact json label. Fenced input must have a proper
 * opening line and closing-fence line. Nothing outside the JSON document or
 * fence is extracted or ignored.
 *
 * This parser deliberately checks JSON syntax only. Plan/task semantics belong
 * to the later generated-output validation task.
 */
export function parseModelOutput(content) {
  if (typeof content !== "string") {
    throw invalidOutput();
  }

  const trimmed = content.trim();
  if (!trimmed) {
    throw invalidOutput();
  }

  if (!trimmed.startsWith(FENCE)) {
    return parseCompleteJson(trimmed);
  }

  const openingLineEnd = trimmed.indexOf("\n");
  if (openingLineEnd < 0) {
    throw invalidOutput();
  }

  const openingLine = trimmed.slice(0, openingLineEnd).replace(/\r$/, "");
  const label = openingLine.slice(FENCE.length);
  if (label !== "" && !/^json[ \t]*$/.test(label)) {
    throw invalidOutput();
  }

  const closingLineStart = trimmed.lastIndexOf("\n") + 1;
  if (closingLineStart <= openingLineEnd + 1) {
    throw invalidOutput();
  }

  const closingLine = trimmed.slice(closingLineStart);
  if (!closingLine.startsWith(FENCE)
      || !/^[ \t]*$/.test(closingLine.slice(FENCE.length))) {
    throw invalidOutput();
  }

  const bodyEnd = closingLineStart - 1;
  const document = trimmed.slice(openingLineEnd + 1, bodyEnd).trim();
  if (!document) {
    throw invalidOutput();
  }

  return parseCompleteJson(document);
}
