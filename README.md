# md-books-mcp

A small helper program that lets an AI assistant (such as Claude) look up books and authors, and write citations for them. It is an [MCP](https://modelcontextprotocol.io) server: it runs on your own computer, and your AI app talks to it.

You can ask things like "find this book by its ISBN", "who wrote this?", "give me an APA citation" or "where can I buy this?". It can also make shop links that carry your own affiliate ID, if you have one.

It looks books up in several free catalogues (Open Library, Library of Congress, Hardcover, Google Books and others). Each one is a plug-in, so more can be added. It is an early release, so expect some rough edges.

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
| `hardcover` | required (free) | Community catalogue, good on recent and genre fiction. Needs `HARDCOVER_API_KEY` (Hardcover account → Settings → Hardcover API → New API Key; the `read:catalog` scope is enough). Free tier: 60 requests a minute, 5,000 a day. Searches return works; lookups by id add the default print edition's publisher and ISBNs. Hardcover's terms bar using the API to train publicly available or commercial LLMs, and bar commercial use of user data; this server only reads catalogue data, for personal use. |
| `bookbrainz` | none | Open (CC0) community database from MetaBrainz. Strong on author identifiers (Wikidata, VIAF, ISNI, Open Library, Goodreads) and dates; editions carry publisher, date, pages and (on a by-id lookup) ISBN. Search matches names only, so ISBN search is not supported, and each search hit is filled in with a follow-up lookup for the top five, which makes searches take several seconds. Coverage is uneven, so it is left out of default book searches (use `source: "bookbrainz"`). Optional `BOOKBRAINZ_CONTACT` is added to the user agent. |
| `crossref` | none | DOI registry. Academic and university-press books (monographs, edited volumes, reference works) with publisher, date, ISBNs, abstract and DOI; thin on trade books, and fuzzy matching is noisy, so it is left out of default searches (use `source: "crossref"`). Chapters are not returned. Ids are DOIs. Books only; Crossref has no author records. Optional `CROSSREF_CONTACT` (your email) moves requests to its faster polite pool. |
| `googlebooks` | required | Editions with publisher, ISBNs, descriptions and covers. |

Book searches without a `source` fan out to every available general source (not `wikidata`, `bookbrainz` or `crossref`). Author searches fan out to every source that has author records.

## Install

You need [Node.js](https://nodejs.org) 20 or newer. To check, run `node --version`. This is an early release (0.1.x): expect rough edges.

### Quickest: from npm

1. Claude Code: run this.

   ```bash
   claude mcp add books -- npx -y md-books-mcp
   ```

2. Claude Desktop: add this inside `"mcpServers"` in its config file (Settings, Developer, Edit Config), then restart the app.

   ```json
   "books": {
     "command": "npx",
     "args": ["-y", "md-books-mcp"]
   }
   ```

3. Ask the app to run `list_sources`. Open Library should say **Available**.

To add keys and affiliate IDs, see *Setup* below. If Claude Desktop can't find `npx`, see the note there.

### From source

You also need [Git](https://git-scm.com).

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

That is enough to search books and make citations. To add keys and affiliate IDs, see *Setup* below. If a step fails, the usual cause is Node being too old (run `node --version`; you need 20 or newer).

## Setup

**Open Library, the Library of Congress and the other free catalogues need nothing.** The steps below are only for the extras:

| You want | You need |
| --- | --- |
| Google Books | A free API key (step 1 below) |
| Hardcover | A free API key from your Hardcover account |
| Affiliate links | Your own Bookshop.org ID and/or Amazon Associates tag |

1. **Get a Google Books key (optional).** In [Google Cloud Console](https://console.cloud.google.com/), create a project, switch on the **Books API**, and create an API key. Without a key, Google Books simply won't work; everything else does.
2. **Put your keys in your AI app's settings.** The server does not read a `.env` file. You hand the keys over in the app's `env` section, as shown next. Leave out any you don't have.

**Claude Code** (type this in Terminal; swap in your own values):

```bash
claude mcp add books \
  -e GOOGLE_BOOKS_API_KEY=your-key \
  -e HARDCOVER_API_KEY=your-key \
  -e BOOKSHOP_AFFILIATE_ID=your-bookshop-id \
  -e AMAZON_ASSOCIATE_TAG=yourname-21 \
  -- npx -y md-books-mcp
```

(Installed from source instead? Replace `npx -y md-books-mcp` with `node "$(pwd)/dist/index.js"` and run it from the project folder.)

**Claude Desktop** (edit its config file: Settings, Developer, Edit Config):

```json
{
  "mcpServers": {
    "books": {
      "command": "npx",
      "args": ["-y", "md-books-mcp"],
      "env": {
        "GOOGLE_BOOKS_API_KEY": "your-key",
        "HARDCOVER_API_KEY": "your-key",
        "BOOKSHOP_AFFILIATE_ID": "your-bookshop-id",
        "AMAZON_ASSOCIATE_TAG": "yourname-21"
      }
    }
  }
}
```

Installed from source? Use `"command": "node"` and `"args": ["/full/path/to/md-books-mcp/dist/index.js"]` instead. If Desktop can't find `node` or `npx` (common when Node came from nvm), put the full path from `which node` or `which npx` in `command`.

**Keeping keys safe.** In that `env` section your keys sit in plain text in the config file, so don't share or commit that file. A safer option is a secret store (on a Mac, the Keychain) with a small launcher script as the `command`. Affiliate IDs are not secret, so they can stay in `env` either way. Never put real keys in this project's files. All the settings the server understands are listed in [`.env.example`](.env.example).

**Check it works.** Restart the app and ask it to run `list_sources`. Each source says whether it is available. You can also try the tools by hand with `npm run inspect` (source install only).

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

If you have an affiliate ID, the shop links can carry it, so a purchase made through them pays you a small commission. Set the IDs as shown under *Setup*. Leave them out and nothing changes.

| Setting | What it does |
| --- | --- |
| `BOOKSHOP_AFFILIATE_ID` | The Bookshop.org (UK) link for an ISBN becomes `https://uk.bookshop.org/a/{your-id}/{isbn13}`. Searches by title stay plain. |
| `AMAZON_ASSOCIATE_TAG` | Adds an Amazon UK link, `https://www.amazon.co.uk/dp/{isbn10}?tag={your-tag}`. Use a tag registered for amazon.co.uk. Books with a 979 ISBN get no Amazon link, because Amazon needs the older 10-digit form. |

Good to know:

- **Telling people.** Affiliate links are labelled "(affiliate link)" in the output, with a reminder to say so when you share them. Both programmes expect that disclosure, so it is your responsibility.
- **In citations.** In the `markdown` style, `isbn_link_site: "bookshop-uk"` or `"amazon-uk"` uses the affiliate link.
- **Safe values.** An ID can only contain letters, numbers, `_` and `-`. Anything else is ignored with a warning.
- **Your own files win.** A link you set in `links.json` replaces the built-in affiliate one.
- **Not checked for every account.** The Bookshop.org link format comes from its affiliate material. Click one link to confirm it works for you.
- **Keep your IDs out of this project's files.** They are public, but they are yours.

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
