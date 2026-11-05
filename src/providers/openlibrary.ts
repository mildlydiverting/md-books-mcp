import { getJson, HttpError } from "../lib/http.js";
import { cleanIsbn } from "../lib/isbn.js";
import { VERSION } from "../version.js";
import type { Author, Book, BookProvider, BookQuery } from "../types.js";

const BASE = "https://openlibrary.org";
const COVERS = "https://covers.openlibrary.org/b/id";
/** Optional. Open Library gives a higher rate limit to clients that say who they are. */
const CONTACT_ENV = "OPENLIBRARY_CONTACT";
const SEARCH_FIELDS = "key,title,subtitle,author_name,first_publish_year,cover_i,subject,language,number_of_pages_median";
/** Edition ids are "isbn:<number>"; anything else is a work id such as OL45804W. */
const ISBN_PREFIX = "isbn:";

interface OlDoc {
  key: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  subject?: string[];
  language?: string[];
  number_of_pages_median?: number;
}
interface OlSearch {
  docs?: OlDoc[];
}
interface OlWork {
  title?: string;
  description?: string | { value?: string };
  subjects?: string[];
  covers?: number[];
}
interface OlEdition {
  url?: string;
  title?: string;
  subtitle?: string;
  authors?: { name: string }[];
  number_of_pages?: number;
  publishers?: { name: string }[];
  publish_date?: string;
  subjects?: { name: string }[];
  identifiers?: { isbn_10?: string[]; isbn_13?: string[] };
  cover?: { medium?: string; large?: string };
}

interface OlAuthorSearchDoc {
  key: string;
  name?: string;
  alternate_names?: string[];
  birth_date?: string;
  death_date?: string;
  top_work?: string;
  work_count?: number;
  top_subjects?: string[];
}
interface OlAuthorSearch {
  docs?: OlAuthorSearchDoc[];
}
interface OlAuthor {
  name?: string;
  alternate_names?: string[];
  birth_date?: string;
  death_date?: string;
  bio?: string | { value?: string };
  remote_ids?: Record<string, string>;
  photos?: number[];
  wikipedia?: string;
}

function headers(): Record<string, string> {
  const contact = process.env[CONTACT_ENV]?.trim();
  return { "User-Agent": `md-books-mcp/${VERSION}${contact ? ` (${contact})` : ""}` };
}

