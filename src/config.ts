export interface ModelConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}

export function loadModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): ModelConfig {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_MODEL?.trim();
  const missing = [
    !apiKey && "OPENAI_API_KEY",
    !model && "OPENAI_MODEL",
  ].filter(Boolean);
  if (!apiKey || !model) {
    throw new Error(
      `缺少模型配置：${missing.join("、")}。请按 .env.example 配置，或使用 --demo。`,
    );
  }

  const baseURL = env.OPENAI_BASE_URL?.trim() || undefined;
  if (baseURL) {
    const url = URL.parse(baseURL);
    if (
      !url ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "OPENAI_BASE_URL 必须是有效的 HTTP(S) API 地址，且不能内嵌凭据。",
      );
    }
  }
  return { apiKey, model, baseURL };
}
