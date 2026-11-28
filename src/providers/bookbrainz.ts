import { getJson, HttpError } from "../lib/http.js";
import { cleanIsbn, isValidIsbn10, isValidIsbn13 } from "../lib/isbn.js";
import { toTwoLetterLanguage } from "../lib/lang.js";
import { createPacer } from "../lib/pace.js";
import { VERSION } from "../version.js";
import type { Author, Book, BookProvider, BookQuery } from "../types.js";
import { readEnv } from "../lib/env.js";

/**
 * BookBrainz: open (CC0) community book metadata from MetaBrainz. Strong on author
 * identifiers and on editions that other catalogues lack. Its search matches names only
 * (no ISBN search), and search hits carry no authors or publishers, so the top few hits
 * are filled in from edition and author lookups.
 */
const BASE = "https://api.bookbrainz.org/1";
const SITE = "https://bookbrainz.org";
const CONTACT_ENV = "BOOKBRAINZ_CONTACT";
/** Search hits that get a follow-up lookup. Keeps a search to at most this many extra requests. */
const MAX_HYDRATE = 5;
const GAP_MS = 700;
const BBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const paced = createPacer(() => GAP_MS);

interface BbAlias {
  name?: string;
  sortName?: string;
}
interface BbSearchHit {
  bbid: string;
  entityType?: string;
  defaultAlias?: BbAlias;
}
interface BbSearch {
  searchResult?: BbSearchHit[];
}
export interface BbEdition {
  bbid: string;
  defaultAlias?: BbAlias;
  authorCredits?: { names?: { name?: string }[] } | null;
  publishers?: { name?: string }[];
  releaseEventDate?: string | null;
  pages?: number | null;
  languages?: string[];
}
export interface BbAuthor {
  bbid: string;
  authorType?: string;
  defaultAlias?: BbAlias;
  beginDate?: string | null;
  endDate?: string | null;
}
interface BbIdentifiers {
  identifiers?: { type?: string; value?: string }[];
}

/** "+001929-10-21" becomes "1929-10-21"; "+002014" becomes "2014". Exported for tests. */
export function bbDate(raw: string | null | undefined): string | undefined {
  const m = /^\+?(\d{4,6})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(raw ?? "");
  if (!m) return undefined;
  return [String(parseInt(m[1]!, 10)), m[2], m[3]].filter(Boolean).join("-");
}

/** Exported for tests. */
export function editionToBook(e: BbEdition, ids?: BbIdentifiers): Book {
  const isbns = (ids?.identifiers ?? [])
    .filter((i) => /^isbn/i.test(i.type ?? ""))
    .map((i) => cleanIsbn(i.value ?? ""));
  return {
    source: "bookbrainz",
    id: e.bbid,
    title: e.defaultAlias?.name ?? "(untitled)",
    authors: (e.authorCredits?.names ?? []).map((n) => n.name).filter((n): n is string => !!n),
    publisher: e.publishers?.[0]?.name,
    publishedDate: bbDate(e.releaseEventDate),
    isbn10: isbns.find(isValidIsbn10),
    isbn13: isbns.find(isValidIsbn13),
    pageCount: e.pages ?? undefined,
    language: toTwoLetterLanguage(e.languages?.[0]),
    identifiers: { bookbrainz: e.bbid },
    sourceUrl: `${SITE}/edition/${e.bbid}`,
  };
}

const IDENTIFIER_KEYS: Record<string, string> = {
  "wikidata id": "wikidata",
  viaf: "viaf",
  isni: "isni",
  "openlibrary author id": "openlibrary",
  "goodreads author id": "goodreads",
  "librarything author": "librarything",
  "musicbrainz artist id": "musicbrainz",
};

/** Exported for tests. */
export function authorToAuthor(a: BbAuthor, ids?: BbIdentifiers): Author {
  const identifiers: Record<string, string> = { bookbrainz: a.bbid };
  for (const i of ids?.identifiers ?? []) {
    const key = IDENTIFIER_KEYS[(i.type ?? "").toLowerCase()];
    const value = i.value?.trim();
    if (key && value && !identifiers[key]) identifiers[key] = key === "isni" ? value.replace(/\s+/g, "") : value;
  }
  return {
    source: "bookbrainz",
    id: a.bbid,
    name: a.defaultAlias?.name ?? "(unnamed)",
    birthDate: bbDate(a.beginDate),
    deathDate: bbDate(a.endDate),
    identifiers,
    sourceUrl: `${SITE}/author/${a.bbid}`,
  };
}

