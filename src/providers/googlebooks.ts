import { getJson, HttpError } from "../lib/http.js";
import { cleanIsbn } from "../lib/isbn.js";
import type { Book, BookProvider, BookQuery } from "../types.js";
import { readEnv } from "../lib/env.js";

const API_BASE = "https://www.googleapis.com/books/v1";
const KEY_ENV = "GOOGLE_BOOKS_API_KEY";
/** The API's own cap on maxResults. */
const MAX_RESULTS = 40;

interface GbVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    industryIdentifiers?: { type: string; identifier: string }[];
    pageCount?: number;
    categories?: string[];
    language?: string;
    imageLinks?: Record<string, string>;
    canonicalVolumeLink?: string;
    infoLink?: string;
  };
}

interface GbList {
  totalItems?: number;
  items?: GbVolume[];
}

function apiKey(): string | undefined {
  const key = readEnv(KEY_ENV);
  return key ? key : undefined;
}

/** Google serves covers over http and adds a page-curl effect; undo both. */
function tidyCover(url: string | undefined): string | undefined {
  return url?.replace(/^http:/, "https:").replace("&edge=curl", "");
}

/** Exported for tests. */
export function toBook(v: GbVolume): Book {
  const info = v.volumeInfo ?? {};
  const ids = info.industryIdentifiers ?? [];
  const links = info.imageLinks ?? {};
  return {
    source: "googlebooks",
    id: v.id,
    title: info.title ?? "(untitled)",
    subtitle: info.subtitle,
    authors: info.authors ?? [],
    publisher: info.publisher,
    publishedDate: info.publishedDate,
    isbn10: ids.find((i) => i.type === "ISBN_10")?.identifier,
    isbn13: ids.find((i) => i.type === "ISBN_13")?.identifier,
    description: info.description,
    subjects: info.categories,
    pageCount: info.pageCount,
    language: info.language,
    coverUrl: tidyCover(links.thumbnail ?? links.smallThumbnail),
    sourceUrl: info.canonicalVolumeLink ?? info.infoLink,
  };
}

/** Quote a value for a Google Books field operator such as intitle:"...". */
function quoted(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

/** Exported for tests. */
export function buildQ(query: BookQuery): string {
  const parts: string[] = [];
  if (query.isbn) parts.push(`isbn:${cleanIsbn(query.isbn)}`);
  if (query.title) parts.push(`intitle:${quoted(query.title)}`);
  if (query.author) parts.push(`inauthor:${quoted(query.author)}`);
  if (query.text) parts.push(query.text);
  return parts.join(" ");
}

function explain(err: unknown): never {
  if (err instanceof HttpError) {
    switch (err.status) {
      case 400:
        throw new HttpError(`Google Books rejected the query (400). Simplify it: drop quotes or special characters.`, 400);
      case 403:
        throw new HttpError(
          `Google Books refused the key (403). Check that the Books API is enabled for the key's Google Cloud project and that the key has no restrictions that exclude it.`,
          403,
        );
      case 404:
        throw new HttpError(`Google Books has no volume with that ID (404). IDs come from search_books results.`, 404);
      case 429:
        throw new HttpError(
          `Google Books quota exceeded (429). The daily quota for this key is used up; try again tomorrow or use another source.`,
          429,
        );
      default:
        if (err.status && err.status >= 500) {
          throw new HttpError(`Google Books had a server problem (${err.status}). Retry in a moment.`, err.status);
        }
    }
  }
  throw err;
}

function url(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  const key = apiKey();
  if (key) search.set("key", key);
  return `${API_BASE}${path}?${search.toString()}`;
}

export const googleBooksProvider: BookProvider = {
  id: "googlebooks",
  name: "Google Books",
  strengths: "Broad commercial coverage, ISBN lookup, descriptions and covers; weaker on authority data.",

  // Keyless requests now share a project quota of zero, so a key is required.
  isAvailable: () => apiKey() !== undefined,
  unavailableReason: () =>
    `Set ${KEY_ENV} (free: create an API key in Google Cloud and enable the Books API) in the MCP client's env block.`,

  async searchBooks(query) {
    try {
      const data = await getJson<GbList>(
        url("/volumes", {
          q: buildQ(query),
          maxResults: String(Math.min(query.limit, MAX_RESULTS)),
          printType: "books",
        }),
      );
      return (data.items ?? []).map(toBook);
    } catch (err) {
      return explain(err);
    }
  },

  async getBook(id) {
    try {
      return toBook(await getJson<GbVolume>(url(`/volumes/${encodeURIComponent(id)}`, {})));
    } catch (err) {
      return explain(err);
    }
  },
};
