/** Source-agnostic book record. Every source maps its own shape onto this. */
export interface Book {
  /** Provider id, e.g. "googlebooks". */
  source: string;
  /** Provider-native identifier, always a string. */
  id: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisher?: string;
  /** Place of publication ("London"), only when the source already gives it. Never fetched separately. */
  place?: string;
  /** As the source gives it: "2003", "2003-05" or "2003-05-14". */
  publishedDate?: string;
  isbn10?: string;
  isbn13?: string;
  description?: string;
  subjects?: string[];
  pageCount?: number;
  /** BCP-47 / ISO 639-1 code, e.g. "en". */
  language?: string;
  coverUrl?: string;
  /** Ids for the same book in other systems, keyed by scheme (wikidata, openlibrary...). */
  identifiers?: Record<string, string>;
  /** Page for this book on the source's own site. */
  sourceUrl?: string;
}

/** Source-agnostic author record. */
export interface Author {
  source: string;
  id: string;
  name: string;
  alternateNames?: string[];
  /** As the source gives it; formats vary ("21 October 1929", "1929"). */
  birthDate?: string;
  deathDate?: string;
  bio?: string;
  /** Most notable work, when the source says. */
  topWork?: string;
  workCount?: number;
  topSubjects?: string[];
  /**
   * Identifiers in other systems, keyed by scheme: wikidata, viaf, isni, lc_naf,
   * bookbrainz... These are what let records from different sources be joined.
   */
  identifiers?: Record<string, string>;
  photoUrl?: string;
  sourceUrl?: string;
}

/** What a caller can ask a provider for. At least one field is set. */
export interface BookQuery {
  /** Free text, matched however the source sees fit. */
  text?: string;
  title?: string;
  author?: string;
  isbn?: string;
  limit: number;
}

/**
 * The plugin contract. To add a source: write one file in src/providers/
 * that exports a BookProvider, then add it to the list in providers/index.ts.
 */
export interface BookProvider {
  readonly id: string;
  readonly name: string;
  /** One line shown by list_sources: what this source is good for. */
  readonly strengths: string;
  /**
   * Set false for authority sources that should only answer book searches when asked
   * for by name (source: "..."), not in the default fan-out. Defaults to true.
   */
  readonly bookSearchByDefault?: boolean;
  /** Whether it can be queried right now, e.g. a required key is present. */
  isAvailable(): boolean;
  /** Shown by list_sources when isAvailable() is false. */
  unavailableReason?(): string;
  searchBooks(query: BookQuery): Promise<Book[]>;
  getBook(id: string): Promise<Book>;
  /** Optional: only sources with real author records implement these. */
  searchAuthors?(name: string, limit: number): Promise<Author[]>;
  getAuthor?(id: string): Promise<Author>;
}