const headers = (): Record<string, string> => {
  const contact = readEnv(CONTACT_ENV);
  return { "User-Agent": `md-books-mcp/${VERSION} (MCP server${contact ? `; ${contact}` : ""})` };
};

const get = <T>(path: string): Promise<T> => paced(() => getJson<T>(`${BASE}${path}`, { headers: headers() }));

/** Exported for tests. */
export function searchText(query: BookQuery): string {
  return [query.title, query.author, query.text].filter(Boolean).join(" ").trim();
}

function explain(err: unknown): never {
  if (err instanceof HttpError) {
    if (err.status === 404) throw new HttpError("BookBrainz has no record with that id (404). Ids come from search results.", 404);
    if (err.status === 429) throw new HttpError("BookBrainz rate limit hit (429). Wait a few seconds and retry.", 429);
    if (err.status && err.status >= 500) throw new HttpError(`BookBrainz had a server problem (${err.status}). Retry in a moment.`, err.status);
  }
  throw err;
}

const checkId = (id: string, what: string): void => {
  if (!BBID.test(id)) throw new HttpError(`"${id}" is not a BookBrainz ${what} id (expected a UUID such as e66704df-2386-4af9-9b02-a3440a1bc828).`);
};

/** Look up each hit in turn; a hit whose lookup fails keeps its search-result fields. */
async function hydrate<T, R>(hits: BbSearchHit[], lookup: (id: string) => Promise<T>, fallback: (h: BbSearchHit) => R, map: (d: T) => R): Promise<R[]> {
  const out: R[] = [];
  for (const [i, h] of hits.entries()) {
    if (i >= MAX_HYDRATE) {
      out.push(fallback(h));
      continue;
    }
    try {
      out.push(map(await lookup(h.bbid)));
    } catch {
      out.push(fallback(h));
    }
  }
  return out;
}

export const bookBrainzProvider: BookProvider = {
  id: "bookbrainz",
  name: "BookBrainz",
  strengths:
    "Open (CC0) community database: author identifiers (Wikidata, VIAF, ISNI, Open Library, Goodreads) and dates, plus editions with publisher, date and ISBN. Search matches names only (no ISBN search) and coverage is uneven, so it is only used when asked for by name.",
  bookSearchByDefault: false,
  isAvailable: () => true,

  async searchBooks(query) {
    // BookBrainz cannot search by ISBN.
    const q = query.isbn ? "" : searchText(query);
    if (!q) return [];
    try {
      const params = new URLSearchParams({ q, type: "edition", size: String(query.limit) });
      const found = await get<BbSearch>(`/search?${params}`);
      return await hydrate(
        found.searchResult ?? [],
        (id) => get<BbEdition>(`/edition/${id}`),
        (h) => editionToBook({ bbid: h.bbid, defaultAlias: h.defaultAlias }),
        (e) => editionToBook(e),
      );
    } catch (err) {
      return explain(err);
    }
  },

  async getBook(id) {
    try {
      checkId(id, "edition");
      const edition = await get<BbEdition>(`/edition/${id}`);
      const ids = await get<BbIdentifiers>(`/edition/${id}/identifiers`).catch(() => undefined);
      return editionToBook(edition, ids);
    } catch (err) {
      return explain(err);
    }
  },

  async searchAuthors(name, limit) {
    try {
      const params = new URLSearchParams({ q: name, type: "author", size: String(limit) });
      const found = await get<BbSearch>(`/search?${params}`);
      return await hydrate(
        found.searchResult ?? [],
        (id) => get<BbAuthor>(`/author/${id}`),
        (h) => authorToAuthor({ bbid: h.bbid, defaultAlias: h.defaultAlias }),
        (a) => authorToAuthor(a),
      );
    } catch (err) {
      return explain(err);
    }
  },

  async getAuthor(id) {
    try {
      checkId(id, "author");
      const author = await get<BbAuthor>(`/author/${id}`);
      const ids = await get<BbIdentifiers>(`/author/${id}/identifiers`).catch(() => undefined);
      return authorToAuthor(author, ids);
    } catch (err) {
      return explain(err);
    }
  },
};
