import { readFileSync } from "node:fs";
import { Cite, plugins } from "@citation-js/core";
import "@citation-js/plugin-csl";
import type { Book } from "../types.js";

export const CITATION_STYLES = ["apa", "mla", "chicago", "harvard", "bibtex", "wikipedia", "csl-json", "markdown"] as const;
export type CitationStyle = (typeof CITATION_STYLES)[number];

function year(book: Book): string | undefined {
  return book.publishedDate?.slice(0, 4);
}

function fullTitle(book: Book): string {
  return book.subtitle ? `${book.title}: ${book.subtitle}` : book.title;
}

const PARTICLES = new Set(["le", "la", "de", "del", "della", "der", "den", "di", "da", "du", "van", "von", "bin", "ibn", "al", "el", "st.", "mac"]);

/**
 * "Ursula K. Le Guin" -> { family: "Le Guin", given: "Ursula K." }. Takes the last word as
 * the family name, plus any lower-case-style particles directly before it. Not perfect.
 */
function splitName(name: string): { family: string; given: string } {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return { family: words[0] ?? name, given: "" };
  let start = words.length - 1;
  while (start > 1 && PARTICLES.has((words[start - 1] ?? "").toLowerCase())) start--;
  return { family: words.slice(start).join(" "), given: words.slice(0, start).join(" ") };
}

/** "London: Harper" when the place is known, else "Harper". */
const withPlace = (book: Book): string | undefined =>
  book.publisher ? (book.place ? `${book.place}: ${book.publisher}` : book.publisher) : undefined;

// --- standard styles: Citation.js running the official CSL style files in ../../csl ---------

/** Our style name -> CSL file (in `csl/`, copied unchanged from the CSL styles repository). */
const CSL_FILES = {
  apa: "apa.csl", // APA 7th edition
  mla: "modern-language-association.csl", // MLA 9th edition
  chicago: "chicago-notes-bibliography.csl", // Chicago 17th edition, bibliography entry (no place of publication)
  harvard: "harvard-cite-them-right.csl", // Cite Them Right 12th edition (UK Harvard)
} as const;
type CslStyle = keyof typeof CSL_FILES;

