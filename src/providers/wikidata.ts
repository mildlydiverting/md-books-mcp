import { getJson, HttpError } from "../lib/http.js";
import { VERSION } from "../version.js";
import type { Author, Book, BookProvider, BookQuery } from "../types.js";

const API = "https://www.wikidata.org/w/api.php";
const CONTACT_ENV = "WIKIDATA_CONTACT";
const MAX_IDS_PER_CALL = 50;

// Verified against the live API on 2026-11-04.
const HUMAN = "Q5";
/** Classes that mean "this item is a book": book, literary work, edition, novel, written work, comic. */
const BOOK_CLASSES = new Set(["Q571", "Q7725634", "Q3331189", "Q8261", "Q47461344", "Q1004"]);
const P = {
  instanceOf: "P31",
  author: "P50",
  publicationDate: "P577",
  isbn13: "P212",
  isbn10: "P957",
  publisher: "P123",
  title: "P1476",
  pages: "P1104",
  openLibrary: "P648",
  birth: "P569",
  death: "P570",
  viaf: "P214",
  isni: "P213",
  gnd: "P227",
  lcNaf: "P244",
  bookBrainzAuthor: "P2607",
  image: "P18",
} as const;

interface Snak {
  datavalue?: { value: unknown };
}
interface Entity {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
  claims?: Record<string, { mainsnak: Snak }[]>;
  sitelinks?: Record<string, { title: string }>;
  missing?: string;
}
interface TimeValue {
  time: string;
  precision: number;
}

function headers(): Record<string, string> {
  const contact = process.env[CONTACT_ENV]?.trim();
  return { "User-Agent": `md-books-mcp/${VERSION}${contact ? ` (${contact})` : ""}` };
}

/** Wikidata asks for serial requests, so every call waits its turn and leaves a short gap. */
const GAP_MS = 500;
const RETRY_AFTER_429_MS = 3000;
let queue: Promise<unknown> = Promise.resolve();

function api<T>(params: Record<string, string>): Promise<T> {
  const search = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const fetchOnce = (): Promise<T> => getJson<T>(`${API}?${search}`, { headers: headers() });
  const run = queue.then(async () => {
    try {
      return await fetchOnce();
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 429)) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_429_MS));
      return fetchOnce();
    }
  });
  queue = run.then(
    () => new Promise((resolve) => setTimeout(resolve, GAP_MS)),
    () => new Promise((resolve) => setTimeout(resolve, GAP_MS)),
  );
  return run;
}

/** Fetch entities in batches of 50. Missing entities are dropped. */
async function getEntities(ids: string[], props: string): Promise<Entity[]> {
  const unique = [...new Set(ids)];
  const out: Entity[] = [];
  for (let i = 0; i < unique.length; i += MAX_IDS_PER_CALL) {
    const batch = unique.slice(i, i + MAX_IDS_PER_CALL);
    const data = await api<{ entities?: Record<string, Entity> }>({
      action: "wbgetentities",
      ids: batch.join("|"),
      props,
      languages: "en",
      languagefallback: "1",
    });
    out.push(...Object.values(data.entities ?? {}).filter((e) => !e.missing));
  }
  return out;
}

async function searchIds(text: string, limit: number): Promise<string[]> {
  const data = await api<{ search?: { id: string }[] }>({
    action: "wbsearchentities",
    search: text,
    language: "en",
    uselang: "en",
    type: "item",
    limit: String(Math.min(limit, 50)),
  });
  return (data.search ?? []).map((s) => s.id);
}

// --- claim readers (exported for tests) ---------------------------------------

function values(e: Entity, prop: string): unknown[] {
  return (e.claims?.[prop] ?? []).map((c) => c.mainsnak.datavalue?.value).filter((v) => v !== undefined);
}

export function entityIds(e: Entity, prop: string): string[] {
  return values(e, prop).flatMap((v) => (typeof v === "object" && v !== null && "id" in v ? [String((v as { id: string }).id)] : []));
}

export function strings(e: Entity, prop: string): string[] {
  return values(e, prop).filter((v): v is string => typeof v === "string");
}

/** Wikidata dates carry a precision: 9 = year, 10 = month, 11 = day. Coarser than year is dropped. */
export function formatTime(v: unknown): string | undefined {
  const t = v as TimeValue | undefined;
  if (!t?.time || t.precision < 9) return undefined;
  const m = /^([+-])(\d{4,})-(\d{2})-(\d{2})/.exec(t.time);
  if (!m) return undefined;
  const year = m[1] === "-" ? `-${m[2]}` : String(Number(m[2]));
  if (t.precision === 9) return year;
  if (t.precision === 10) return `${year}-${m[3]}`;
  return `${year}-${m[3]}-${m[4]}`;
}

const firstTime = (e: Entity, prop: string): string | undefined => formatTime(values(e, prop)[0]);
const label = (e: Entity): string | undefined => e.labels?.en?.value ?? Object.values(e.labels ?? {})[0]?.value;
const url = (id: string): string => `https://www.wikidata.org/wiki/${id}`;

