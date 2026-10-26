import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectSchema } from "../src/domain.js";
import { Store } from "../src/storage.js";

test("project registry survives reopening and keeps repositories separate", () => {
  const root = mkdtempSync(join(tmpdir(), "orchestrator-storage-"));
  let store = new Store(root);
  try {
    for (const id of ["app", "web"])
      store.saveProject(
        ProjectSchema.parse({
          id,
          repo: join(root, id),
          checks: [{ name: "test", command: "node", args: ["--test"] }],
        }),
      );
    store.close();
    store = new Store(root);
    assert.equal(store.projects().length, 2);
    assert.equal(store.project("app").repo, join(root, "app"));
    assert.throws(() => store.project("missing"), /项目不存在/);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("transactional lease prevents competing processes and releases explicitly", () => {
  const root = mkdtempSync(join(tmpdir(), "orchestrator-lock-"));
  const a = new Store(root);
  const b = new Store(root);
  try {
    const release = a.lock();
    assert.throws(() => b.lock(), /已有编排进程/);
    release();
    b.lock()();
  } finally {
    a.close();
    b.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid check configurations cannot silently skip validation", () => {
  assert.equal(
    ProjectSchema.safeParse({ id: "app", repo: "x", checks: [] }).success,
    false,
  );
  assert.equal(
    ProjectSchema.safeParse({ id: "../escape", repo: "x", checks: [] }).success,
    false,
  );
  assert.equal(
    ProjectSchema.safeParse({
      id: "app",
      repo: "x",
      checks: [
        { name: "test", command: "node" },
        { name: "test", command: "node" },
      ],
    }).success,
    false,
  );
});