let registered = false;
function registerStyles(): void {
  if (registered) return;
  const styles = plugins.config.get("@csl").styles as { add(name: string, xml: string): void };
  for (const [name, file] of Object.entries(CSL_FILES)) {
    styles.add(name, readFileSync(new URL(`../../csl/${file}`, import.meta.url), "utf8"));
  }
  registered = true;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Citation.js html bibliography entry -> markdown-ish text: italics become *...*, other tags go. */
function htmlEntryToText(html: string): string {
  const entry = /<div[^>]*class="csl-entry"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? html;
  return entry
    .replace(/<\/?(?:i|em)>/g, "*")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function csl(book: Book, style: CslStyle): string {
  registerStyles();
  const items = JSON.parse(cslJson(book)) as Record<string, unknown>[];
  // A place with no publisher has nothing to attach to; leave it out of the printed citation (the data keeps it).
  for (const item of items) if (!item.publisher) delete item["publisher-place"];
  const html = new Cite(items).format("bibliography", { format: "html", template: style, lang: "en-GB" }) as string;
  return htmlEntryToText(html);
}

function bibtex(book: Book): string {
  const family = splitName(book.authors[0] ?? "anon").family.toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = `${family || "anon"}${year(book) ?? ""}`;
  const fields: [string, string | undefined][] = [
    ["author", book.authors.length ? book.authors.join(" and ") : undefined],
    ["title", fullTitle(book)],
    ["publisher", book.publisher],
    ["address", book.place],
    ["edition", book.edition],
    ["year", year(book)],
    ["isbn", book.isbn13 ?? book.isbn10],
  ];
  const body = fields
    .filter((f): f is [string, string] => Boolean(f[1]))
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n");
  return `@book{${key},\n${body}\n}`;
}

/** Wikipedia template text must not contain a bare pipe. */
const wikiEscape = (v: string): string => v.replace(/\|/g, "{{!}}");

/**
 * Wikipedia `{{cite book}}`, for adding a source to an article. Uses `last1`/`first1`... for
 * authors, `date` as the record gives it, and `ol` (Open Library edition id, no "OL" prefix)
 * when known.
 */
function wikipedia(book: Book): string {
  const params: [string, string | undefined][] = [];
  book.authors.forEach((a, i) => {
    const { family, given } = splitName(a);
    params.push([`last${i + 1}`, family], [`first${i + 1}`, given || undefined]);
  });
  const edition = book.identifiers?.openlibrary_edition?.replace(/^OL/i, "");
  params.push(
    ["title", fullTitle(book)],
    ["date", book.publishedDate],
    ["edition", book.edition],
    ["publisher", book.publisher],
    ["location", book.place],
    ["isbn", book.isbn13 ?? book.isbn10],
    ["ol", edition],
  );
  const body = params
    .filter((p): p is [string, string] => Boolean(p[1]))
    .map(([k, v]) => `|${k}=${wikiEscape(v)}`)
    .join(" ");
  return `{{cite book ${body}}}`;
}

/** CSL-JSON: a one-item array, ready to import into Zotero or similar. */
function cslJson(book: Book): string {
  const parts = book.publishedDate?.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  const dateParts = parts ? [parts[1], parts[2], parts[3]].filter(Boolean).map(Number) : undefined;
  const key = bibtex(book).match(/^@book\{([^,]*),/)?.[1] ?? "item";
  const item = {
    id: key,
    type: "book",
    title: fullTitle(book),
    author: book.authors.map((a) => {
      const { family, given } = splitName(a);
      return given ? { family, given } : { family };
    }),
    issued: dateParts ? { "date-parts": [dateParts] } : undefined,
    publisher: book.publisher,
    "publisher-place": book.place,
    edition: book.edition,
    ISBN: book.isbn13 ?? book.isbn10,
    language: book.language,
    "number-of-pages": book.pageCount ? String(book.pageCount) : undefined,
    URL: book.sourceUrl,
  };
  return JSON.stringify([item], null, 2);
}

const mdEscape = (v: string): string => v.replace(/([_*\\])/g, "\\$1");

/**
 * Kim's markdown form:
 * `Surname, Firstnames (yyyy) _Title_. \[edition\]. Place: Publisher. [ISBN](link) Open Library: [OL…W](url)`
 * Parts the record lacks are left out. Authors are separated by semicolons.
 */
function markdown(book: Book, opts: CitationOptions): string {
  const who = book.authors
    .map((a) => {
      const { family, given } = splitName(a);
      return given ? `${family}, ${given}` : family;
    })
    .join("; ");
  const head = `${who ? `${who} ` : ""}(${year(book) ?? "n.d."}) _${mdEscape(fullTitle(book))}_.`;
  const edition = book.edition ? ` \\[${book.edition.replace(/\.$/, "")}\\].` : "";
  const pub = book.publisher ? ` ${withPlace(book)?.replace(/\.?$/, ".")}` : "";
  const isbn = book.isbn13 ?? book.isbn10;
  const isbnPart = isbn ? ` ${opts.isbnLink ? `[${isbn}](${opts.isbnLink})` : isbn}` : "";
  const work = book.identifiers?.openlibrary_work;
  const ol = work ? ` Open Library: [${work}](https://openlibrary.org/works/${work})` : "";
  return `${head}${edition}${pub}${isbnPart}${ol}`;
}

/** Styles that print the place of publication when it is known. */
export const STYLES_WITH_PLACE: readonly CitationStyle[] = ["harvard", "markdown"];

export interface CitationOptions {
  /** Search link for the ISBN, used by the markdown style. */
  isbnLink?: string;
}

/**
 * Format a citation. Author names are split naively (last word = family name),
 * so check names with particles, mononyms or institutions by eye.
 */
export function formatCitation(book: Book, style: CitationStyle, opts: CitationOptions = {}): string {
  switch (style) {
    case "apa":
    case "mla":
    case "chicago":
    case "harvard":
      return csl(book, style);
    case "bibtex":
      return bibtex(book);
    case "wikipedia":
      return wikipedia(book);
    case "csl-json":
      return cslJson(book);
    case "markdown":
      return markdown(book, opts);
  }
}
