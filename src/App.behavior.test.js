import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const styleSource = await readFile(new URL("./styles.css", import.meta.url), "utf8");

test("local demo handler aborts and invalidates requests without invoking planning API", () => {
  const demoHandler = appSource.match(/function enterDemoMode\(\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(demoHandler, "enterDemoMode handler exists");
  assert.match(demoHandler, /abortController\.current\?\.abort\(\)/);
  assert.match(demoHandler, /planRequestId\.current \+= 1/);
  assert.match(demoHandler, /setGeneratedPlan\(DEMO_PLAN\)/);
  assert.doesNotMatch(demoHandler, /requestPlan\(|fetch\s*\(/);

  const compileHandler = appSource.match(/async function compileWorkflow\(\) \{([\s\S]*?)\n  \}\n\n  async function checkApi/)?.[1];
  assert.ok(compileHandler, "compileWorkflow handler exists");
  const demoGuard = compileHandler.indexOf("if (demoMode)");
  const planningCall = compileHandler.indexOf("await requestPlan(");
  assert.ok(demoGuard >= 0 && planningCall > demoGuard, "demo guard appears before requestPlan");
  assert.match(compileHandler.slice(demoGuard, planningCall), /return;/);
});

test("switching back to API mode invalidates requests and stale results are guarded", () => {
  const handler = appSource.match(/function exitDemoMode\(\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(handler);
  assert.match(handler, /abortController\.current\?\.abort\(\)/);
  assert.match(handler, /planRequestId\.current \+= 1/);
  assert.match(appSource, /isCurrentPlanRequest\(requestId, planRequestId\.current, mounted\.current, controller\.signal\)/);
});

test("input, time slider, presets, status feedback, and reduced-motion affordances remain wired", () => {
  assert.match(appSource, /maxLength=\{5000\}/);
  assert.match(appSource, /aria-invalid=\{Boolean\(inputError\)\}/);
  assert.match(appSource, /role="alert">\{inputError\}/);
  assert.match(appSource, /type="range" min="5" max="720" step="1"/);
  assert.match(appSource, /TIME_PRESETS\.map/);
  assert.match(appSource, /aria-live="polite"/);
  assert.match(styleSource, /prefers-reduced-motion:reduce/);
});

test("new requests clear prior plan state and error paths do not retain stale plan output", () => {
  const compileHandler = appSource.match(/async function compileWorkflow\(\) \{([\s\S]*?)\n  \}\n\n  async function checkApi/)?.[1];
  assert.ok(compileHandler);
  assert.match(compileHandler, /setPlanState\("loading"\)/);
  assert.match(compileHandler, /setGeneratedPlan\(null\)/);
  assert.match(compileHandler, /setPlanKind\(null\)/);
  assert.match(compileHandler, /setPlanState\("error"\)/);
  assert.match(compileHandler, /setPlanMessage\(error instanceof Error \? error\.message/);
  assert.doesNotMatch(appSource, /localStorage|sessionStorage|console\.log/);
});
