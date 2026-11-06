import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as z from "zod/v4";

/**
 * Search links for sites that have no API (or whose API we cannot use): the server fills in
 * a URL template and hands back the link. Nothing is fetched, so there is no scraping, no
 * bot-check problem and no token cost; the person (or an agent with a browser) opens the link.
 *
 * Templates may use {isbn}, {title}, {author} and {query} (title and author together, or the
 * free text). Values are URL-encoded. Add or change sites in a JSON file; see README.
 */

export interface LinkSite {
  id: string;
  name: string;
  note?: string;
  /** Used when an ISBN is given. */
  isbnUrl?: string;
  /** Used for title, author or free-text searches. */
  queryUrl?: string;
}

export interface LinkInput {
  isbn?: string;
  title?: string;
  author?: string;
  text?: string;
}

export interface SiteLink {
  id: string;
  name: string;
  note?: string;
  url: string;
}

/** Built-in sites. Patterns marked unverified were blocked to scripts by a bot check, so confirm them in a browser. */
export const DEFAULT_SITES: LinkSite[] = [
  { id: "biblio", name: "Biblio (UK)", note: "New, used and rare books from independent sellers", isbnUrl: "https://biblio.co.uk/booksearch/keyisbn/{isbn}" },
  { id: "bookshop-uk", name: "Bookshop.org (UK)", note: "New books; supports independent shops", isbnUrl: "https://uk.bookshop.org/beta-search?bkshp-astro=t&keywords={isbn}", queryUrl: "https://uk.bookshop.org/beta-search?bkshp-astro=t&keywords={query}" },
  { id: "worldofbooks", name: "World of Books", note: "Cheap used books (UK)", isbnUrl: "https://www.worldofbooks.com/en-gb/search?query={isbn}", queryUrl: "https://www.worldofbooks.com/en-gb/search?query={query}" },
  { id: "oxfam", name: "Oxfam Online Shop", note: "Second-hand books; proceeds go to Oxfam (unverified pattern)", isbnUrl: "https://onlineshop.oxfam.org.uk/searchresults?Ntt={isbn}", queryUrl: "https://onlineshop.oxfam.org.uk/searchresults?Ntt={query}" },
  { id: "worldcat", name: "WorldCat", note: "Which libraries hold it (unverified pattern)", isbnUrl: "https://search.worldcat.org/search?q=bn%3A{isbn}", queryUrl: "https://search.worldcat.org/search?q={query}" },
  { id: "openlibrary", name: "Open Library", note: "Editions, borrowing from the Internet Archive", isbnUrl: "https://openlibrary.org/isbn/{isbn}", queryUrl: "https://openlibrary.org/search?q={query}" },
  { id: "googlebooks", name: "Google Books", note: "Previews and where to buy", isbnUrl: "https://books.google.com/books?vid=ISBN{isbn}", queryUrl: "https://www.google.com/search?tbm=bks&q={query}" },
  { id: "hardcover", name: "Hardcover", note: "Community catalogue and shelves (unverified pattern)", isbnUrl: "https://hardcover.app/search?q={isbn}", queryUrl: "https://hardcover.app/search?q={query}" },
  { id: "bookbrainz", name: "BookBrainz", note: "Open database; name search only", queryUrl: "https://bookbrainz.org/search?q={query}" },
];

// --- user file --------------------------------------------------------------------

const httpUrl = z.string().refine((u) => /^https?:\/\/[^\s]+$/i.test(u), "must be an http(s) URL with no spaces");
const siteSchema = z.object({
  id: z.string().min(1).regex(/^[\w-]+$/, "letters, numbers, _ and - only"),
  name: z.string().min(1).optional(),
  note: z.string().optional(),
  isbnUrl: httpUrl.optional(),
  queryUrl: httpUrl.optional(),
  /** Set true to hide a built-in site. */
  disabled: z.boolean().optional(),
});
const fileSchema = z.array(siteSchema);

