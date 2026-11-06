import { VERSION } from "../version.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = `md-books-mcp/${VERSION} (MCP server)`;

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

async function request<T>(
  url: string,
  init: RequestInit,
  options: JsonOptions,
  accept: string,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: accept, "User-Agent": USER_AGENT, ...init.headers, ...options.headers },
    });
    if (!res.ok) {
      throw new HttpError(`Request failed with status ${res.status} ${res.statusText}`, res.status);
    }
    return await read(res);
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

const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

/** GET a URL and parse the body as JSON. Never put secrets in error messages. */
export function getJson<T = unknown>(url: string, options: JsonOptions = {}): Promise<T> {
  return request<T>(url, {}, options, "application/json", readJson<T>);
}

/** GET a URL and return the body as text (for XML sources such as SRU). */
export function getText(url: string, options: JsonOptions = {}): Promise<string> {
  return request<string>(url, {}, options, "application/xml, text/xml, */*", (res) => res.text());
}

/** POST a JSON body and parse the response as JSON. */
export function postJson<T = unknown>(url: string, body: unknown, options: JsonOptions = {}): Promise<T> {
  return request<T>(
    url,
    { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
    options,
    "application/json",
    readJson<T>,
  );
}
