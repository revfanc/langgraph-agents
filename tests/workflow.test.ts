import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { CodingAgent } from "../src/domain.js";
import { executeRun } from "../src/runner.js";
import { Store } from "../src/storage.js";
import { fixture } from "./helpers.js";

test("failed real checks feed a bounded repair loop and preserve the source repo", async () => {
  const f = await fixture();
  let calls = 0;
  const agent: CodingAgent = {
    code: async ({ run, prompt }) => {
      calls++;
      if (calls === 2) assert.match(prompt, /expected 42/);
      writeFileSync(
        join(run.worktree, "answer.txt"),
        calls === 1 ? "41\n" : "42\n",
      );
      return { outcome: "completed", summary: "updated answer" };
    },
    review: async ({ prompt }) => {
      assert.match(prompt, /42/);
      assert.match(prompt, /passed/);
      return { approved: true, summary: "verified diff", issues: [] };
    },
  };
  try {
    const result = await executeRun(f.store, f.run.id, agent);
    assert.equal(result.status, "succeeded");
    assert.equal(calls, 2);
    assert.equal(readFileSync(join(f.repo, "answer.txt"), "utf8"), "wrong\n");
    assert.match(
      readFileSync(join(f.store.dir(f.run.id), "changes.patch"), "utf8"),
      /42/,
    );
    await executeRun(f.store, f.run.id, agent);
    assert.equal(calls, 2);
  } finally {
    f.cleanup();
  }
});

test("reopening SQLite resumes after the code checkpoint without another code call", async () => {
  const f = await fixture();
  let calls = 0;
  const agent: CodingAgent = {
    code: async ({ run }) => {
      calls++;
      writeFileSync(join(run.worktree, "answer.txt"), "42\n");
      return { outcome: "completed", summary: "fixed" };
    },
    review: async () => ({ approved: true, summary: "ok", issues: [] }),
  };
  try {
    const paused = await executeRun(f.store, f.run.id, agent, {
      pauseAfter: "code",
    });
    assert.equal(paused.status, "paused");
    assert.equal(calls, 1);
    const reopened = new Store(f.store.root);
    try {
      assert.equal(
        (await executeRun(reopened, f.run.id, agent)).status,
        "succeeded",
      );
    } finally {
      reopened.close();
    }
    assert.equal(calls, 1);
  } finally {
    f.cleanup();
  }
});

test("exhausting repairs never reaches reviewer or reports success", async () => {
  const f = await fixture();
  let reviewed = false;
  f.store.updateRun(f.run.id, { maxAttempts: 1 });
  try {
    const result = await executeRun(f.store, f.run.id, {
      code: async () => ({ outcome: "completed", summary: "no fix" }),
      review: async () => {
        reviewed = true;
        return { approved: true, summary: "incorrect", issues: [] };
      },
    });
    assert.equal(result.status, "failed");
    assert.equal(reviewed, false);
  } finally {
    f.cleanup();
  }
});

test("review cannot mutate the validated workspace", async () => {
  const f = await fixture();
  try {
    const result = await executeRun(f.store, f.run.id, {
      code: async ({ run }) => {
        writeFileSync(join(run.worktree, "answer.txt"), "42\n");
        return { outcome: "completed", summary: "fixed" };
      },
      review: async ({ run }) => {
        writeFileSync(join(run.worktree, "answer.txt"), "43\n");
        return { approved: true, summary: "bad", issues: [] };
      },
    });
    assert.equal(result.status, "blocked");
    assert.match(result.error, /审核.*修改/);
  } finally {
    f.cleanup();
  }
});

test("review findings trigger repair even when checks already pass", async () => {
  const f = await fixture();
  let reviews = 0;
  try {
    const result = await executeRun(f.store, f.run.id, {
      code: async ({ run, attempt, prompt }) => {
        writeFileSync(join(run.worktree, "answer.txt"), "42\n");
        if (attempt === 2) {
          assert.match(prompt, /explain the answer/);
          writeFileSync(
            join(run.worktree, "explanation.md"),
            "The answer is 42.\n",
          );
        }
        return { outcome: "completed", summary: "updated" };
      },
      review: async () => {
        reviews++;
        return reviews === 1
          ? {
              approved: false,
              summary: "needs documentation",
              issues: ["explain the answer"],
            }
          : { approved: true, summary: "ok", issues: [] };
      },
    });
    assert.equal(result.status, "succeeded");
    assert.equal(reviews, 2);
  } finally {
    f.cleanup();
  }
});
