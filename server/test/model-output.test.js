import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelOutputParseError, parseModelOutput } from "../src/model-output.js";

const FENCE = String.fromCharCode(96).repeat(3);

function assertInvalid(content) {
  assert.throws(
    () => parseModelOutput(content),
    error => {
      assert.ok(error instanceof ModelOutputParseError);
      assert.equal(error.code, "INVALID_MODEL_OUTPUT");
      assert.equal(error.message, "The model returned invalid JSON.");
      return true;
    }
  );
}

test("parses a valid JSON object and returns its value", () => {
  assert.deepEqual(parseModelOutput('{"summary":"ok","count":2}'), {
    summary: "ok",
    count: 2
  });
});

test("allows leading and trailing whitespace around plain JSON", () => {
  assert.deepEqual(parseModelOutput(' \n\t {"enabled":true} \r\n '), { enabled: true });
});

test("parses a complete JSON document inside a json fence", () => {
  const input = " \n" + FENCE + "json\n{\n  \"summary\": \"ok\"\n}\n" + FENCE + "\n ";
  assert.deepEqual(parseModelOutput(input), { summary: "ok" });
});

test("parses a complete JSON document inside an unlabeled fence", () => {
  const input = FENCE + "\n[1, true, null, \"x\"]\n" + FENCE;
  assert.deepEqual(parseModelOutput(input), [1, true, null, "x"]);
});

test("accepts an unlabeled fence with trailing horizontal whitespace on the opening line", () => {
  const input = FENCE + "   \\n" + '{"ok":true}' + "\\n" + FENCE;
  assert.deepEqual(parseModelOutput(input), { ok: true });
});

test("accepts whitespace around fence lines and CRLF newlines", () => {
  const input = "  \r\n" + FENCE + "json   \r\n {\"ok\": true} \r\n  " + FENCE + "  \r\n";
  assert.deepEqual(parseModelOutput(input), { ok: true });
});

test("accepts valid JSON scalar and array values without assuming a plan object", () => {
  assert.equal(parseModelOutput("42"), 42);
  assert.equal(parseModelOutput('"text"'), "text");
  assert.equal(parseModelOutput("false"), false);
  assert.equal(parseModelOutput("null"), null);
  assert.deepEqual(parseModelOutput('[{"a":1}]'), [{ a: 1 }]);
});

const rejectedInputs = [
  ["valid JSON followed by prose", '{"ok":true} and more text'],
  ["prose followed by JSON", 'Here is the result: {"ok":true}'],
  ["malformed JSON", '{"ok":,}'],
  ["truncated JSON", '{"summary":"unfinished"'],
  ["empty string", ""],
  ["whitespace only", " \n \t "],
  ["null input type", null],
  ["undefined input type", undefined],
  ["numeric input type", 42],
  ["object input type", { ok: true }],
  ["unclosed fence", FENCE + 'json\n{"ok":true}'],
  ["fence without an opening newline", FENCE + '{"ok":true}\n' + FENCE],
  ["extra text after closing fence", FENCE + 'json\n{"ok":true}\n' + FENCE + '\ntrailing prose'],
  ["multiple JSON fences", FENCE + 'json\n{"a":1}\n' + FENCE + '\n' + FENCE + 'json\n{"b":2}\n' + FENCE],
  ["unsupported JavaScript label", FENCE + 'javascript\n{"ok":true}\n' + FENCE],
  ["unsupported YAML label", FENCE + 'yaml\nok: true\n' + FENCE],
  ["uppercase unsupported language label", FENCE + 'JSON\n{"ok":true}\n' + FENCE],
  ["JSON fence followed by another JSON fragment", FENCE + 'json\n{"a":1}\n' + FENCE + '\n{"b":2}'],
  ["text before fenced JSON", "Result:\n" + FENCE + 'json\n{"ok":true}\n' + FENCE],
  ["fenced malformed JSON", FENCE + 'json\n{"ok":,}\n' + FENCE],
  ["empty fenced document", FENCE + "json\n   \n" + FENCE],
  ["extra fence delimiter inside fenced body", FENCE + 'json\n' + FENCE + 'json\n{"a":1}\n' + FENCE + '\n' + FENCE],
  ["JSON with a trailing comma", '{"values":[1,2,], "ok":true}'],
  ["JSON value followed by a second JSON value", '{"a":1} {"b":2}']
];

for (const [label, input] of rejectedInputs) {
  test("rejects " + label + " as INVALID_MODEL_OUTPUT", () => {
    assertInvalid(input);
  });
}