export const LINKS_FILE_ENV = "MD_BOOKS_LINKS_FILE";
export const defaultLinksFile = (): string => join(homedir(), ".config", "md-books-mcp", "links.json");

export interface LoadedSites {
  sites: LinkSite[];
  /** Problems with the user file, for the tool to show. Never thrown. */
  warnings: string[];
}

/**
 * Merge a user file's JSON text over the built-in sites: same id replaces, new id adds,
 * `disabled: true` removes. Exported for tests.
 */
export function mergeSites(json: string | undefined, defaults: LinkSite[] = DEFAULT_SITES): LoadedSites {
  const warnings: string[] = [];
  const byId = new Map(defaults.map((s) => [s.id, s]));
  if (json !== undefined) {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return { sites: [...byId.values()], warnings: ["links file is not valid JSON, so only the built-in sites are shown."] };
    }
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        sites: [...byId.values()],
        warnings: [`links file ignored: ${first ? `${first.path.join(".") || "(top level)"} ${first.message}` : "invalid"}. It should be a JSON array of sites.`],
      };
    }
    for (const entry of parsed.data) {
      if (entry.disabled) {
        byId.delete(entry.id);
        continue;
      }
      const base = byId.get(entry.id);
      const site: LinkSite = {
        id: entry.id,
        name: entry.name ?? base?.name ?? entry.id,
        note: entry.note ?? base?.note,
        isbnUrl: entry.isbnUrl ?? base?.isbnUrl,
        queryUrl: entry.queryUrl ?? base?.queryUrl,
      };
      if (!site.isbnUrl && !site.queryUrl) {
        warnings.push(`site "${entry.id}" has neither isbnUrl nor queryUrl, so it was skipped.`);
        continue;
      }
      byId.set(entry.id, site);
    }
  }
  return { sites: [...byId.values()], warnings };
}

/** Read the user's links file, if there is one. Called on each use so edits apply without a restart. */
export function loadSites(): LoadedSites {
  const path = process.env[LINKS_FILE_ENV]?.trim() || defaultLinksFile();
  let json: string | undefined;
  try {
    json = readFileSync(path, "utf8");
  } catch (err) {
    // A missing file is normal. Any other read problem is worth a warning.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      const loaded = mergeSites(undefined);
      return { ...loaded, warnings: [`could not read ${path}: ${(err as Error).message}`] };
    }
  }
  return mergeSites(json);
}

// --- expansion ----------------------------------------------------------------------

const enc = encodeURIComponent;

/** Fill a template. Unused placeholders become empty strings. Exported for tests. */
export function fillTemplate(template: string, values: { isbn: string; title: string; author: string; query: string }): string {
  return template
    .replaceAll("{isbn}", enc(values.isbn))
    .replaceAll("{title}", enc(values.title))
    .replaceAll("{author}", enc(values.author))
    .replaceAll("{query}", enc(values.query));
}

/**
 * Links for each site that can handle this input. With an ISBN a site needs an isbnUrl; with text it
 * needs a queryUrl. When both are given, a site with an isbnUrl uses it. Exported for tests.
 */
export function buildLinks(sites: LinkSite[], input: LinkInput): SiteLink[] {
  const isbn = input.isbn?.replace(/[\s-]/g, "") ?? "";
  const title = input.title?.trim() ?? "";
  const author = input.author?.trim() ?? "";
  const query = [title, author, input.text?.trim() ?? ""].filter(Boolean).join(" ") || isbn;
  const values = { isbn, title, author, query };
  const hasText = Boolean(title || author || input.text?.trim());

  const links: SiteLink[] = [];
  for (const site of sites) {
    // A site only gets an ISBN link if it has an isbnUrl: a title search form may not understand ISBNs.
    const template = isbn && site.isbnUrl ? site.isbnUrl : hasText ? site.queryUrl : undefined;
    if (!template) continue;
    links.push({ id: site.id, name: site.name, note: site.note, url: fillTemplate(template, values) });
  }
  return links;
}
