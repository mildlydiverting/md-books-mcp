import { XMLParser } from "fast-xml-parser";
import { getJson, getText, HttpError } from "../lib/http.js";
import { cleanIsbn, isValidIsbn10, isValidIsbn13 } from "../lib/isbn.js";
import { createPacer } from "../lib/pace.js";
import type { Author, Book, BookProvider, BookQuery } from "../types.js";

/**
 * Library of Congress. Two keyless services:
 *  - the catalogue (SRU, MODS XML) for books: cataloguer-quality edition records;
 *  - id.loc.gov name authorities for authors: dates, variants, VIAF/ISNI/Wikidata ids.
 * The loc.gov JSON site is behind a bot check and is deliberately not used.
 */
const SRU = "https://lx2.loc.gov/sru/lcdb";
const IDS = "https://id.loc.gov";
const LCCN_URL = "https://lccn.loc.gov";
/** Be gentle with a public service: one request at a time, with a pause between. */
const GAP_MS = 400;

const LCCN_PREFIX = "lccn:";
const ISBN_PREFIX = "isbn:";

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  // Keep ISBNs and LCCNs as strings: leading zeros matter.
  parseTagValue: false,
});

// --- tiny helpers for loosely typed parsed XML ----------------------------------

type X = Record<string, unknown>;
const arr = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const objs = (v: unknown): X[] => arr(v).filter((n): n is X => !!n && typeof n === "object");

/** Text of an element, whether it parsed to a string or to {#text, @_attr...}. */
function text(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (v && typeof v === "object" && "#text" in v) return text((v as X)["#text"]);
  return undefined;
}
const attr = (v: unknown, name: string): string | undefined =>
  v && typeof v === "object" ? ((v as X)[`@_${name}`] as string | undefined) : undefined;

const uniq = (xs: (string | undefined)[]): string[] => [...new Set(xs.filter((x): x is string => !!x))];

// --- names -----------------------------------------------------------------------

const SUFFIX = /^(Jr|Sr|II|III|IV)\.?$/i;

/** "Le Guin, Ursula K.," becomes "Ursula K. Le Guin". Exported for tests. */
export function forwardName(raw: string): string {
  const cleaned = raw.trim().replace(/[,;\s]+$/, "");
  const parts = cleaned.split(/,\s*/);
  if (parts.length < 2) return cleaned;
  const family = parts[0]!;
  let rest = parts.slice(1);
  let suffix = "";
  if (rest.length > 1 && SUFFIX.test(rest[rest.length - 1]!)) suffix = `, ${rest.pop()}`;
  return `${rest.join(", ")} ${family}${suffix}`.trim();
}

const DATES = /,?\s*((?:ca\.\s*|fl\.\s*)?\d{3,4}\??)?\s*-\s*((?:ca\.\s*)?\d{3,4}\??)?\.?$/;

/** Split an authority heading like "Le Guin, Ursula K., 1929-2018" into name and dates. Exported for tests. */
export function splitHeading(label: string): { name: string; birth?: string; death?: string } {
  const m = DATES.exec(label.trim());
  if (!m || (!m[1] && !m[2])) return { name: forwardName(label) };
  return { name: forwardName(label.slice(0, m.index)), birth: m[1], death: m[2] };
}

// --- books (MODS) ----------------------------------------------------------------

const LANGUAGES: Record<string, string> = {
  eng: "en", fre: "fr", ger: "de", spa: "es", ita: "it", por: "pt", dut: "nl", rus: "ru",
  lat: "la", grc: "el", gre: "el", jpn: "ja", chi: "zh", ara: "ar", heb: "he", swe: "sv",
  dan: "da", nor: "no", pol: "pl", wel: "cy", gle: "ga",
};

const AUTHOR_ROLES = new Set(["author", "creator", "aut", "cre"]);

function titleOf(mods: X): { title?: string; subtitle?: string } {
  const infos = objs(mods.titleInfo);
  // Skip alternative and uniform titles.
  const info = infos.find((t) => !attr(t, "type")) ?? infos[0];
  if (!info) return {};
  const main = [text(info.nonSort), text(info.title)].filter(Boolean).join(" ").replace(/\s*[/:;,]$/, "");
  return { title: main || undefined, subtitle: text(info.subTitle)?.replace(/\s*[/:;,]$/, "") };
}

