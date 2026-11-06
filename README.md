# md-books-mcp

An [MCP](https://modelcontextprotocol.io) server for finding books and making citations, so agents can look up books and authors mentioned in notes. Runs locally over stdio. Built on the v2 TypeScript SDK, which implements the [2026-07-28 spec](https://modelcontextprotocol.io/specification/2026-07-28).

Sources are plugins. Open Library (no key) and Google Books (key needed) are built; others are planned (see below).

## Tools

- **`list_sources`**: which sources can be queried now, and why not if they can't.
- **`search_books`** `{ query?, title?, author?, isbn?, source?, limit? }`: compact results, each with a `source:id`.
- **`get_book`** `{ source, id }` or `{ isbn }`: full record.
- **`search_authors`** `{ name, source?, limit? }`: life dates, best-known work, work count. Only sources with real author records (currently Open Library) take part.
- **`get_author`** `{ source, id }`: bio, name variants and identifiers in other systems (Wikidata, VIAF, ISNI, Library of Congress, BookBrainz), which is how records from different sources will be joined.
- **`format_citation`** `{ style, source, id }` or `{ style, isbn }`: APA 7, MLA 9, Chicago or BibTeX. Author names are split by a simple rule (last word, plus particles like "Le" or "van"), so check unusual names by eye.

## Sources

| `source` id | Key | Notes |
| --- | --- | --- |
| `openlibrary` | none | Title and author searches return *works* (first-publication year, no publisher or ISBN). An ISBN lookup returns the specific *edition* with publisher and date, so use an ISBN when you need a citation. Optional: set `OPENLIBRARY_CONTACT` (an email or URL) to be identified and get a higher rate limit. |
| `loc` | none | Library of Congress. Cataloguer-quality *edition* records (publisher, date, ISBNs, LCCN, subject headings, page count) and name authorities for authors (full dates, variant names, VIAF, ISNI, Wikidata and GND ids). Titles come in cataloguing case ("The dispossessed"). American-leaning, and each edition is its own record, so expect several per title; the best match for an ISBN comes first. Ids are `lccn:<number>` or `isbn:<number>`. |
| `wikidata` | none | Authority data: author identifiers (VIAF, ISNI, Library of Congress, Open Library, BookBrainz), plus notable works and editions that link to Open Library ids. Strict rate limits, so it is left out of default book searches: ask for it with `source: "wikidata"`. Author searches include it. No ISBN search. Optional `WIKIDATA_CONTACT`. |
| `hardcover` | required (free) | Community catalogue, good on recent and genre fiction. Needs `HARDCOVER_API_KEY` (Hardcover account → Settings → Hardcover API → New API Key; the `read:catalog` scope is enough). Free tier: 60 requests a minute, 5,000 a day. Searches return works; lookups by id add the default print edition's publisher and ISBNs. Written from the docs and not yet run against the live API. Hardcover's terms bar using the API to train publicly available or commercial LLMs, and bar commercial use of user data; this server only reads catalogue data, for personal use. |
| `googlebooks` | required | Editions with publisher, ISBNs, descriptions and covers. |

Book searches without a `source` fan out to every available general source (not `wikidata`). Author searches fan out to every source that has author records.

## Setup

Open Library works with no setup. Google Books needs an API key. Keyless requests share a quota of zero, so they fail with a 429.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project, enable the **Books API**, and create an API key.
2. Pass it to the server in your MCP client's `env` block. A bare `.env` file is not loaded.

```bash
npm install && npm run build
claude mcp add books -e GOOGLE_BOOKS_API_KEY=your-key -e HARDCOVER_API_KEY=your-key -- node /Users/kimplowright/Development/md-books-mcp/dist/index.js
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "books": {
      "command": "node",
      "args": ["/Users/kimplowright/Development/md-books-mcp/dist/index.js"],
      "env": { "GOOGLE_BOOKS_API_KEY": "your-key", "HARDCOVER_API_KEY": "your-key" }
    }
  }
}
```

Try it with the Inspector: `npm run inspect`.

## Adding a source

1. Copy `src/providers/googlebooks.ts` to `src/providers/yoursource.ts`.
2. Implement `BookProvider` (see `src/types.ts`): `id`, `name`, `strengths`, `isAvailable()`, `searchBooks()`, `getBook()`. Map the source's shape onto `Book`.
3. Import it and add it to the list in `src/providers/index.ts`.

Tools, citations and the search fan-out pick it up with no other changes. A source whose `isAvailable()` is false (a missing key, say) is skipped quietly and explained by `list_sources`.

## Planned sources

| Source | Notes |
| --- | --- |
| BookBrainz | Open metadata; check API status first. |
| WorldCat, ISBNdb | Paid or institutional keys. |
| Biblio, Bookshop.org, World of Books | No public API found; terms need checking before any scraping. |

Author tools are optional on a source (`searchAuthors` and `getAuthor` on `BookProvider`). Google Books only has authors as a field on books, so it doesn't implement them.

## Development

```bash
npm test        # unit tests, no network
npm run build
```
