import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { CITATION_STYLES, STYLES_WITH_PLACE, formatCitation } from "./lib/citation.js";
import { cleanIsbn, isValidIsbn } from "./lib/isbn.js";
import { buildLinks, loadSites } from "./lib/links.js";
import { availableProviders, getProvider, providers } from "./providers/index.js";
import type { Author, Book, BookProvider } from "./types.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const text = (t: string, structured?: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(structured ? { structuredContent: structured } : {}),
});

const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/** Turn thrown errors into a result the model can act on. */
async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function summary(b: Book): string {
  const by = b.authors.length ? ` by ${b.authors.join(", ")}` : "";
  const when = b.publishedDate ? ` (${b.publishedDate.slice(0, 4)})` : "";
  const isbn = b.isbn13 ?? b.isbn10;
  return `- **${b.title}**${by}${when}${isbn ? ` · ISBN ${isbn}` : ""} · \`${b.source}:${b.id}\``;
}

function detail(b: Book): string {
  const lines = [
    `# ${b.title}${b.subtitle ? `: ${b.subtitle}` : ""}`,
    b.authors.length ? `**Authors:** ${b.authors.join(", ")}` : "",
    b.publisher || b.publishedDate ? `**Published:** ${[b.publisher ? (b.place ? `${b.place}: ${b.publisher}` : b.publisher) : undefined, b.publishedDate].filter(Boolean).join(", ")}` : "",
    b.isbn13 || b.isbn10 ? `**ISBN:** ${[b.isbn13, b.isbn10].filter(Boolean).join(" / ")}` : "",
    b.pageCount ? `**Pages:** ${b.pageCount}` : "",
    b.language ? `**Language:** ${b.language}` : "",
    b.subjects?.length ? `**Subjects:** ${b.subjects.join("; ")}` : "",
    b.identifiers ? `**Identifiers:** ${Object.entries(b.identifiers).map(([k, v]) => `${k}: ${v}`).join("; ")}` : "",
    b.sourceUrl ? `**Source page:** ${b.sourceUrl}` : "",
    b.coverUrl ? `**Cover:** ${b.coverUrl}` : "",
    b.description ? `\n${b.description}` : "",
    `\n*From ${b.source}, id \`${b.id}\`*`,
  ];
  return lines.filter(Boolean).join("\n");
}

function lifeSpan(a: Author): string {
  if (a.birthDate && a.deathDate) return `${a.birthDate} – ${a.deathDate}`;
  if (a.birthDate) return `b. ${a.birthDate}`;
  if (a.deathDate) return `d. ${a.deathDate}`;
  return "";
}

function authorSummary(a: Author): string {
  const life = lifeSpan(a) ? ` (${lifeSpan(a)})` : "";
  const top = a.topWork ? ` · best known for *${a.topWork}*` : "";
  const count = a.workCount ? ` · ${a.workCount} works` : "";
  return `- **${a.name}**${life}${top}${count} · \`${a.source}:${a.id}\``;
}

