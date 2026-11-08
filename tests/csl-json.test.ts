import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { formatCitation } from "../src/lib/citation.js";
import type { Book } from "../src/types.js";

// ajv ships CommonJS; load it the CommonJS way so default exports resolve.
const require = createRequire(import.meta.url);
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const schema = JSON.parse(readFileSync(new URL("./fixtures/csl-data.json", import.meta.url), "utf8"));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const base: Book = {
  source: "t",
  id: "1",
  title: "The Dispossessed",
  subtitle: "An Ambiguous Utopia",
  authors: ["Ursula K. Le Guin"],
  publisher: "Harper",
  place: "New York",
  publishedDate: "1999",
  isbn13: "9780060125639",
  language: "en",
  pageCount: 341,
  edition: "2nd ed.",
  sourceUrl: "https://openlibrary.org/books/OL5424470M/The_Dispossessed",
};

const cases: Record<string, Book> = {
  "full record": base,
  "year only": base,
  "year-month": { ...base, publishedDate: "1999-05" },
  "full date": { ...base, publishedDate: "1999-05-14" },
  "no date": { ...base, publishedDate: undefined },
  "no authors": { ...base, authors: [] },
  "mononym": { ...base, authors: ["Plato"] },
  "many authors": { ...base, authors: ["A. One", "B. Two", "C. Three", "D. Four"] },
  "bare minimum": { source: "t", id: "2", title: "Thing", authors: [] },
};

describe("csl-json conforms to the official CSL-JSON schema", () => {
  for (const [label, book] of Object.entries(cases)) {
    it(label, () => {
      const json = JSON.parse(formatCitation(book, "csl-json"));
      const ok = validate(json);
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
      expect(Array.isArray(json)).toBe(true);
    });
  }

  it("the validator really rejects bad data (guards against a vacuous pass)", () => {
    expect(validate([{ id: "x", type: "not-a-type" }])).toBe(false);
  });

  it("contains no undefined/empty keys", () => {
    const [item] = JSON.parse(formatCitation({ source: "t", id: "2", title: "Thing", authors: [] }, "csl-json"));
    expect(Object.keys(item).sort()).toEqual(["author", "id", "title", "type"]);
  });
});
