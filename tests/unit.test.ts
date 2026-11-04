import { describe, expect, it } from "vitest";
import { formatCitation } from "../src/lib/citation.js";
import { isValidIsbn } from "../src/lib/isbn.js";
import { buildQ, toBook } from "../src/providers/googlebooks.js";
import { providers } from "../src/providers/index.js";

const volume = {
  id: "abc123",
  volumeInfo: {
    title: "The Dispossessed",
    subtitle: "An Ambiguous Utopia",
    authors: ["Ursula K. Le Guin"],
    publisher: "Harper",
    publishedDate: "2003-05-14",
    industryIdentifiers: [
      { type: "ISBN_10", identifier: "0061054887" },
      { type: "ISBN_13", identifier: "9780061054884" },
    ],
    imageLinks: { thumbnail: "http://books.google.com/x?id=abc&edge=curl" },
  },
};

describe("isbn", () => {
  it("accepts valid ISBNs with hyphens", () => {
    expect(isValidIsbn("978-0-14-143951-8")).toBe(true);
    expect(isValidIsbn("0-8044-2957-X")).toBe(true);
  });
  it("rejects bad checksums", () => {
    expect(isValidIsbn("9780141439519")).toBe(false);
    expect(isValidIsbn("hello")).toBe(false);
  });
});

describe("google books mapping", () => {
  it("maps a volume onto Book", () => {
    const b = toBook(volume);
    expect(b).toMatchObject({ source: "googlebooks", id: "abc123", isbn13: "9780061054884", isbn10: "0061054887" });
    expect(b.coverUrl).toBe("https://books.google.com/x?id=abc");
  });
  it("builds field-operator queries", () => {
    expect(buildQ({ title: "Dispossessed", author: "Le Guin", isbn: "978-0-06-105488-4", limit: 5 })).toBe(
      'isbn:9780061054884 intitle:"Dispossessed" inauthor:"Le Guin"',
    );
  });
});

describe("citations", () => {
  const book = toBook(volume);
  it("APA", () => {
    expect(formatCitation(book, "apa")).toBe("Le Guin, U. K. (2003). *The Dispossessed: An Ambiguous Utopia*. Harper.");
  });
  it("MLA", () => {
    expect(formatCitation(book, "mla")).toBe("Le Guin, Ursula K. *The Dispossessed: An Ambiguous Utopia*. Harper, 2003.");
  });
  it("BibTeX", () => {
    expect(formatCitation(book, "bibtex")).toContain("@book{leguin2003,");
  });
});

describe("registry", () => {
  it("has unique provider ids", () => {
    const ids = providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("open library mapping", async () => {
  const { workToBook, editionToBook, buildQ } = await import("../src/providers/openlibrary.js");
  it("maps a work without inventing edition data", () => {
    const b = workToBook({ key: "/works/OL1W", title: "Emma", author_name: ["Jane Austen"], first_publish_year: 1815, cover_i: 7 });
    expect(b).toMatchObject({ source: "openlibrary", id: "OL1W", publishedDate: "1815", authors: ["Jane Austen"] });
    expect(b.publisher).toBeUndefined();
    expect(b.isbn13).toBeUndefined();
    expect(b.coverUrl).toBe("https://covers.openlibrary.org/b/id/7-M.jpg");
  });
  it("maps an edition found by ISBN", () => {
    const b = editionToBook("9780141439518", {
      title: "Pride and Prejudice",
      authors: [{ name: "Jane Austen" }],
      publishers: [{ name: "Penguin Books" }],
      publish_date: "2003",
      identifiers: { isbn_13: ["9780141439518"] },
    });
    expect(b).toMatchObject({ id: "isbn:9780141439518", publisher: "Penguin Books", publishedDate: "2003", isbn13: "9780141439518" });
  });
  it("builds field queries", () => {
    expect(buildQ({ title: "Emma", author: "Austen", limit: 5 })).toBe('title:"Emma" author:"Austen"');
  });
});

describe("open library authors", async () => {
  const { authorSearchDocToAuthor, authorToAuthor } = await import("../src/providers/openlibrary.js");
  it("maps an author search hit", () => {
    const a = authorSearchDocToAuthor({ key: "OL31353A", name: "Ursula K. Le Guin", birth_date: "21 October 1929", top_work: "The Left Hand of Darkness", work_count: 253 });
    expect(a).toMatchObject({ id: "OL31353A", workCount: 253, sourceUrl: "https://openlibrary.org/authors/OL31353A" });
  });
  it("keeps cross-system identifiers and handles object bios", () => {
    const a = authorToAuthor("OL31353A", { name: "X", bio: { value: "Writer." }, remote_ids: { wikidata: "Q181659" }, photos: [-1, 42] });
    expect(a.bio).toBe("Writer.");
    expect(a.identifiers).toEqual({ wikidata: "Q181659" });
    expect(a.photoUrl).toBe("https://covers.openlibrary.org/b/id/42-M.jpg");
  });
});