function authorsOf(mods: X): string[] {
  const names = objs(mods.name);
  const wanted = names.filter((n) => {
    const roles = objs(n.role).flatMap((r) => objs(r.roleTerm).map((t) => text(t)?.toLowerCase()));
    return roles.length === 0 || roles.some((r) => r && AUTHOR_ROLES.has(r));
  });
  const hasRole = (n: X) => objs(n.role).length > 0;
  const hasPerson = wanted.some((n) => attr(n, "type") !== "corporate");
  // Roleless corporate names beside a person are usually added entries (a collection, a donor), not authors.
  const kept = hasPerson ? wanted.filter((n) => attr(n, "type") !== "corporate" || hasRole(n)) : wanted;
  const chosen = kept.length ? kept : names;
  return uniq(
    chosen.map((n) => {
      const part = arr(n.namePart).find((p) => !attr(p, "type"));
      const raw = text(part);
      if (!raw) return undefined;
      return attr(n, "type") === "corporate" ? raw.replace(/[,.\s]+$/, "") : forwardName(raw);
    }),
  );
}

function publisherOf(mods: X): string | undefined {
  for (const info of objs(mods.originInfo)) {
    const raw = objs(info.agent).map((a) => text(a.namePart))[0] ?? text(info.publisher);
    if (raw) return raw.replace(/^\[|\]$/g, "").replace(/[\s,;:]+$/, "");
  }
  return undefined;
}

function dateOf(mods: X): string | undefined {
  const dates: { value: string; marc: boolean }[] = [];
  for (const info of objs(mods.originInfo)) {
    for (const d of arr(info.dateIssued)) {
      const value = text(d);
      if (value) dates.push({ value, marc: attr(d, "encoding") === "marc" });
    }
  }
  dates.sort((a, b) => Number(b.marc) - Number(a.marc));
  for (const { value } of dates) {
    const m = /\d{4}(?:-\d{2}(?:-\d{2})?)?/.exec(value);
    if (m) return m[0];
  }
  return undefined;
}

function identifiersOf(mods: X, type: string): string[] {
  return arr(mods.identifier)
    .filter((i) => attr(i, "type") === type)
    .map((i) => text(i))
    .filter((v): v is string => !!v);
}

/** Exported for tests. One MODS record to a Book, or undefined if it has no usable id. */
export function modsToBook(mods: X): Book | undefined {
  const { title, subtitle } = titleOf(mods);
  const isbns = identifiersOf(mods, "isbn")
    .map((v) => /[\dX][\dX-]{8,16}/i.exec(v)?.[0])
    .filter((v): v is string => !!v)
    .map(cleanIsbn);
  const isbn13 = isbns.find(isValidIsbn13);
  const isbn10 = isbns.find(isValidIsbn10);
  const lccn = identifiersOf(mods, "lccn")[0]?.replace(/\s+/g, "");

  const id = lccn ? `${LCCN_PREFIX}${lccn}` : isbn13 || isbn10 ? `${ISBN_PREFIX}${isbn13 ?? isbn10}` : undefined;
  if (!id || !title) return undefined;

  const extent = objs(mods.physicalDescription).map((p) => text(p.extent))[0];
  const pages = extent ? /(\d+)\s*(?:p\.|pages)/.exec(extent)?.[1] : undefined;
  const langCode = objs(mods.language)
    .flatMap((l) => arr(l.languageTerm))
    .find((t) => attr(t, "type") === "code");
  const subjects = uniq(objs(mods.subject).flatMap((s) => arr(s.topic).map(text))).slice(0, 10);

  return {
    source: "loc",
    id,
    title,
    subtitle,
    authors: authorsOf(mods),
    publisher: publisherOf(mods),
    publishedDate: dateOf(mods),
    isbn10,
    isbn13,
    description: text(mods.abstract),
    subjects: subjects.length ? subjects : undefined,
    pageCount: pages ? Number(pages) : undefined,
    language: langCode ? LANGUAGES[text(langCode) ?? ""] : undefined,
    identifiers: lccn ? { lccn } : undefined,
    sourceUrl: lccn ? `${LCCN_URL}/${lccn}` : undefined,
  };
}

/** CQL for the LC catalogue. Exported for tests. */
export function buildCql(query: BookQuery): string {
  const q = (v: string) => `"${v.replace(/["\\]/g, " ").trim()}"`;
  if (query.isbn) return `bath.isbn=${cleanIsbn(query.isbn)}`;
  const parts: string[] = [];
  if (query.title) parts.push(`bath.title=${q(query.title)}`);
  if (query.author) parts.push(`bath.author=${q(query.author)}`);
  if (query.text) parts.push(`cql.anywhere=${q(query.text)}`);
  return parts.join(" and ");
}

