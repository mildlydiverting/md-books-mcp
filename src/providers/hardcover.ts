import { HttpError, postJson } from "../lib/http.js";
import { cleanIsbn } from "../lib/isbn.js";
import type { Author, Book, BookProvider, BookQuery } from "../types.js";

// Written from Hardcover's published docs (docs.hardcover.app); not yet run against the live API.

const ENDPOINT = "https://api.hardcover.app/v1/graphql";
const TOKEN_ENV = "HARDCOVER_API_TOKEN";
const SITE = "https://hardcover.app";

interface HcImage {
  url?: string;
}
/** A Typesense hit's `document` for a book search. */
interface HcBookDoc {
  id?: string | number;
  title?: string;
  subtitle?: string;
  author_names?: string[];
  release_year?: number;
  isbns?: string[];
  description?: string;
  pages?: number;
  genres?: string[];
  image?: HcImage;
  slug?: string;
}
interface HcAuthorDoc {
  id?: string | number;
  name?: string;
  alternate_names?: string[];
  books?: string[];
  books_count?: number;
  image?: HcImage;
  slug?: string;
}
interface HcBookRecord {
  id: number;
  title?: string;
  subtitle?: string;
  slug?: string;
  description?: string;
  release_date?: string;
  release_year?: number;
  pages?: number;
  cached_image?: HcImage;
  contributions?: { author?: { name?: string } }[];
  default_physical_edition?: { isbn_10?: string; isbn_13?: string; pages?: number; release_date?: string; publisher?: { name?: string } } | null;
}
interface HcAuthorRecord {
  id: number;
  name?: string;
  slug?: string;
  bio?: string;
  born_date?: string;
  born_year?: number;
  death_date?: string;
  death_year?: number;
  books_count?: number;
  alternate_names?: string[];
  location?: string;
  identifiers?: Record<string, unknown>;
  cached_image?: HcImage;
}
interface GqlResponse<T> {
  data?: T;
  errors?: { message?: string }[] | string[];
}

function token(): string | undefined {
  const raw = process.env[TOKEN_ENV]?.trim();
  // Accept the token pasted with or without its "Bearer " prefix.
  return raw ? raw.replace(/^Bearer\s+/i, "") : undefined;
}

// --- mapping (exported for tests) ----------------------------------------------

const slugUrl = (kind: "books" | "authors", slug?: string): string | undefined => (slug ? `${SITE}/${kind}/${slug}` : undefined);

/** Pick an ISBN-13/10 from a list, preferring the one the caller asked about. */
function pickIsbns(isbns: string[] | undefined, wanted?: string): { isbn10?: string; isbn13?: string } {
  const clean = (isbns ?? []).map(cleanIsbn);
  const w = wanted ? cleanIsbn(wanted) : undefined;
  if (w && clean.includes(w)) return w.length === 13 ? { isbn13: w } : { isbn10: w };
  return {}; // A book's ISBN list spans every edition; without a match, don't pick one arbitrarily.
}

export function searchDocToBook(d: HcBookDoc, wantedIsbn?: string): Book {
  const id = String(d.id ?? "");
  return {
    source: "hardcover",
    id,
    title: d.title ?? "(untitled)",
    subtitle: d.subtitle || undefined,
    authors: d.author_names ?? [],
    // Release year of the work, not of an edition: no publisher.
    publishedDate: d.release_year ? String(d.release_year) : undefined,
    ...pickIsbns(d.isbns, wantedIsbn),
    description: d.description,
    subjects: d.genres,
    pageCount: d.pages || undefined,
    coverUrl: d.image?.url,
    identifiers: { hardcover: id },
    sourceUrl: slugUrl("books", d.slug),
  };
}

export function recordToBook(r: HcBookRecord): Book {
  const ed = r.default_physical_edition ?? undefined;
  const authors = (r.contributions ?? []).map((c) => c.author?.name).filter((n): n is string => !!n);
  return {
    source: "hardcover",
    id: String(r.id),
    title: r.title ?? "(untitled)",
    subtitle: r.subtitle || undefined,
    authors: [...new Set(authors)],
    publisher: ed?.publisher?.name,
    publishedDate: ed?.release_date ?? r.release_date ?? (r.release_year ? String(r.release_year) : undefined),
    isbn10: ed?.isbn_10 ?? undefined,
    isbn13: ed?.isbn_13 ?? undefined,
    description: r.description,
    pageCount: ed?.pages ?? r.pages ?? undefined,
    coverUrl: r.cached_image?.url,
    identifiers: { hardcover: String(r.id) },
    sourceUrl: slugUrl("books", r.slug),
  };
}

export function authorDocToAuthor(d: HcAuthorDoc): Author {
  return {
    source: "hardcover",
    id: String(d.id ?? ""),
    name: d.name ?? "(unnamed)",
    alternateNames: d.alternate_names?.slice(0, 10),
    workCount: d.books_count,
    topWork: d.books?.[0],
    photoUrl: d.image?.url,
    sourceUrl: slugUrl("authors", d.slug),
  };
}

export function authorRecordToAuthor(r: HcAuthorRecord): Author {
  const ids: Record<string, string> = { hardcover: String(r.id) };
  for (const [k, v] of Object.entries(r.identifiers ?? {})) {
    if (typeof v === "string" || typeof v === "number") ids[k.toLowerCase()] = String(v);
  }
  const place = r.location ? ` Based in ${r.location}.` : "";
  return {
    source: "hardcover",
    id: String(r.id),
    name: r.name ?? "(unnamed)",
    alternateNames: r.alternate_names?.slice(0, 10),
    birthDate: r.born_date ?? (r.born_year ? String(r.born_year) : undefined),
    deathDate: r.death_date ?? (r.death_year ? String(r.death_year) : undefined),
    bio: r.bio ? `${r.bio}${place}` : place.trim() || undefined,
    workCount: r.books_count,
    identifiers: ids,
    photoUrl: r.cached_image?.url,
    sourceUrl: slugUrl("authors", r.slug),
  };
}

