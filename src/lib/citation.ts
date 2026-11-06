import type { Book } from "../types.js";

export const CITATION_STYLES = ["apa", "mla", "chicago", "harvard", "bibtex"] as const;
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

function initials(given: string): string {
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0]?.toUpperCase()}.`)
    .join(" ");
}

function list(items: string[], last: string): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")}${items.length > 2 ? "," : ""} ${last} ${items[items.length - 1]}`;
}

function apa(book: Book): string {
  const names = book.authors.map((a) => {
    const { family, given } = splitName(a);
    return given ? `${family}, ${initials(given)}` : family;
  });
  const who = names.length > 20 ? `${names.slice(0, 19).join(", ")}, ... ${names[names.length - 1]}` : list(names, "&");
  return [
    who ? `${who} ` : "",
    `(${year(book) ?? "n.d."}). `,
    `*${fullTitle(book)}*.`,
    book.publisher ? ` ${book.publisher}.` : "",
  ].join("");
}

/** "London: Harper" when the place is known, else "Harper". */
const withPlace = (book: Book): string | undefined =>
  book.publisher ? (book.place ? `${book.place}: ${book.publisher}` : book.publisher) : undefined;

/**
 * Harvard, in the Cite Them Right (UK) form: "Le Guin, U.K. (1974) *Title*. London: Harper."
 * Four or more authors become "first et al.". The place is used only when the record already
 * has it; otherwise it is left out.
 */
function harvard(book: Book): string {
  const names = book.authors.map((a) => {
    const { family, given } = splitName(a);
    return given ? `${family}, ${initials(given).replace(/ /g, "")}` : family;
  });
  const who = names.length >= 4 ? `${names[0]} et al.` : list(names, "and");
  return [
    who ? `${who} ` : "",
    `(${year(book) ?? "no date"}) `,
    `*${fullTitle(book)}*.`,
    book.publisher ? ` ${withPlace(book)}.` : "",
  ].join("");
}

function mla(book: Book): string {
  const [first, second, ...rest] = book.authors.map(splitName);
  let who = "";
  if (first) {
    const lead = first.given ? `${first.family}, ${first.given}` : first.family;
    if (rest.length > 0) who = `${lead}, et al.`;
    else if (second) who = `${lead}, and ${second.given} ${second.family}`.trim();
    else who = lead;
  }
  const tail = [book.publisher, year(book)].filter(Boolean).join(", ");
  return `${who ? `${who.replace(/\.$/, "")}. ` : ""}*${fullTitle(book)}*.${tail ? ` ${tail}.` : ""}`;
}

function chicago(book: Book): string {
  const [first, ...others] = book.authors.map(splitName);
  const names = [
    first ? (first.given ? `${first.family}, ${first.given}` : first.family) : "",
    ...others.map((o) => `${o.given} ${o.family}`.trim()),
  ].filter(Boolean);
  const who = list(names, "and");
  const pub = [withPlace(book), year(book)].filter(Boolean).join(", ");
  return `${who ? `${who.replace(/\.$/, "")}. ` : ""}*${fullTitle(book)}*.${pub ? ` ${pub}.` : ""}`;
}

function bibtex(book: Book): string {
  const family = splitName(book.authors[0] ?? "anon").family.toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = `${family || "anon"}${year(book) ?? ""}`;
  const fields: [string, string | undefined][] = [
    ["author", book.authors.length ? book.authors.join(" and ") : undefined],
    ["title", fullTitle(book)],
    ["publisher", book.publisher],
    ["address", book.place],
    ["year", year(book)],
    ["isbn", book.isbn13 ?? book.isbn10],
  ];
  const body = fields
    .filter((f): f is [string, string] => Boolean(f[1]))
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n");
  return `@book{${key},\n${body}\n}`;
}

/** Styles that print the place of publication when it is known. */
export const STYLES_WITH_PLACE: readonly CitationStyle[] = ["harvard", "chicago"];

/**
 * Format a citation. Author names are split naively (last word = family name),
 * so check names with particles, mononyms or institutions by eye.
 */
export function formatCitation(book: Book, style: CitationStyle): string {
  switch (style) {
    case "apa":
      return apa(book);
    case "mla":
      return mla(book);
    case "chicago":
      return chicago(book);
    case "harvard":
      return harvard(book);
    case "bibtex":
      return bibtex(book);
  }
}