/** Exported for tests. */
export function entityToAuthor(e: Entity): Author {
  const ids: Record<string, string> = { wikidata: e.id };
  const set = (k: string, prop: string): void => {
    const v = strings(e, prop)[0];
    if (v) ids[k] = v;
  };
  set("viaf", P.viaf);
  set("isni", P.isni);
  set("lc_naf", P.lcNaf);
  set("gnd", P.gnd);
  set("openlibrary", P.openLibrary);
  set("bookbrainz", P.bookBrainzAuthor);
  const image = strings(e, P.image)[0];
  const wiki = e.sitelinks?.enwiki?.title;
  return {
    source: "wikidata",
    id: e.id,
    name: label(e) ?? "(unnamed)",
    alternateNames: e.aliases?.en?.map((a) => a.value).slice(0, 10),
    birthDate: firstTime(e, P.birth),
    deathDate: firstTime(e, P.death),
    // Wikidata has no biography; this is its one-line description.
    bio: e.descriptions?.en?.value,
    identifiers: ids,
    photoUrl: image ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image)}?width=300` : undefined,
    sourceUrl: wiki ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wiki.replace(/ /g, "_"))}` : url(e.id),
  };
}

/** Exported for tests. `names` maps QIDs to labels for authors and publishers. */
export function entityToBook(e: Entity, names: Map<string, string>): Book {
  const name = (id: string): string => names.get(id) ?? id;
  const ol = strings(e, P.openLibrary)[0];
  const pages = Number(values(e, P.pages).map((v) => (typeof v === "object" && v && "amount" in v ? (v as { amount: string }).amount : v))[0]);
  return {
    source: "wikidata",
    id: e.id,
    title: label(e) ?? "(untitled)",
    authors: entityIds(e, P.author).map(name),
    publisher: entityIds(e, P.publisher).map(name)[0],
    publishedDate: firstTime(e, P.publicationDate),
    isbn13: strings(e, P.isbn13)[0],
    isbn10: strings(e, P.isbn10)[0],
    description: e.descriptions?.en?.value,
    pageCount: Number.isFinite(pages) && pages > 0 ? pages : undefined,
    identifiers: ol ? { wikidata: e.id, openlibrary: ol } : { wikidata: e.id },
    sourceUrl: url(e.id),
  };
}

async function resolveNames(entities: Entity[]): Promise<Map<string, string>> {
  const ids = entities.flatMap((e) => [...entityIds(e, P.author), ...entityIds(e, P.publisher)]);
  const found = ids.length ? await getEntities(ids, "labels") : [];
  return new Map(found.map((e) => [e.id, label(e) ?? e.id]));
}

const isBook = (e: Entity): boolean => entityIds(e, P.instanceOf).some((c) => BOOK_CLASSES.has(c));
const isHuman = (e: Entity): boolean => entityIds(e, P.instanceOf).includes(HUMAN);

function explain(err: unknown): never {
  if (err instanceof HttpError && err.status === 429) {
    throw new HttpError(`Wikidata rate limit hit (429). Wait a moment and retry; setting ${CONTACT_ENV} identifies you and helps.`, 429);
  }
  if (err instanceof HttpError && err.status && err.status >= 500) {
    throw new HttpError(`Wikidata had a server problem (${err.status}). Retry in a moment.`, err.status);
  }
  throw err;
}

const isQid = (id: string): boolean => /^Q\d+$/.test(id);

export const wikidataProvider: BookProvider = {
  id: "wikidata",
  name: "Wikidata",
  strengths:
    "Open, keyless authority data: author identifiers (VIAF, ISNI, Library of Congress, Open Library, BookBrainz) and notable works and editions. Coverage is uneven and ISBN search is not supported; best for identifying who or what a note means.",
  // Strict rate limits and heavy responses: ask for it by name.
  bookSearchByDefault: false,
  isAvailable: () => true,

  async searchBooks(query: BookQuery) {
    if (query.isbn) return []; // Wikidata stores ISBNs with inconsistent hyphenation; no reliable exact lookup.
    try {
      const text = [query.title, query.text].filter(Boolean).join(" ") || query.author;
      if (!text) return [];
      const ids = await searchIds(text, query.limit * 4);
      const books = (await getEntities(ids, "labels|descriptions|claims")).filter(isBook);
      const names = await resolveNames(books);
      let results = books.map((e) => entityToBook(e, names));
      if (query.author && (query.title || query.text)) {
        const wanted = query.author.toLowerCase();
        results = results.filter((b) => b.authors.some((a) => a.toLowerCase().includes(wanted) || wanted.includes(a.toLowerCase())));
      }
      return results.slice(0, query.limit);
    } catch (err) {
      return explain(err);
    }
  },

  async getBook(id) {
    try {
      if (!isQid(id)) throw new HttpError(`"${id}" is not a Wikidata item id (expected something like Q2008211).`);
      const [entity] = await getEntities([id], "labels|descriptions|claims");
      if (!entity) throw new HttpError("Wikidata has no item with that id (404).", 404);
      return entityToBook(entity, await resolveNames([entity]));
    } catch (err) {
      return explain(err);
    }
  },

  async searchAuthors(name, limit) {
    try {
      const ids = await searchIds(name, limit * 4);
      const people = (await getEntities(ids, "labels|descriptions|aliases|claims|sitelinks")).filter(isHuman);
      return people.slice(0, limit).map(entityToAuthor);
    } catch (err) {
      return explain(err);
    }
  },

  async getAuthor(id) {
    try {
      if (!isQid(id)) throw new HttpError(`"${id}" is not a Wikidata item id (expected something like Q181659).`);
      const [entity] = await getEntities([id], "labels|descriptions|aliases|claims|sitelinks");
      if (!entity) throw new HttpError("Wikidata has no item with that id (404).", 404);
      return entityToAuthor(entity);
    } catch (err) {
      return explain(err);
    }
  },
};
