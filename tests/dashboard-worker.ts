import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runProcess } from "../src/process.js";
import { executeRun } from "../src/runner.js";
import { Store } from "../src/storage.js";

const [root, id] = process.argv.slice(2);
if (!root || !id) throw new Error("Missing worker arguments");
const store = new Store(root);
try {
  const result = await executeRun(store, id, {
    code: async ({ run, signal }) => {
      await runProcess({
        command: process.execPath,
        args: [
          "-e",
          `console.log('Waiting for test gate');const fs=require('node:fs');setInterval(()=>{if(fs.existsSync(${JSON.stringify(join(root, "gate"))}))process.exit(0)},50)`,
        ],
        cwd: run.worktree,
        log: join(store.dir(id), "coding.log"),
        timeoutMs: 30_000,
        signal,
        onStart: (childPid) => {
          store.updateRun(id, { childPid });
        },
        onExit: () => {
          store.updateRun(id, { childPid: undefined });
        },
      });
      signal.throwIfAborted();
      writeFileSync(join(run.worktree, "answer.txt"), "42\n");
      return { outcome: "completed", summary: "fixed" };
    },
    review: async () => ({ approved: true, summary: "checked", issues: [] }),
  });
  console.log(result.status);
} finally {
  store.close();
}
