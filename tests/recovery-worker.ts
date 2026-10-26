import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeRun } from "../src/runner.js";
import { Store } from "../src/storage.js";

const [root, id, mode] = process.argv.slice(2);
if (!root || !id) throw new Error("Expected data directory and run ID");
const store = new Store(root);
try {
  const result = await executeRun(
    store,
    id,
    {
      code: async ({ run }) => {
        const answer = join(run.worktree, "answer.txt");
        appendFileSync(
          join(root, "calls.log"),
          `${readFileSync(answer, "utf8").trim()}\n`,
        );
        writeFileSync(answer, "42\n");
        if (mode === "crash") process.exit(17);
        return { outcome: "completed", summary: "fixed" };
      },
      review: async () => ({ approved: true, summary: "ok", issues: [] }),
    },
    { pauseAfter: mode === "pause" ? "code" : undefined },
  );
  console.log(result.status);
} finally {
  store.close();
}