/** Free-text query for Hardcover's Typesense search (title, ISBN, series and author names are all searched). */
export function buildSearchText(q: BookQuery): string {
  return [q.isbn ? cleanIsbn(q.isbn) : undefined, q.title, q.author, q.text].filter(Boolean).join(" ");
}

/** The `results` scalar is Typesense's response; tolerate it arriving as a JSON string. */
export function hitsOf<T>(results: unknown): T[] {
  const parsed = typeof results === "string" ? (JSON.parse(results) as unknown) : results;
  const hits = (parsed as { hits?: { document?: T }[] } | undefined)?.hits ?? [];
  return hits.map((h) => h.document).filter((d): d is T => d !== undefined);
}

// --- transport ------------------------------------------------------------------

function explain(err: unknown): never {
  if (err instanceof HttpError) {
    switch (err.status) {
      case 400:
      case 401:
        throw new HttpError(
          `Hardcover rejected the token (${err.status}). Check ${TOKEN_ENV}: tokens expire, and may be reset during the API beta. Create a new one under Account Settings → Hardcover API.`,
          err.status,
        );
      case 403:
        throw new HttpError(`Hardcover refused the request (403). The token probably lacks the read:catalog scope.`, 403);
      case 408:
        throw new HttpError("Hardcover timed out (408). Searches are limited to 2 seconds; try a shorter or more specific query.", 408);
      case 429:
        throw new HttpError(
          "Hardcover rate limit hit (429): free tokens allow 60 requests a minute and 5,000 a day. Wait a minute and retry.",
          429,
        );
      default:
        if (err.status && err.status >= 500) throw new HttpError(`Hardcover had a server problem (${err.status}). Retry in a moment.`, err.status);
    }
  }
  throw err;
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const t = token();
  if (!t) throw new HttpError(`Hardcover needs ${TOKEN_ENV} to be set.`);
  const res = await postJson<GqlResponse<T>>(ENDPOINT, { query, variables }, { headers: { authorization: `Bearer ${t}` } });
  if (res.errors?.length) {
    const first = res.errors[0];
    const msg = typeof first === "string" ? first : (first?.message ?? "unknown error");
    throw new HttpError(`Hardcover returned an error: ${msg}`);
  }
  if (!res.data) throw new HttpError("Hardcover returned no data.");
  return res.data;
}

const SEARCH = `query ($q: String!, $type: String!, $n: Int!) { search(query: $q, query_type: $type, per_page: $n, page: 1) { results } }`;

const BOOK = `query ($id: Int!) {
  books(where: { id: { _eq: $id } }, limit: 1) {
    id title subtitle slug description release_date release_year pages cached_image
    contributions(where: { contributor_role: { slug: { _eq: "author" } } }) { author { name } }
    default_physical_edition { isbn_10 isbn_13 pages release_date publisher { name } }
  }
}`;

const AUTHOR = `query ($id: Int!) {
  authors(where: { id: { _eq: $id } }, limit: 1) {
    id name slug bio born_date born_year death_date death_year books_count alternate_names location identifiers cached_image
  }
}`;

function numericId(id: string, what: string): number {
  if (!/^\d+$/.test(id)) throw new HttpError(`"${id}" is not a Hardcover ${what} id (expected a number, from search results).`);
  return Number(id);
}

export const hardcoverProvider: BookProvider = {
  id: "hardcover",
  name: "Hardcover",
  strengths:
    "Community catalogue (a Goodreads alternative): good on recent and genre fiction, series, genres and author records. Searches return works; a lookup by id adds the default print edition's publisher and ISBNs.",
  isAvailable: () => token() !== undefined,
  unavailableReason: () =>
    `Set ${TOKEN_ENV} (free: Hardcover account → Settings → Hardcover API → New API Key; the read:catalog scope is enough) in the MCP client's env block.`,

  async searchBooks(query) {
    try {
      const data = await gql<{ search: { results: unknown } }>(SEARCH, { q: buildSearchText(query), type: "Book", n: query.limit });
      return hitsOf<HcBookDoc>(data.search.results).map((d) => searchDocToBook(d, query.isbn));
    } catch (err) {
      return explain(err);
    }
  },

  async getBook(id) {
    try {
      const data = await gql<{ books: HcBookRecord[] }>(BOOK, { id: numericId(id, "book") });
      const record = data.books[0];
      if (!record) throw new HttpError("Hardcover has no book with that id (404).", 404);
      return recordToBook(record);
    } catch (err) {
      return explain(err);
    }
  },

  async searchAuthors(name, limit) {
    try {
      const data = await gql<{ search: { results: unknown } }>(SEARCH, { q: name, type: "Author", n: limit });
      return hitsOf<HcAuthorDoc>(data.search.results).map(authorDocToAuthor);
    } catch (err) {
      return explain(err);
    }
  },

  async getAuthor(id) {
    try {
      const data = await gql<{ authors: HcAuthorRecord[] }>(AUTHOR, { id: numericId(id, "author") });
      const record = data.authors[0];
      if (!record) throw new HttpError("Hardcover has no author with that id (404).", 404);
      return authorRecordToAuthor(record);
    } catch (err) {
      return explain(err);
    }
  },
};
