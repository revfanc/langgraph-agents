import { useEffect, useState } from "react";

let token: string | undefined;
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (init.method && init.method !== "GET") {
    if (!token) token = (await api<{ token: string }>("session")).token;
    init.headers = {
      ...init.headers,
      "Content-Type": "application/json",
      "X-Local-Token": token,
    };
  }
  const response = await fetch(`/api/${path}`, { ...init, cache: "no-store" });
  const value = await response.json();
  if (!response.ok) {
    if (response.status === 403) token = undefined;
    throw new Error(value.error ?? `请求失败 (${response.status})`);
  }
  return value as T;
}
export function usePolling<T>(path: string, interval = 1000, version = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const resource = `${path}${path.includes("?") ? "&" : "?"}revision=${version}`;
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      try {
        const result = await api<T>(resource, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setData(result);
          setError("");
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "连接失败，请检查本地服务。",
          );
      } finally {
        if (!controller.signal.aborted && interval > 0)
          timer = setTimeout(tick, interval);
      }
    }
    void tick();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [resource, interval]);
  return { data, error };
}