const workId = (key: string): string => key.replace(/^\/works\//, "");

/** Exported for tests. A work: a book as an idea, not a particular printing. */
export function workToBook(doc: OlDoc): Book {
  return {
    source: "openlibrary",
    id: workId(doc.key),
    title: doc.title ?? "(untitled)",
    subtitle: doc.subtitle,
    authors: doc.author_name ?? [],
    // First publication year, not an edition: no publisher, no ISBN.
    publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : undefined,
    subjects: doc.subject?.slice(0, 10),
    pageCount: doc.number_of_pages_median,
    coverUrl: doc.cover_i ? `${COVERS}/${doc.cover_i}-M.jpg` : undefined,
    sourceUrl: `${BASE}${doc.key}`,
  };
}

/** Exported for tests. A specific edition, found by ISBN. */
export function editionToBook(isbn: string, e: OlEdition): Book {
  return {
    source: "openlibrary",
    id: `${ISBN_PREFIX}${isbn}`,
    title: e.title ?? "(untitled)",
    subtitle: e.subtitle,
    authors: (e.authors ?? []).map((a) => a.name),
    publisher: e.publishers?.[0]?.name,
    publishedDate: e.publish_date,
    isbn10: e.identifiers?.isbn_10?.[0],
    isbn13: e.identifiers?.isbn_13?.[0],
    subjects: e.subjects?.slice(0, 10).map((s) => s.name),
    pageCount: e.number_of_pages,
    coverUrl: e.cover?.medium ?? e.cover?.large,
    sourceUrl: e.url?.replace(/^http:/, "https:"),
  };
}

const authorSourceUrl = (id: string): string => `${BASE}/authors/${id}`;

/** Exported for tests. */
export function authorSearchDocToAuthor(d: OlAuthorSearchDoc): Author {
  const id = d.key.replace(/^\/authors\//, "");
  return {
    source: "openlibrary",
    id,
    name: d.name ?? "(unnamed)",
    alternateNames: d.alternate_names?.slice(0, 10),
    birthDate: d.birth_date,
    deathDate: d.death_date,
    topWork: d.top_work,
    workCount: d.work_count,
    topSubjects: d.top_subjects?.slice(0, 8),
    sourceUrl: authorSourceUrl(id),
  };
}

/** Exported for tests. */
export function authorToAuthor(id: string, a: OlAuthor): Author {
  const bio = typeof a.bio === "string" ? a.bio : a.bio?.value;
  const photo = a.photos?.find((n) => n > 0);
  return {
    source: "openlibrary",
    id,
    name: a.name ?? "(unnamed)",
    alternateNames: a.alternate_names?.slice(0, 10),
    birthDate: a.birth_date,
    deathDate: a.death_date,
    bio,
    identifiers: a.remote_ids && Object.keys(a.remote_ids).length ? a.remote_ids : undefined,
    photoUrl: photo ? `https://covers.openlibrary.org/b/id/${photo}-M.jpg` : undefined,
    sourceUrl: authorSourceUrl(id),
  };
}

/** Exported for tests. */
export function buildQ(query: BookQuery): string {
  const q = (v: string) => `"${v.replace(/"/g, "")}"`;
  const parts: string[] = [];
  if (query.title) parts.push(`title:${q(query.title)}`);
  if (query.author) parts.push(`author:${q(query.author)}`);
  if (query.text) parts.push(query.text);
  return parts.join(" ");
}

function explain(err: unknown): never {
  if (err instanceof HttpError) {
    if (err.status === 404) throw new HttpError("Open Library has no record with that ID (404). IDs come from search_books results.", 404);
    if (err.status === 429)
      throw new HttpError(`Open Library rate limit hit (429). Wait a moment and retry; setting ${CONTACT_ENV} raises the limit.`, 429);
    if (err.status && err.status >= 500) throw new HttpError(`Open Library had a server problem (${err.status}). Retry in a moment.`, err.status);
  }
  throw err;
}

async function editionByIsbn(isbn: string): Promise<Book | undefined> {
  const key = `ISBN:${isbn}`;
  const data = await getJson<Record<string, OlEdition>>(
    `${BASE}/api/books?bibkeys=${encodeURIComponent(key)}&jscmd=data&format=json`,
    { headers: headers() },
  );
  const edition = data[key];
  return edition ? editionToBook(isbn, edition) : undefined;
}

export const openLibraryProvider: BookProvider = {
  id: "openlibrary",
  name: "Open Library",
  strengths:
    "Open, keyless; strong on editions and ISBNs. ISBN lookups give edition-accurate records (publisher, date); other searches return works, with first-publication year only.",
  isAvailable: () => true,

  async searchBooks(query) {
    try {
      if (query.isbn) {
        const book = await editionByIsbn(cleanIsbn(query.isbn));
        return book ? [book] : [];
      }
      const params = new URLSearchParams({ q: buildQ(query), limit: String(query.limit), fields: SEARCH_FIELDS });
      const data = await getJson<OlSearch>(`${BASE}/search.json?${params}`, { headers: headers() });
      return (data.docs ?? []).map(workToBook);
    } catch (err) {
      return explain(err);
    }
  },

  async getBook(id) {
    try {
      if (id.toLowerCase().startsWith(ISBN_PREFIX)) {
        const book = await editionByIsbn(cleanIsbn(id.slice(ISBN_PREFIX.length)));
        if (!book) throw new HttpError("Open Library has no edition with that ISBN (404).", 404);
        return book;
      }
      if (!/^OL\d+W$/.test(id)) throw new HttpError(`"${id}" is not an Open Library work id (expected something like OL45804W) or isbn:<number>.`);
      const searchParams = new URLSearchParams({ q: `key:/works/${id}`, limit: "1", fields: SEARCH_FIELDS });
      const [work, found] = await Promise.all([
        getJson<OlWork>(`${BASE}/works/${id}.json`, { headers: headers() }),
        getJson<OlSearch>(`${BASE}/search.json?${searchParams}`, { headers: headers() }),
      ]);
      const doc = found.docs?.[0] ?? { key: `/works/${id}`, title: work.title };
      const book = workToBook(doc);
      const description = typeof work.description === "string" ? work.description : work.description?.value;
      return {
        ...book,
        title: book.title === "(untitled)" ? (work.title ?? book.title) : book.title,
        description,
        subjects: work.subjects?.slice(0, 10) ?? book.subjects,
        coverUrl: book.coverUrl ?? (work.covers?.[0] ? `${COVERS}/${work.covers[0]}-M.jpg` : undefined),
      };
    } catch (err) {
      return explain(err);
    }
  },

  async searchAuthors(name, limit) {
    try {
      const params = new URLSearchParams({ q: name, limit: String(limit) });
      const data = await getJson<OlAuthorSearch>(`${BASE}/search/authors.json?${params}`, { headers: headers() });
      return (data.docs ?? []).map(authorSearchDocToAuthor);
    } catch (err) {
      return explain(err);
    }
  },

  async getAuthor(id) {
    try {
      if (!/^OL\d+A$/.test(id)) throw new HttpError(`"${id}" is not an Open Library author id (expected something like OL31353A).`);
      const [record, found] = await Promise.all([
        getJson<OlAuthor>(`${BASE}/authors/${id}.json`, { headers: headers() }),
        // The search index holds the work count, top work and subjects; the record does not.
        getJson<OlAuthorSearch>(`${BASE}/search/authors.json?${new URLSearchParams({ q: `key:/authors/${id}`, limit: "1" })}`, {
          headers: headers(),
        }).catch(() => ({ docs: [] }) as OlAuthorSearch),
      ]);
      const extra = found.docs?.[0] ? authorSearchDocToAuthor(found.docs[0]) : undefined;
      return {
        ...authorToAuthor(id, record),
        topWork: extra?.topWork,
        workCount: extra?.workCount,
        topSubjects: extra?.topSubjects,
      };
    } catch (err) {
      return explain(err);
    }
  },
};
