import { existsSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const output = join(root, "dist");
if (existsSync(output)) {
  if (realpathSync(output) !== output || dirname(output) !== root) {
    throw new Error("Refusing to clean a build directory outside this project");
  }
  rmSync(output, { recursive: true });
}
