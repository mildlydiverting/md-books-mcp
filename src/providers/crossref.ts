import { getJson, HttpError } from "../lib/http.js";
import { cleanIsbn, isValidIsbn10, isValidIsbn13 } from "../lib/isbn.js";
import { createPacer } from "../lib/pace.js";
import { VERSION } from "../version.js";
import type { Book, BookProvider, BookQuery } from "../types.js";

/**
 * Crossref: DOI registry metadata. Strong on academic and university-press books
 * (monographs, edited volumes, reference works); thin on trade books. Chapters are
 * left out: a Book has no container to cite them against.
 */
const BASE = "https://api.crossref.org";
/** Optional email. Crossref gives a faster "polite pool" to clients that identify themselves. */
const CONTACT_ENV = "CROSSREF_CONTACT";
const BOOK_TYPES = ["book", "monograph", "edited-book", "reference-book"];
const TYPE_FILTER = BOOK_TYPES.map((t) => `type:${t}`).join(",");
const SELECT = "DOI,title,subtitle,author,editor,publisher,issued,ISBN,type,abstract,subject,URL";

const contact = (): string | undefined => process.env[CONTACT_ENV]?.trim() || undefined;
// Public pool: about 1 request a second. Polite pool: considerably more.
const paced = createPacer(() => (contact() ? 200 : 1100));

interface CrPerson {
  given?: string;
  family?: string;
  name?: string;
}
export interface CrWork {
  DOI: string;
  type?: string;
  title?: string[];
  subtitle?: string[];
  author?: CrPerson[];
  editor?: CrPerson[];
  publisher?: string;
  issued?: { "date-parts"?: (number | null)[][] };
  ISBN?: string[];
  abstract?: string;
  subject?: string[];
  URL?: string;
}
interface CrList {
  status?: string;
  message?: { items?: CrWork[] } | { type?: string; message?: string }[];
}

const personName = (p: CrPerson): string | undefined => p.name ?? ([p.given, p.family].filter(Boolean).join(" ") || undefined);

/** Crossref dates are [year, month, day] parts. Publishers who only know the year often deposit 31 December. */
function dateOf(work: CrWork): string | undefined {
  const [y, m, d] = work.issued?.["date-parts"]?.[0] ?? [];
  if (!y) return undefined;
  if (!m || (m === 12 && d === 31)) return String(y);
  const mm = String(m).padStart(2, "0");
  return d ? `${y}-${mm}-${String(d).padStart(2, "0")}` : `${y}-${mm}`;
}

const stripTags = (s: string): string =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Exported for tests. */
export function workToBook(w: CrWork): Book {
  const people = w.author?.length ? w.author : (w.editor ?? []);
  const isbns = (w.ISBN ?? []).map(cleanIsbn);
  const abstract = w.abstract ? stripTags(w.abstract) : undefined;
  return {
    source: "crossref",
    id: w.DOI,
    title: w.title?.[0] ?? "(untitled)",
    subtitle: w.subtitle?.[0],
    authors: people.map(personName).filter((n): n is string => !!n),
    publisher: w.publisher,
    publishedDate: dateOf(w),
    isbn10: isbns.find(isValidIsbn10),
    isbn13: isbns.find(isValidIsbn13),
    description: abstract || undefined,
    subjects: w.subject?.length ? w.subject.slice(0, 10) : undefined,
    identifiers: { doi: w.DOI },
    sourceUrl: w.URL ?? `https://doi.org/${w.DOI}`,
  };
}

/** Query parameters for a works search. Exported for tests. */
export function buildParams(query: BookQuery): URLSearchParams {
  const params = new URLSearchParams({ rows: String(query.limit), select: SELECT });
  if (query.isbn) {
    params.set("filter", `isbn:${cleanIsbn(query.isbn)},${TYPE_FILTER}`);
  } else {
    params.set("filter", TYPE_FILTER);
    const bibliographic = [query.title, query.text].filter(Boolean).join(" ") || query.author;
    if (bibliographic) params.set("query.bibliographic", bibliographic);
    if (query.author && query.title) params.set("query.author", query.author);
  }
  const email = contact();
  if (email) params.set("mailto", email);
  return params;
}

const headers = (): Record<string, string> => {
  const email = contact();
  return { "User-Agent": `md-books-mcp/${VERSION} (MCP server${email ? `; mailto:${email}` : ""})` };
};

/** Accepts a bare DOI, "doi:10...." or a doi.org link. Exported for tests. */
export function normaliseDoi(id: string): string | undefined {
  const doi = id.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)/i, "");
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : undefined;
}

function explain(err: unknown): never {
  if (err instanceof HttpError) {
    if (err.status === 404) throw new HttpError("Crossref has no record for that DOI (404). DOIs come from search_books results.", 404);
    if (err.status === 429)
      throw new HttpError(`Crossref rate limit hit (429). Wait a few seconds and retry; setting ${CONTACT_ENV} to your email moves requests to its faster polite pool.`, 429);
    if (err.status && err.status >= 500) throw new HttpError(`Crossref had a server problem (${err.status}). Retry in a moment.`, err.status);
  }
  throw err;
}

export const crossrefProvider: BookProvider = {
  id: "crossref",
  name: "Crossref",
  strengths:
    "Open, keyless DOI registry: academic and university-press books (monographs, edited volumes, reference works) with publisher, date, ISBNs and DOI. Thin on trade books and noisy for general searches, so it is only used when asked for by name.",
  // Fuzzy matching returns a lot of study guides and unrelated titles for popular books.
  bookSearchByDefault: false,
  isAvailable: () => true,

  async searchBooks(query) {
    try {
      const data = await paced(() => getJson<CrList>(`${BASE}/works?${buildParams(query)}`, { headers: headers() }));
      if (data.status && data.status !== "ok") {
        const detail = Array.isArray(data.message) ? data.message[0]?.message : undefined;
        throw new HttpError(`Crossref rejected the query${detail ? `: ${detail}` : ""}.`);
      }
      const items = Array.isArray(data.message) ? [] : (data.message?.items ?? []);
      return items.map(workToBook);
    } catch (err) {
      return explain(err);
    }
  },

  async getBook(id) {
    try {
      const doi = normaliseDoi(id);
      if (!doi) throw new HttpError(`"${id}" is not a DOI (expected something like 10.1017/CBO9780511810633).`);
      const email = contact();
      const url = `${BASE}/works/${encodeURI(doi)}${email ? `?mailto=${encodeURIComponent(email)}` : ""}`;
      const data = await paced(() => getJson<{ message?: CrWork }>(url, { headers: headers() }));
      if (!data.message) throw new HttpError("Crossref sent a record this server could not read.");
      return workToBook(data.message);
    } catch (err) {
      return explain(err);
    }
  },
};
