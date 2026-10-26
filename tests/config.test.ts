import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModelConfig } from "../src/config.js";

test("model and API key must be configured explicitly", () => {
  assert.throws(() => loadModelConfig({}), /OPENAI_API_KEY.*OPENAI_MODEL/);
  assert.throws(
    () => loadModelConfig({ OPENAI_API_KEY: "key" }),
    /OPENAI_MODEL/,
  );
});

test("normalizes credentials and accepts an optional compatible API endpoint", () => {
  assert.deepEqual(
    loadModelConfig({
      OPENAI_API_KEY: " test-key ",
      OPENAI_MODEL: " test-model ",
      OPENAI_BASE_URL: " https://example.com/v1 ",
    }),
    {
      apiKey: "test-key",
      model: "test-model",
      baseURL: "https://example.com/v1",
    },
  );
  assert.equal(
    loadModelConfig({ OPENAI_API_KEY: "key", OPENAI_MODEL: "model" }).baseURL,
    undefined,
  );
});

test("invalid endpoint errors do not expose its value or credentials", () => {
  assert.throws(
    () =>
      loadModelConfig({
        OPENAI_API_KEY: "secret",
        OPENAI_MODEL: "model",
        OPENAI_BASE_URL: "file:///secret",
      }),
    (error: Error) =>
      error.message.includes("OPENAI_BASE_URL") &&
      !error.message.includes("secret"),
  );
});
