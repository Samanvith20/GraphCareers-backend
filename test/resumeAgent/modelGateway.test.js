import test from "node:test";
import assert from "node:assert/strict";
import { isRetryableModelError, modelProviderErrorDetails } from "../../src/modules/resumeAgent/resumeAgent.modelGateway.js";

test("model provider errors retry only transient failures", () => {
  assert.equal(isRetryableModelError({ statusCode: 401 }), false);
  assert.equal(isRetryableModelError({ statusCode: 400, isRetryable: false }), false);
  assert.equal(isRetryableModelError({ statusCode: 429 }), true);
  assert.equal(isRetryableModelError({ statusCode: 503 }), true);
  assert.equal(isRetryableModelError({ name: "AbortError" }), true);
});

test("model provider logs expose diagnostics without credentials", () => {
  const details = modelProviderErrorDetails({
    name: "AI_APICallError",
    message: "Provider rejected request",
    statusCode: 402,
    isRetryable: false,
    data: { error: { code: "insufficient_credits" } },
  }, { provider: "openrouter", model: "example/model" });

  assert.deepEqual(details, {
    error: "Provider rejected request",
    errorName: "AI_APICallError",
    provider: "openrouter",
    model: "example/model",
    statusCode: 402,
    providerCode: "insufficient_credits",
    retryable: false,
  });
});
