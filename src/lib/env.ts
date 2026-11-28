/**
 * Read a setting from the environment. Returns undefined when it is missing, blank, or an
 * unfilled `${...}` placeholder (a desktop extension host can pass one of those through as plain
 * text when an optional setting is left empty, and it must never be sent as an API key).
 */
export function readEnv(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
  const value = env[name]?.trim();
  if (!value || /^\$\{[^}]*\}$/.test(value)) return undefined;
  return value;
}
