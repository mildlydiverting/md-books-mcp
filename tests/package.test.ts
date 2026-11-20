import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Guards the npm package contents. `npm pack --dry-run --json` lists what would be published
 * without writing anything or touching the network. If a needed file drops out of `files` in
 * package.json, an npx install would break, so this fails first.
 * Needs a built `dist/` (run `npm run build` first); the failure message says so.
 */
describe("npm package contents", () => {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" })) as {
    files: { path: string }[];
  }[];
  const paths = new Set(packed[0]!.files.map((f) => f.path));

  it("includes the built entry point (run `npm run build` if this fails)", () => {
    expect(paths.has("dist/index.js")).toBe(true);
  });

  it.each(["package.json", "README.md", "LICENSE", "links.example.json", ".env.example"])("includes %s", (file) => {
    expect(paths.has(file)).toBe(true);
  });

  it("includes the official CSL style files", () => {
    for (const f of ["apa.csl", "modern-language-association.csl", "chicago-notes-bibliography.csl", "harvard-cite-them-right.csl"]) {
      expect(paths.has(`csl/${f}`), `csl/${f}`).toBe(true);
    }
  });

  it("leaves out private and development files", () => {
    for (const p of paths) {
      expect(p, p).not.toMatch(/^(tests|_notes|_assets|node_modules)\//);
      expect(p, p).not.toMatch(/^(HANDOFF\.md|\.env)$/);
    }
  });
});