/** Exported for tests. Pulls MODS records out of an SRU response, or throws on a diagnostic. */
export function parseSru(body: string): X[] {
  const root = (xml.parse(body) as X).searchRetrieveResponse as X | undefined;
  if (!root) throw new HttpError("The Library of Congress catalogue sent a response this server could not read.");
  const diag = objs((root.diagnostics as X | undefined)?.diagnostic)[0];
  if (diag) {
    const message = text(diag.message) ?? "unknown error";
    throw new HttpError(`The Library of Congress catalogue rejected the query: ${message}${text(diag.details) ? ` (${text(diag.details)})` : ""}.`);
  }
  return objs((root.records as X | undefined)?.record)
    .map((r) => (r.recordData as X | undefined)?.mods)
    .filter((m): m is X => !!m && typeof m === "object");
}

// --- requests ---------------------------------------------------------------------

const paced = createPacer(() => GAP_MS);

function explain(err: unknown): never {
  if (err instanceof HttpError) {
    if (err.status === 404) throw new HttpError("The Library of Congress has no record with that ID (404). IDs come from search results.", 404);
    if (err.status === 403 || err.status === 429)
      throw new HttpError(`The Library of Congress is limiting requests (${err.status}). Wait a minute and retry with fewer requests.`, err.status);
    if (err.status && err.status >= 500) throw new HttpError(`The Library of Congress had a server problem (${err.status}). Retry in a moment.`, err.status);
  }
  throw err;
}

/** Records that carry the searched ISBN as their own come first; LC records can cite other editions' ISBNs. */
function preferIsbn(books: Book[], isbn: string): Book[] {
  const exact = (b: Book) => b.isbn13 === isbn || b.isbn10 === isbn;
  return [...books.filter(exact), ...books.filter((b) => !exact(b))];
}

async function sru(cql: string, limit: number): Promise<Book[]> {
  const params = new URLSearchParams({
    version: "1.1",
    operation: "searchRetrieve",
    query: cql,
    maximumRecords: String(limit),
    recordSchema: "mods",
  });
  const body = await paced(() => getText(`${SRU}?${params}`, { timeoutMs: 25_000 }));
  return parseSru(body)
    .map(modsToBook)
    .filter((b): b is Book => !!b);
}

// --- authors (id.loc.gov) ------------------------------------------------------------

interface SuggestHit {
  token: string;
  aLabel?: string;
  suggestLabel?: string;
  more?: { variantLabels?: string[]; rdftypes?: string[]; activityfields?: string[] };
}

const isLatin = (s: string): boolean => !/[^\u0000-\u024F\u1E00-\u1EFF]/.test(s);

/** Exported for tests. A name-authority search hit to an Author, or undefined for non-person/corporate hits. */
export function hitToAuthor(h: SuggestHit): Author | undefined {
  const types = h.more?.rdftypes ?? [];
  const isName = types.includes("PersonalName") || types.includes("CorporateName");
  // Name-title headings ("Le Guin, Ursula K. Rocannon's world") are works, not people.
  if (!isName || types.includes("NameTitle") || !h.token) return undefined;
  const { name, birth, death } = splitHeading(h.aLabel ?? h.suggestLabel ?? "");
  const alternates = uniq((h.more?.variantLabels ?? []).filter(isLatin).map((v) => splitHeading(v).name)).filter((n) => n !== name);
  const fields = uniq(h.more?.activityfields ?? []).slice(0, 8);
  return {
    source: "loc",
    id: h.token,
    name,
    alternateNames: alternates.length ? alternates.slice(0, 10) : undefined,
    birthDate: birth,
    deathDate: death,
    topSubjects: fields.length ? fields : undefined,
    identifiers: { lc_naf: h.token },
    sourceUrl: `${IDS}/authorities/names/${h.token}`,
  };
}

type Graph = X[];
const idsOf = (n: X | undefined, key: string): string[] => objs(n?.[key]).map((o) => o["@id"] as string).filter(Boolean);
const valuesOf = (n: X | undefined, key: string): X[] => objs(n?.[key]);

const MADS = "http://www.loc.gov/mads/rdf/v1#";
const SKOS = "http://www.w3.org/2004/02/skos/core#";

