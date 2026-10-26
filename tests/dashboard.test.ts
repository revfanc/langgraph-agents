import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { startDashboard } from "../src/dashboard/server.js";
import { Store } from "../src/storage.js";
import { fixture } from "./helpers.js";

async function until(check: () => boolean, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error("Timed out waiting for worker");
    await delay(50);
  }
}
async function setup() {
  const f = await fixture();
  const server = await startDashboard(f.store, {
    port: 0,
    launch: (id, log) =>
      spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(new URL("./dashboard-worker.ts", import.meta.url)),
          f.store.root,
          id,
        ],
        { windowsHide: true, stdio: ["ignore", log, log] },
      ),
  });
  const { token } = (await fetch(`${server.url}/api/session`).then((r) =>
    r.json(),
  )) as { token: string };
  const post = (path: string, value = {}) =>
    fetch(`${server.url}/api/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Local-Token": token,
        Origin: server.url,
      },
      body: JSON.stringify(value),
    });
  return {
    f,
    server,
    post,
    token,
    cleanup: async () => {
      await server.close();
      f.cleanup();
    },
  };
}

test("dashboard enforces same-origin mutation, rejects rebinding and bounds artifact reads", async () => {
  const t = await setup();
  try {
    const denied = await fetch(`${t.server.url}/api/runs`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(denied.status, 403);
    assert.equal(
      (
        await fetch(`${t.server.url}/api/state`, {
          headers: { Origin: "https://unrelated.invalid" },
        })
      ).status,
      403,
    );
    const reboundStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = request(
          `${t.server.url}/api/state`,
          { headers: { Host: "unrelated.invalid" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    assert.equal(reboundStatus, 403);
    writeFileSync(
      join(t.f.store.dir(t.f.run.id), "large.log"),
      "line\n".repeat(30000),
    );
    const file = (await fetch(
      `${t.server.url}/api/runs/${t.f.run.id}/files/large.log`,
    ).then((r) => r.json())) as { text: string; start: number };
    assert.ok(Buffer.byteLength(file.text) <= 65536);
    assert.ok(file.start > 0);
    const traversal = await fetch(
      `${t.server.url}/api/runs/${t.f.run.id}/files/..%5c..%5cstate.sqlite`,
    );
    assert.equal(traversal.status, 400);
    assert.equal(
      (
        await t.post("projects", {
          id: "sample",
          repo: t.f.repo,
          config: { checks: t.f.run.project.checks },
        })
      ).status,
      409,
    );
  } finally {
    await t.cleanup();
  }
});

test("HTTP controls launch one real workflow, expose logs, pause, resume and preserve source repo", async () => {
  const t = await setup();
  try {
    assert.equal((await t.post(`runs/${t.f.run.id}/resume`)).status, 202);
    assert.equal((await t.post(`runs/${t.f.run.id}/resume`)).status, 409);
    await until(() => Boolean(t.f.store.run(t.f.run.id).childPid));
    const saved = await t.post("runs", {
      projectId: "sample",
      task: "pending",
      start: false,
    });
    assert.equal(saved.status, 201);
    assert.equal(
      (
        await t.post("runs", {
          projectId: "sample",
          task: "competing",
          start: true,
        })
      ).status,
      409,
    );
    assert.equal((await t.post(`runs/${t.f.run.id}/pause`)).status, 202);
    await until(() => !t.server.supervisor.busy);
    assert.equal(t.f.store.run(t.f.run.id).status, "paused");
    const detail = (await fetch(`${t.server.url}/api/runs/${t.f.run.id}`).then(
      (r) => r.json(),
    )) as { events: unknown[]; files: { name: string }[] };
    assert.ok(detail.events.length > 3);
    assert.ok(detail.files.some((f) => f.name === "coding.log"));
    writeFileSync(join(t.f.store.root, "gate"), "go");
    assert.equal((await t.post(`runs/${t.f.run.id}/resume`)).status, 202);
    assert.equal(
      t.server.supervisor.view(t.f.store.run(t.f.run.id)).pauseRequested,
      false,
    );
    await until(() => !t.server.supervisor.busy);
    assert.equal(t.f.store.run(t.f.run.id).status, "succeeded");
    const completed = (await fetch(
      `${t.server.url}/api/runs/${t.f.run.id}`,
    ).then((r) => r.json())) as { attempts: number };
    assert.equal(completed.attempts, 1);
    assert.equal((await t.post(`runs/${t.f.run.id}/resume`)).status, 400);
    const patch = await fetch(
      `${t.server.url}/api/runs/${t.f.run.id}/files/changes.patch?download=1`,
    );
    assert.match(patch.headers.get("content-disposition") ?? "", /attachment/);
    assert.match(await patch.text(), /42/);
    assert.equal(
      execFileSync("git", ["-C", t.f.repo, "status", "--porcelain"], {
        encoding: "utf8",
      }),
      "",
    );
    assert.equal(readFileSync(join(t.f.repo, "answer.txt"), "utf8"), "wrong\n");
  } finally {
    await t.cleanup();
  }
});

test("pause immediately after launch is retained through worker initialization", async () => {
  const t = await setup();
  try {
    await t.post(`runs/${t.f.run.id}/resume`);
    await t.post(`runs/${t.f.run.id}/pause`);
    await until(() => !t.server.supervisor.busy);
    assert.equal(t.f.store.run(t.f.run.id).status, "paused");
  } finally {
    await t.cleanup();
  }
});

test("graceful dashboard shutdown pauses its worker and a new server reads persisted recovery state", async () => {
  const t = await setup();
  try {
    await t.post(`runs/${t.f.run.id}/resume`);
    await until(() => Boolean(t.f.store.run(t.f.run.id).childPid));
    await t.server.close();
    assert.equal(t.f.store.run(t.f.run.id).status, "paused");
    assert.equal(t.f.store.run(t.f.run.id).childPid, undefined);
    const reopened = new Store(t.f.store.root);
    const next = await startDashboard(reopened, { port: 0 });
    try {
      const detail = (await fetch(`${next.url}/api/runs/${t.f.run.id}`).then(
        (r) => r.json(),
      )) as {
        run: { status: string; active: boolean };
        events: { status: string }[];
      };
      assert.equal(detail.run.status, "paused");
      assert.equal(detail.run.active, false);
      assert.ok(detail.events.some((event) => event.status === "paused"));
    } finally {
      await next.close();
      reopened.close();
    }
  } finally {
    await t.server.close();
    t.f.cleanup();
  }
});

test("project changes preserve existing task snapshots and removal preserves repository and history", async () => {
  const t = await setup();
  try {
    const updated = await t.post("projects", {
      id: "sample",
      repo: t.f.repo,
      replace: true,
      config: { checks: t.f.run.project.checks, rules: ["CUSTOM.md"] },
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(t.f.store.project("sample").rules, ["CUSTOM.md"]);
    assert.deepEqual(t.f.store.run(t.f.run.id).project.rules, ["AGENTS.md"]);
    const removed = await fetch(`${t.server.url}/api/projects/sample`, {
      method: "DELETE",
      headers: { "X-Local-Token": t.token, Origin: t.server.url },
    });
    assert.equal(removed.status, 200);
    assert.equal(t.f.store.projects().length, 0);
    assert.equal(t.f.store.run(t.f.run.id).project.id, "sample");
    assert.ok(t.f.store.events(t.f.run.id).length > 0);
    assert.ok(existsSync(join(t.f.repo, ".git")));
  } finally {
    await t.cleanup();
  }
});
