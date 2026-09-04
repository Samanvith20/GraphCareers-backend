import test from "node:test";
import assert from "node:assert/strict";
import { canCreateResumeVersion } from "../../src/modules/resumeAgent/domain/versionPolicy.js";

test("evidence-safe edits can create a version when the transparent score is unchanged", () => {
  assert.equal(canCreateResumeVersion({
    changeCount: 3,
    scoreBefore: { overall: 72 },
    scoreAfter: { overall: 72 },
  }), true);
});

test("a version is not created without changes or when the score degrades", () => {
  assert.equal(canCreateResumeVersion({
    changeCount: 0,
    scoreBefore: { overall: 72 },
    scoreAfter: { overall: 72 },
  }), false);
  assert.equal(canCreateResumeVersion({
    changeCount: 1,
    scoreBefore: { overall: 72 },
    scoreAfter: { overall: 71 },
  }), false);
});
