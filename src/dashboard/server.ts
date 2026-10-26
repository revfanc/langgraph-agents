import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CheckResultSchema, RunSchema } from "../domain.js";
import type { Store } from "../storage.js";
import { createRun, registerProject } from "../workspace.js";
import type { DashboardState, RunDetail } from "./contracts.js";
import { artifactPath, artifacts, readArtifact } from "./files.js";
import { BusyError, type LaunchWorker, Supervisor } from "./supervisor.js";

const CreateSchema = RunSchema.pick({
  task: true,
  maxAttempts: true,
  maxAgentCalls: true,
  agentTimeoutMs: true,
})
  .extend({ projectId: z.string().min(1), start: z.boolean().default(true) })
  .strict();
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "请使用 JSON 请求。");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 128 * 1024) throw new HttpError(413, "请求内容过大。");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
const json = (res: ServerResponse, value: unknown, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
};

export async function startDashboard(
  store: Store,
  options: { port?: number; webRoot?: string; launch?: LaunchWorker } = {},
) {
  const supervisor = new Supervisor(store, options.launch);
  const token = randomBytes(32).toString("hex");
  const webRoot =
    options.webRoot ??
    fileURLToPath(new URL("../../dist/web/", import.meta.url));
  let origin = "";
  let host = "";
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    void handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const status =
        error instanceof HttpError
          ? error.status
          : error instanceof BusyError
            ? 409
            : (error as NodeJS.ErrnoException).code === "ENOENT" ||
                message.includes("不存在")
              ? 404
              : 400;
      json(
        res,
        {
          error:
            error instanceof z.ZodError
              ? error.issues
                  .map((i) => `${i.path.join(".")}: ${i.message}`)
                  .join("；")
              : message,
        },
        status,
      );
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (
      req.headers.host !== host ||
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      throw new HttpError(403, "只接受当前本地页面的请求。");
    const url = new URL(req.url ?? "/", origin);
    const method = req.method ?? "GET";
    if (!["GET", "HEAD"].includes(method)) {
      const supplied = req.headers["x-local-token"];
      if (
        typeof supplied !== "string" ||
        supplied.length !== token.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      )
        throw new HttpError(403, "页面会话已失效，请刷新页面后重试。");
    }
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    if (parts[0] !== "api") {
      if (method !== "GET" && method !== "HEAD")
        throw new HttpError(405, "不支持的请求方法。");
      const name =
        url.pathname === "/"
          ? "index.html"
          : /^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|svg|woff2)$/.test(url.pathname)
            ? url.pathname.slice(1)
            : url.pathname === "/favicon.svg"
              ? "favicon.svg"
              : undefined;
      if (!name) throw new HttpError(404, "页面不存在。");
      const path = join(webRoot, name);
      if (!existsSync(path))
        throw new HttpError(404, "界面尚未构建，请先运行 npm run build。");
      const type = name.endsWith(".js")
        ? "text/javascript"
        : name.endsWith(".css")
          ? "text/css"
          : name.endsWith(".svg")
            ? "image/svg+xml"
            : name.endsWith(".woff2")
              ? "font/woff2"
              : "text/html";
      res.setHeader("Content-Type", `${type}; charset=utf-8`);
      res.end(method === "HEAD" ? undefined : readFileSync(path));
      return;
    }
    if (method === "GET" && parts.length === 2 && parts[1] === "session") {
      json(res, { token });
      return;
    }
    if (method === "GET" && parts.length === 2 && parts[1] === "state") {
      const state: DashboardState = {
        projects: store.projects(),
        runs: store
          .runs()
          .slice(0, 200)
          .map((r) => supervisor.view(r)),
        busy: supervisor.busy,
        activeRunId: supervisor.activeRunId,
        dataDir: store.root,
      };
      json(res, state);
      return;
    }
    if (parts[1] === "projects") {
      if (method === "POST" && parts.length === 2) {
        const input = z
          .object({
            id: z.string(),
            repo: z.string(),
            config: z.record(z.string(), z.unknown()),
            replace: z.boolean().default(false),
          })
          .strict()
          .parse(await body(req));
        if (!input.replace && store.projects().some((p) => p.id === input.id))
          throw new HttpError(409, "仓库标识已存在，请使用编辑操作。");
        json(
          res,
          await registerProject(store, input.id, input.repo, input.config),
        );
        return;
      }
      if (method === "DELETE" && parts.length === 3 && parts[2]) {
        if (supervisor.busy)
          throw new BusyError("请先暂停运行中的任务，再移除仓库注册。");
        store.removeProject(parts[2]);
        json(res, { ok: true });
        return;
      }
    }
    if (parts[1] === "runs") {
      if (method === "POST" && parts.length === 2) {
        const { projectId, start, task, ...budget } = CreateSchema.parse(
          await body(req),
        );
        if (start && supervisor.busy)
          throw new BusyError("已有任务正在执行，可选择先保存任务。");
        const run = createRun(store, projectId, task, budget);
        if (start) supervisor.start(run.id);
        json(res, supervisor.view(store.run(run.id)), 201);
        return;
      }
      const id = z.uuid().parse(parts[2]);
      const run = store.run(id);
      if (method === "GET" && parts.length === 3) {
        const receipts = store.receipts(id);
        const attempts = Math.max(
          0,
          ...receipts.map(({ key }) =>
            Number(/^code:(\d+)$/.exec(key)?.[1] ?? 0),
          ),
          Number(/^(?:code|verify|review):(\d+)$/.exec(run.phase)?.[1] ?? 0),
        );
        const checks = receipts.flatMap(({ key, value }) => {
          if (!/^(setup|baseline|verify):/.test(key)) return [];
          const result = CheckResultSchema.safeParse(value);
          return result.success
            ? [{ ...result.data, tail: result.data.tail.slice(-6000), key }]
            : [];
        });
        const detail: RunDetail = {
          run: supervisor.view(run),
          attempts,
          events: store.events(id),
          checks,
          files: artifacts(store, id),
        };
        json(res, detail);
        return;
      }
      if (method === "POST" && parts.length === 4 && parts[3] === "resume") {
        supervisor.start(id);
        json(res, supervisor.view(store.run(id)), 202);
        return;
      }
      if (method === "POST" && parts.length === 4 && parts[3] === "pause") {
        supervisor.pause(id);
        json(res, { ok: true }, 202);
        return;
      }
      if (
        method === "GET" &&
        parts.length === 5 &&
        parts[3] === "files" &&
        parts[4]
      ) {
        const path = artifactPath(store, id, parts[4]);
        if (url.searchParams.get("download") === "1") {
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${parts[4]}"`,
          );
          res.setHeader("Content-Type", "application/octet-stream");
          const stream = createReadStream(path);
          stream.on("error", () => res.destroy());
          res.on("close", () => stream.destroy());
          stream.pipe(res);
        } else {
          const offset = url.searchParams.has("offset")
            ? z.coerce
                .number()
                .int()
                .min(0)
                .max(Number.MAX_SAFE_INTEGER)
                .parse(url.searchParams.get("offset"))
            : undefined;
          json(res, readArtifact(store, id, parts[4], offset));
        }
        return;
      }
    }
    throw new HttpError(404, "接口不存在。");
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4317, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("无法获取服务端口。"));
        return;
      }
      host = `127.0.0.1:${address.port}`;
      origin = `http://${host}`;
      resolve();
    });
  });
  return {
    url: origin,
    supervisor,
    close: async () => {
      const closed = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      await supervisor.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