function authorDetail(a: Author): string {
  const ids = a.identifiers ? Object.entries(a.identifiers).map(([k, v]) => `${k}: ${v}`).join("; ") : "";
  const lines = [
    `# ${a.name}`,
    lifeSpan(a) ? `**Life:** ${lifeSpan(a)}` : "",
    a.alternateNames?.length ? `**Also known as:** ${a.alternateNames.join("; ")}` : "",
    a.topWork ? `**Best known for:** ${a.topWork}` : "",
    a.workCount ? `**Works:** ${a.workCount}` : "",
    a.topSubjects?.length ? `**Subjects:** ${a.topSubjects.join("; ")}` : "",
    ids ? `**Identifiers:** ${ids}` : "",
    a.sourceUrl ? `**Source page:** ${a.sourceUrl}` : "",
    a.photoUrl ? `**Photo:** ${a.photoUrl}` : "",
    a.bio ? `\n${a.bio}` : "",
    `\n*From ${a.source}, id \`${a.id}\`*`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Providers that can answer author questions. */
function authorProviders(source: string | undefined): (BookProvider & Required<Pick<BookProvider, "searchAuthors" | "getAuthor">>)[] | string {
  const chosen = pickProviders(source);
  if (typeof chosen === "string") return chosen;
  const capable = chosen.filter(
    (p): p is BookProvider & Required<Pick<BookProvider, "searchAuthors" | "getAuthor">> => !!p.searchAuthors && !!p.getAuthor,
  );
  if (capable.length === 0) return source ? `Source "${source}" has no author records.` : "No available source has author records.";
  return capable;
}

function pickProviders(source: string | undefined, forBooks = false): BookProvider[] | string {
  if (source) {
    const p = getProvider(source);
    if (!p) return `Unknown source "${source}". Known sources: ${providers.map((x) => x.id).join(", ")}.`;
    if (!p.isAvailable()) return `Source "${source}" is not available. ${p.unavailableReason?.() ?? ""}`.trim();
    return [p];
  }
  const available = availableProviders().filter((p) => !forBooks || p.bookSearchByDefault !== false);
  if (available.length === 0) {
    return `No book sources are configured. ${providers.map((p) => `${p.id}: ${p.unavailableReason?.() ?? "unavailable"}`).join(" ")}`;
  }
  return available;
}

/** Fetch one book, by source:id or by ISBN across the available sources. */
async function resolveBook(args: { source?: string; id?: string; isbn?: string }): Promise<Book | string> {
  if (args.isbn) {
    if (!isValidIsbn(args.isbn)) return `"${args.isbn}" is not a valid ISBN-10 or ISBN-13 (checksum failed). Check for a typo.`;
    const chosen = pickProviders(args.source, true);
    if (typeof chosen === "string") return chosen;
    for (const p of chosen) {
      const hits = await p.searchBooks({ isbn: cleanIsbn(args.isbn), limit: 1 });
      if (hits[0]) return hits[0];
    }
    return `No book found for ISBN ${args.isbn}.`;
  }
  if (args.source && args.id) {
    const chosen = pickProviders(args.source);
    if (typeof chosen === "string") return chosen;
    return chosen[0]!.getBook(args.id);
  }
  return "Provide either an isbn, or both source and id (as shown in search_books results).";
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "list_sources",
    {
      description: "List the book data sources and whether each can be queried right now.",
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    async () =>
      text(
        providers
          .map((p) => `- \`${p.id}\` — ${p.name}: ${p.strengths} ${p.isAvailable() ? "**Available.**" : `**Unavailable.** ${p.unavailableReason?.() ?? ""}`}`)
          .join("\n"),
      ),
  );

  server.registerTool(
    "find_elsewhere",
    {
      description:
        "Get ready-made search links for shops, libraries and catalogues that have no usable API (Biblio, Bookshop.org UK, World of Books, WorldCat and others). Nothing is fetched: this returns URLs to open in a browser, so it is instant and costs no requests. Pass an ISBN for the most precise links, or a title and author. Sites can be added or changed in the user's links file.",
      inputSchema: z.object({
        isbn: z.string().optional().describe("ISBN-10 or ISBN-13; hyphens allowed"),
        title: z.string().optional().describe("Words from the title"),
        author: z.string().optional().describe("Author name"),
        query: z.string().optional().describe("Free-text search"),
        sites: z.array(z.string()).optional().describe("Only these site ids (for example [\"biblio\", \"worldcat\"]). Default: every site that can handle the input."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ isbn, title, author, query, sites }) =>
      guard(async () => {
        if (!isbn && !title && !author && !query) return fail("Give at least one of isbn, title, author or query.");
        if (isbn && !isValidIsbn(isbn)) return fail(`"${isbn}" is not a valid ISBN-10 or ISBN-13 (checksum failed). Check for a typo.`);
        const { sites: all, warnings } = loadSites();
        const wanted = sites?.length ? all.filter((s) => sites.includes(s.id)) : all;
        if (sites?.length && wanted.length === 0) return fail(`No site matches ${sites.join(", ")}. Available ids: ${all.map((s) => s.id).join(", ")}.`);
        const links = buildLinks(wanted, { isbn: isbn ? cleanIsbn(isbn) : undefined, title, author, text: query });
        if (links.length === 0) return fail("None of the selected sites can handle that input. Try an ISBN, or a title or author.");
        const lines = links.map((l) => `- [${l.name}](${l.url})${l.note ? ` — ${l.note}` : ""} · \`${l.id}\``);
        const note = warnings.length ? `\n\nLinks file: ${warnings.join(" ")}` : "";
        const disclosure = links.some((l) => l.affiliate) ? `\n\nLinks marked "(affiliate link)" earn the user a small commission. Say so wherever you share them.` : "";
        const marked = lines.map((line, i) => (links[i]!.affiliate ? `${line} (affiliate link)` : line));
        return text(`${marked.join("\n")}${disclosure}${note}`, { links, warnings });
      }),
  );

  server.registerTool(
    "search_books",
    {
      description:
        "Search for books by title, author, ISBN or free text. Combine fields to narrow results. Returns compact records with a `source:id` for get_book and format_citation.",
      inputSchema: z.object({
        query: z.string().optional().describe("Free-text search"),
        title: z.string().optional().describe("Words from the title"),
        author: z.string().optional().describe("Author name"),
        isbn: z.string().optional().describe("ISBN-10 or ISBN-13; hyphens allowed"),
        source: z.string().optional().describe("Restrict to one source id (see list_sources). Default: all general book sources; authority sources such as wikidata are used only when named."),
        limit: z.number().int().min(1).max(20).default(5).describe("Maximum results per source"),
      }),
      annotations: readOnly,
    },
    async ({ query, title, author, isbn, source, limit }) =>
      guard(async () => {
        if (!query && !title && !author && !isbn) return fail("Give at least one of query, title, author or isbn.");
        if (isbn && !isValidIsbn(isbn)) return fail(`"${isbn}" is not a valid ISBN-10 or ISBN-13 (checksum failed). Check for a typo.`);
        const chosen = pickProviders(source, true);
        if (typeof chosen === "string") return fail(chosen);

        const settled = await Promise.allSettled(
          chosen.map((p) => p.searchBooks({ text: query, title, author, isbn, limit })),
        );
        const books: Book[] = [];
        const problems: string[] = [];
        settled.forEach((r, i) => {
          if (r.status === "fulfilled") books.push(...r.value);
          else problems.push(`${chosen[i]!.id}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
        });

        if (books.length === 0 && problems.length === chosen.length) return fail(problems.join("\n"));
        const body = books.length ? books.map(summary).join("\n") : "No books found. Try fewer or broader terms.";
        const note = problems.length ? `\n\nSome sources failed:\n${problems.join("\n")}` : "";
        return text(body + note, { results: books });
      }),
  );

  server.registerTool(
    "get_book",
    {
      description: "Get full details for one book, by `source` + `id` or by ISBN.",
      inputSchema: z.object({
        source: z.string().optional().describe("Source id, from search_books"),
        id: z.string().optional().describe("Source-native id, from search_books"),
        isbn: z.string().optional().describe("ISBN-10 or ISBN-13, as an alternative to source + id"),
      }),
      annotations: readOnly,
    },
    async (args) =>
      guard(async () => {
        const book = await resolveBook(args);
        return typeof book === "string" ? fail(book) : text(detail(book), { book });
      }),
  );

  server.registerTool(
    "format_citation",
    {
      description:
        "Format a citation for a book in APA 7, MLA 9, Chicago 17 (bibliography entry), Harvard (Cite Them Right 12), BibTeX, Wikipedia (a {{cite book}} template for adding a source to an article), CSL-JSON (for Zotero and similar) or markdown (Kim's house format, with an ISBN search link and an Open Library work link). Harvard and markdown include the place of publication when the record has it (APA, MLA and Chicago 17th do not); markdown needs an ISBN lookup to get the Open Library work id. Author names are split naively, so check unusual names by eye. For an accurate edition (publisher, year) pass an ISBN: records found by title or author may be a work without edition details.",
      inputSchema: z.object({
        style: z.enum(CITATION_STYLES).describe("Citation style"),
        source: z.string().optional().describe("Source id, from search_books"),
        id: z.string().optional().describe("Source-native id, from search_books"),
        isbn: z.string().optional().describe("ISBN-10 or ISBN-13, as an alternative to source + id"),
        isbn_link_site: z
          .string()
          .optional()
          .describe("Markdown style only: which site the ISBN links to, by id from find_elsewhere (default biblio; worldcat also works)"),
      }),
      annotations: readOnly,
    },
    async ({ style, isbn_link_site, ...ref }) =>
      guard(async () => {
        const book = await resolveBook(ref);
        if (typeof book === "string") return fail(book);
        let isbnLink: string | undefined;
        const warnings: string[] = [];
        if (style === "markdown") {
          const isbn = book.isbn13 ?? book.isbn10;
          const wanted = isbn_link_site?.trim() || "biblio";
          const { sites } = loadSites();
          const site = sites.find((x) => x.id === wanted && x.isbnUrl);
          const link = isbn && site ? buildLinks([site], { isbn })[0] : undefined;
          if (link) isbnLink = link.url;
          if (link?.affiliate) warnings.push("the ISBN link is an affiliate link; say so wherever the citation is shared.");
          else if (isbn && !link) warnings.push(`no ISBN search link for site "${wanted}", so the ISBN is plain text.`);
          if (!book.identifiers?.openlibrary_work) warnings.push("no Open Library work id on this record, so that part is left out. Look the book up by ISBN to get it.");
        }
        const citation = formatCitation(book, style, { isbnLink });
        const missingPlace = STYLES_WITH_PLACE.includes(style) && book.publisher && !book.place;
        const note = missingPlace
          ? "\n\nNote: this record has no place of publication, so the citation omits it. Finding it needs an extra lookup; ask the user before making one."
          : "";
        const extra = warnings.length ? `\n\nNote: ${warnings.join(" ")}` : "";
        return text(citation + note + extra, { style, book });
      }),
  );

  server.registerTool(
    "search_authors",
    {
      description:
        "Search for authors by name. Returns life dates, best-known work and a `source:id` for get_author. Only sources with real author records are searched.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Author name, e.g. 'Ursula Le Guin'; spelling variants usually match"),
        source: z.string().optional().describe("Restrict to one source id (see list_sources)"),
        limit: z.number().int().min(1).max(20).default(5).describe("Maximum results per source"),
      }),
      annotations: readOnly,
    },
    async ({ name, source, limit }) =>
      guard(async () => {
        const chosen = authorProviders(source);
        if (typeof chosen === "string") return fail(chosen);
        const settled = await Promise.allSettled(chosen.map((p) => p.searchAuthors(name, limit)));
        const authors: Author[] = [];
        const problems: string[] = [];
        settled.forEach((r, i) => {
          if (r.status === "fulfilled") authors.push(...r.value);
          else problems.push(`${chosen[i]!.id}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
        });
        if (authors.length === 0 && problems.length === chosen.length) return fail(problems.join("\n"));
        const body = authors.length ? authors.map(authorSummary).join("\n") : "No authors found. Try a different spelling or fewer words.";
        const note = problems.length ? `\n\nSome sources failed:\n${problems.join("\n")}` : "";
        return text(body + note, { results: authors });
      }),
  );

  server.registerTool(
    "get_author",
    {
      description:
        "Get full details for one author: biography, name variants and identifiers in other systems (Wikidata, VIAF, ISNI, Library of Congress), useful for linking records across sources.",
      inputSchema: z.object({
        source: z.string().describe("Source id, from search_authors"),
        id: z.string().describe("Source-native author id, from search_authors"),
      }),
      annotations: readOnly,
    },
    async ({ source, id }) =>
      guard(async () => {
        const chosen = authorProviders(source);
        if (typeof chosen === "string") return fail(chosen);
        const author = await chosen[0]!.getAuthor(id);
        return text(authorDetail(author), { author });
      }),
  );
}