/** Exported for tests. An id.loc.gov JSON-LD graph to an Author. */
export function graphToAuthor(id: string, graph: Graph): Author {
  const uri = `${IDS}/authorities/names/${id}`;
  const main = graph.find((n) => n["@id"] === uri || n["@id"] === `${uri}`.replace("https:", "http:"));
  const label = valuesOf(main, `${MADS}authoritativeLabel`).find((v) => !v["@language"] || v["@language"] === "und-latn")?.["@value"] as string | undefined;
  const heading = splitHeading(label ?? "");

  const rwoIds = idsOf(main, `${MADS}identifiesRWO`);
  const rwo = graph.find((n) => typeof n["@id"] === "string" && (n["@id"] as string).includes("/rwo/agents/"));
  const date = (key: string): string | undefined => valuesOf(rwo, `${MADS}${key}`)[0]?.["@value"] as string | undefined;

  const external = [...rwoIds, ...idsOf(main, `${MADS}hasExactExternalAuthority`), ...idsOf(main, `${MADS}hasCloseExternalAuthority`)];
  const identifiers: Record<string, string> = { lc_naf: id };
  const patterns: [string, RegExp][] = [
    ["wikidata", /wikidata\.org\/entity\/(Q\d+)/],
    ["viaf", /viaf\.org\/(?:en\/)?viaf\/(\d+)/],
    ["isni", /isni\.org\/isni\/(\d+)/],
    ["gnd", /d-nb\.info\/gnd\/([\w-]+)/],
  ];
  for (const [key, re] of patterns) {
    for (const url of external) {
      const m = re.exec(url);
      if (m && !identifiers[key]) identifiers[key] = m[1]!;
    }
  }

  const alternates = uniq(
    valuesOf(main, `${SKOS}altLabel`)
      .filter((v) => !v["@language"] || v["@language"] === "und-latn")
      .map((v) => splitHeading(String(v["@value"])).name),
  ).filter((n) => n !== heading.name);

  return {
    source: "loc",
    id,
    name: heading.name || "(unnamed)",
    alternateNames: alternates.length ? alternates.slice(0, 10) : undefined,
    birthDate: date("birthDate") ?? heading.birth,
    deathDate: date("deathDate") ?? heading.death,
    identifiers,
    sourceUrl: uri,
  };
}

const AUTHOR_ID = /^n[a-z]?\d{6,12}$/i;

export const locProvider: BookProvider = {
  id: "loc",
  name: "Library of Congress",
  strengths:
    "Open, keyless; cataloguer-quality records with publisher, date, ISBNs, LCCN and subject headings, plus name authorities for authors (dates, variants, VIAF/ISNI/Wikidata ids). American-leaning; each edition is its own record, so expect several per title.",
  isAvailable: () => true,

  async searchBooks(query) {
    try {
      const cql = buildCql(query);
      if (!cql) return [];
      if (query.isbn) return preferIsbn(await sru(cql, Math.max(query.limit, 5)), cleanIsbn(query.isbn)).slice(0, query.limit);
      return await sru(cql, query.limit);
    } catch (err) {
      return explain(err);
    }
  },

  async getBook(id) {
    try {
      const lower = id.toLowerCase();
      let cql: string;
      let isbn: string | undefined;
      if (lower.startsWith(ISBN_PREFIX)) {
        isbn = cleanIsbn(id.slice(ISBN_PREFIX.length));
        cql = `bath.isbn=${isbn}`;
      } else if (lower.startsWith(LCCN_PREFIX)) cql = `bath.lccn=${id.slice(LCCN_PREFIX.length).replace(/\s+/g, "")}`;
      else throw new HttpError(`"${id}" is not a Library of Congress id (expected lccn:<number> or isbn:<number>, as given by search_books).`);
      const found = await sru(cql, isbn ? 5 : 1);
      const [book] = isbn ? preferIsbn(found, isbn) : found;
      if (!book) throw new HttpError("The Library of Congress has no record with that ID (404).", 404);
      return book;
    } catch (err) {
      return explain(err);
    }
  },

  async searchAuthors(name, limit) {
    try {
      const params = new URLSearchParams({ q: name, count: String(Math.min(limit * 3, 30)), searchtype: "keyword" });
      const data = await paced(() => getJson<{ hits?: SuggestHit[] }>(`${IDS}/authorities/names/suggest2?${params}`));
      return (data.hits ?? [])
        .map(hitToAuthor)
        .filter((a): a is Author => !!a)
        .slice(0, limit);
    } catch (err) {
      return explain(err);
    }
  },

  async getAuthor(id) {
    try {
      if (!AUTHOR_ID.test(id)) throw new HttpError(`"${id}" is not a Library of Congress name authority id (expected something like n78095474).`);
      const graph = await paced(() => getJson<Graph>(`${IDS}/authorities/names/${id}.json`, { timeoutMs: 25_000 }));
      return graphToAuthor(id, graph);
    } catch (err) {
      return explain(err);
    }
  },
};
