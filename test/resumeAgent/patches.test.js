import test from "node:test";
import assert from "node:assert/strict";
import { applyResumePatches, readPointer } from "../../src/modules/resumeAgent/domain/patches.js";

test("patches create an immutable resume version", () => {
  const original = { summary: "Old", skills: { technical: ["Java"] }, experience: [] };
  const result = applyResumePatches(original, [
    { op: "replace", path: "/summary", value: "New summary" },
    { op: "add", path: "/skills/technical/-", value: "AWS" },
  ]);
  assert.equal(original.summary, "Old");
  assert.deepEqual(original.skills.technical, ["Java"]);
  assert.equal(result.resume.summary, "New summary");
  assert.deepEqual(result.resume.skills.technical, ["Java", "AWS"]);
  assert.equal(readPointer(result.resume, "/skills/technical/1"), "AWS");
});

test("patches reject prototype-pollution paths", () => {
  assert.throws(
    () => applyResumePatches({ skills: {} }, [{ op: "add", path: "/skills/__proto__/polluted", value: true }]),
    /Unsafe patch path/,
  );
  assert.equal({}.polluted, undefined);
});

