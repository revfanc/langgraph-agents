import {
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { Store } from "../storage.js";
import type { Artifact, FileSlice } from "./contracts.js";

const allowed = /^[a-zA-Z0-9._-]+\.(log|json|md|patch)$/;
export function artifactPath(store: Store, id: string, name: string): string {
  store.run(id);
  if (!allowed.test(name)) throw new Error("无效的产物文件名。");
  const root = realpathSync(store.dir(id));
  const path = join(root, name);
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    relative(root, realpathSync(path)) !== name
  )
    throw new Error("产物必须是任务目录内的普通文件。");
  return path;
}
export function artifacts(store: Store, id: string): Artifact[] {
  return readdirSync(store.dir(id))
    .filter((name) => allowed.test(name) && !name.endsWith(".schema.json"))
    .flatMap((name) => {
      try {
        const stat = lstatSync(artifactPath(store, id, name));
        return [
          { name, size: stat.size, modifiedAt: stat.mtime.toISOString() },
        ];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
export function readArtifact(
  store: Store,
  id: string,
  name: string,
  offset?: number,
): FileSlice {
  const path = artifactPath(store, id, name);
  const size = lstatSync(path).size;
  const start =
    offset === undefined
      ? Math.max(0, size - 64 * 1024)
      : Math.min(offset, size);
  const buffer = Buffer.alloc(Math.min(64 * 1024, size - start));
  const fd = openSync(path, "r");
  try {
    const bytes = readSync(fd, buffer, 0, buffer.length, start);
    return {
      name,
      text: buffer
        .subarray(0, bytes)
        .toString("utf8")
        .replace(/^\uFFFD+/, ""),
      start,
      end: start + bytes,
      size,
    };
  } finally {
    closeSync(fd);
  }
}
