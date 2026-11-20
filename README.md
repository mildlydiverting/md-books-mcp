# md-books-mcp

An [MCP](https://modelcontextprotocol.io) server for finding books and making citations, so agents can look up books and authors mentioned in notes. Runs locally over stdio. Built on the v2 TypeScript SDK, which implements the [2026-07-28 spec](https://modelcontextprotocol.io/specification/2026-07-28).

Sources are plugins. Open Library (no key) and Google Books (key needed) are built; others are planned (see below).

## Tools

- **`list_sources`**: which sources can be queried now, and why not if they can't.
- **`search_books`** `{ query?, title?, author?, isbn?, source?, limit? }`: compact results, each with a `source:id`.
- **`get_book`** `{ source, id }` or `{ isbn }`: full record.
- **`search_authors`** `{ name, source?, limit? }`: life dates, best-known work, work count. Only sources with real author records (currently Open Library) take part.
- **`get_author`** `{ source, id }`: bio, name variants and identifiers in other systems (Wikidata, VIAF, ISNI, Library of Congress, BookBrainz), which is how records from different sources will be joined.
- **`find_elsewhere`** `{ isbn }` or `{ title, author }`: ready-made search links for shops, libraries and catalogues with no usable API (Biblio, Bookshop.org UK, World of Books, WorldCat and more). Nothing is fetched, so it is instant; the links open in a browser. See *Search links* below
- **`format_citation`** `{ style, source, id }` or `{ style, isbn }`: eight styles.
  - `apa` (APA 7), `mla` (MLA 9), `chicago` (17th edition bibliography entry), `harvard` (Cite Them Right 12th edition), `bibtex`. These four are made by [Citation.js](https://citation.js.org) running the official [CSL](https://citationstyles.org) style files in `csl/`, so they follow the published styles, print edition statements, and handle authorless and many-author books properly. BibTeX is our own.
  - `wikipedia`: a `{{cite book}}` template, for adding a source to a Wikipedia article (not for citing Wikipedia). Includes the Open Library edition id as `ol=` when known.
  - `csl-json`: a one-item [CSL-JSON](https://github.com/citation-style-language/schema#csl-json-schema) array, for Zotero and similar.
  - `markdown`: a house format, `Surname, Firstnames (yyyy) _Title_. \[edition\]. Place: Publisher. [ISBN](search link) Open Library: [OL…W](work link)`. The ISBN links to Biblio by default; pass `isbn_link_site` (`worldcat` also works) to change it. Parts the record lacks are left out.
  - Harvard and markdown print the place of publication (APA, MLA and Chicago 17th do not) when the record already has it (Open Library editions, Library of Congress, Crossref); the server never makes a request just to find it, and tells the agent to ask you first if it is missing.
  - The Open Library work id and edition statement come from an ISBN lookup (one small extra request inside the server). Look books up by ISBN for the fullest result; Library of Congress records add an edition statement when the catalogue has one.
  - Author names are split by a simple rule (last word, plus particles like "Le" or "van"), so check unusual names by eye.

## Sources

| `source` id | Key | Notes |
| --- | --- | --- |
| `openlibrary` | none | Title and author searches return *works* (first-publication year, no publisher or ISBN). An ISBN lookup returns the specific *edition* with publisher and date, so use an ISBN when you need a citation. Optional: set `OPENLIBRARY_CONTACT` (an email or URL) to be identified and get a higher rate limit. |
| `loc` | none | Library of Congress. Cataloguer-quality *edition* records (publisher, date, ISBNs, LCCN, subject headings, page count) and name authorities for authors (full dates, variant names, VIAF, ISNI, Wikidata and GND ids). Titles come in cataloguing case ("The dispossessed"). American-leaning, and each edition is its own record, so expect several per title; the best match for an ISBN comes first. Ids are `lccn:<number>` or `isbn:<number>`. |
| `wikidata` | none | Authority data: author identifiers (VIAF, ISNI, Library of Congress, Open Library, BookBrainz), plus notable works and editions that link to Open Library ids. Strict rate limits, so it is left out of default book searches: ask for it with `source: "wikidata"`. Author searches include it. No ISBN search. Optional `WIKIDATA_CONTACT`. |
| `hardcover` | required (free) | Community catalogue, good on recent and genre fiction. Needs `HARDCOVER_API_KEY` (Hardcover account → Settings → Hardcover API → New API Key; the `read:catalog` scope is enough). Free tier: 60 requests a minute, 5,000 a day. Searches return works; lookups by id add the default print edition's publisher and ISBNs. Written from the docs and not yet run against the live API. Hardcover's terms bar using the API to train publicly available or commercial LLMs, and bar commercial use of user data; this server only reads catalogue data, for personal use. |
| `bookbrainz` | none | Open (CC0) community database from MetaBrainz. Strong on author identifiers (Wikidata, VIAF, ISNI, Open Library, Goodreads) and dates; editions carry publisher, date, pages and (on a by-id lookup) ISBN. Search matches names only, so ISBN search is not supported, and each search hit is filled in with a follow-up lookup for the top five, which makes searches take several seconds. Coverage is uneven, so it is left out of default book searches (use `source: "bookbrainz"`). Optional `BOOKBRAINZ_CONTACT` is added to the user agent. |
| `crossref` | none | DOI registry. Academic and university-press books (monographs, edited volumes, reference works) with publisher, date, ISBNs, abstract and DOI; thin on trade books, and fuzzy matching is noisy, so it is left out of default searches (use `source: "crossref"`). Chapters are not returned. Ids are DOIs. Books only; Crossref has no author records. Optional `CROSSREF_CONTACT` (your email) moves requests to its faster polite pool. |
| `googlebooks` | required | Editions with publisher, ISBNs, descriptions and covers. |

Book searches without a `source` fan out to every available general source (not `wikidata`, `bookbrainz` or `crossref`). Author searches fan out to every source that has author records.

## Install

You need a Mac, Linux or Windows machine with [Node.js](https://nodejs.org) 20 or newer, and [Git](https://git-scm.com). To check Node, run `node --version`.

1. Download the code:

   ```bash
   git clone https://github.com/mildlydiverting/md-books-mcp.git
   ```

2. Go into the folder:

   ```bash
   cd md-books-mcp
   ```

3. Install and build:

   ```bash
   npm install && npm run build
   ```

4. Check it works. The tests should all pass:

   ```bash
   npm test
   ```

5. Tell your AI app about it. Pick one:

   - **Claude Code:** run this from inside the folder.

     ```bash
     claude mcp add books -- node "$(pwd)/dist/index.js"
     ```

   - **Claude Desktop:** open its config file (Settings, Developer, Edit Config) and add the `books` entry shown under *Setup* below. Use the full path to `dist/index.js`. Run `pwd` in the folder to get it.

6. Restart the app, then ask it to run `list_sources`. Open Library should say **Available**.

That is enough to search books and make citations with Open Library. For Google Books, Hardcover, affiliate links and the rest, add keys and IDs as described under *Setup*. If a step fails, the usual cause is Node being too old, or (Claude Desktop with nvm) `command` needing the full path to your node binary.

## Setup

Open Library works with no setup. Google Books needs an API key. Keyless requests share a quota of zero, so they fail with a 429.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project, enable the **Books API**, and create an API key.
2. Pass it to the server in your MCP client's `env` block. A bare `.env` file is not loaded.

```bash
npm install && npm run build
claude mcp add books -e GOOGLE_BOOKS_API_KEY=your-key -e HARDCOVER_API_KEY=your-key -- node "$(pwd)/dist/index.js"
```

(Run that from the project folder: `$(pwd)` fills in the full path to `dist/index.js`.)

Claude Desktop (`claude_desktop_config.json`). Use the full path to `dist/index.js` on your machine. If node comes from nvm, use the full path to the node binary as `command`, because Desktop does not read your shell's PATH:

```json
{
  "mcpServers": {
    "books": {
      "command": "node",
      "args": ["/path/to/md-books-mcp/dist/index.js"],
      "env": { "GOOGLE_BOOKS_API_KEY": "your-key", "HARDCOVER_API_KEY": "your-key" }
    }
  }
}
```

All the variables you can set are listed in [`.env.example`](.env.example). The server does not read a `.env` file, so the `env` block above is the simplest route: it works on any machine and needs nothing else installed. The catch is that your keys then sit in plain text in that config file, so don't commit or share it. If you'd rather not, load the values from a secret store (on macOS, the Keychain) in a small launcher script and point `command` at that script. Never put real values in this repo.

Try it with the Inspector: `npm run inspect`.

## Adding a source

1. Copy `src/providers/googlebooks.ts` to `src/providers/yoursource.ts`.
2. Implement `BookProvider` (see `src/types.ts`): `id`, `name`, `strengths`, `isAvailable()`, `searchBooks()`, `getBook()`. Map the source's shape onto `Book`.
3. Import it and add it to the list in `src/providers/index.ts`.

Tools, citations and the search fan-out pick it up with no other changes. A source whose `isAvailable()` is false (a missing key, say) is skipped quietly and explained by `list_sources`.

## Search links

`find_elsewhere` fills in URL templates for sites that have no API, or that block scripts with a bot check (Biblio does). It never fetches the page, so there is no scraping and no extra request; you or an agent with a browser open the link.

- With an ISBN, a site needs an `isbnUrl`. With a title, author or free text, it needs a `queryUrl`.
- Templates can use `{isbn}`, `{isbn10}`, `{isbn13}` (converted from whatever ISBN you give; a site is skipped if it cannot be), `{title}`, `{author}` and `{query}` (title, author and free text joined). Values are URL-encoded.
- Built-in sites are in `src/lib/links.ts`. Patterns marked "unverified" were blocked to scripts, so check them once in a browser and correct them in your file if needed.

To add or change sites, create `~/.config/md-books-mcp/links.json` (or point `MD_BOOKS_LINKS_FILE` at another path). Start from [`links.example.json`](links.example.json). An entry with a built-in `id` changes only the fields you give; a new `id` adds a site; `"disabled": true` hides one. A problem in the file is reported in the tool's output and the built-in sites still work. The file is read on each call, so edits apply without a restart.

### Affiliate links (optional)

If you have affiliate IDs, set them as environment variables and the matching links carry them. Nothing changes when they are unset.

| Variable | Effect |
| --- | --- |
| `BOOKSHOP_AFFILIATE_ID` | The Bookshop.org (UK) ISBN link becomes `https://uk.bookshop.org/a/{id}/{isbn13}`. Title searches stay plain. |
| `AMAZON_ASSOCIATE_TAG` | Adds an Amazon UK link, `https://www.amazon.co.uk/dp/{isbn10}?tag={tag}` (ISBN-10 only, so 979 ISBNs get none). Use a tag registered for amazon.co.uk. |

IDs may contain letters, numbers, `_` and `-` only. Affiliate links are marked ★ in the output with a reminder to say so when you share them (both programmes expect disclosure). In the markdown citation, `isbn_link_site: "bookshop-uk"` or `"amazon-uk"` uses the affiliate link. These are public IDs rather than secrets, but keep your own out of the repo: set them in your MCP client config or launcher. The Bookshop.org link format comes from its affiliate material and has not been checked against every account, so open a link once to confirm it.

## Planned sources

| Source | Notes |
| --- | --- |
| WorldCat, ISBNdb | Paid or institutional keys. |
| Biblio, Bookshop.org, World of Books | No public API found; terms need checking before any scraping. |

Author tools are optional on a source (`searchAuthors` and `getAuthor` on `BookProvider`). Google Books only has authors as a field on books, so it doesn't implement them.

## Development

```bash
npm test        # unit tests, no network
npm run build
```
