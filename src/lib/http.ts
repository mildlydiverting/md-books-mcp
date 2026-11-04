import { VERSION } from "../version.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = `books-mcp/${VERSION} (MCP server)`;

/** Carries a message written for the model: what went wrong and what to try. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface JsonOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/** GET a URL and parse the body as JSON. Never put secrets in the message. */
export async function getJson<T = unknown>(url: string, options: JsonOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...options.headers },
    });
    if (!res.ok) {
      throw new HttpError(`Request failed with status ${res.status} ${res.statusText}`, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new HttpError(`Request timed out after ${timeoutMs / 1000}s. Try a narrower query.`);
    }
    throw new HttpError(`Could not reach the service: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
