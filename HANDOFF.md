# Handoff: md-books-mcp

Last updated 2026-11-20. Read this first, then `README.md`.

## Where we are

A working server, run locally, that lets an AI assistant look up books and
authors from several catalogues and write citations. It also makes shop links
that can carry Kim's affiliate IDs. Seven catalogues are checked against live
data. 76 tests pass. It is set up and working in Claude Code and Claude
Desktop, and affiliate links were checked live in Desktop on 2026-11-20.

**Ready to publish to npm, not yet published** (needs Kim: her npm account and
two-factor code). Package details, file list and a clean-install check are done
(see "Publishing to npm" below).

**Still to do:**
- Publish to npm (steps below). Until then `npx md-books-mcp` fails, and the
  README's "Quickest: from npm" instructions will not work. Publish before
  telling anyone to use them.
- Kim's Bookshop.org affiliate ID is applied for. Until it arrives, Desktop
  uses `2773`, a test ID from a blog post. Any commission from that goes to
  its owner, not Kim. Swap in the real ID when it comes.
- Kim's Amazon UK tag is set in her own Desktop config, not in this repo.
- Check `git status`: README and package changes from 2026-11-20 may be
  uncommitted.

**Done 2026-11-20:**
- Affiliate links (Bookshop.org UK, Amazon UK), marked "(affiliate link)".
- `.env.example` lists every setting the server reads.
- README rewritten in plain language: Install (npm and from source), Setup,
  affiliate section.
- Package details added for npm (`repository`, `homepage`, `bugs`, file list).
- Clean install from a packed copy tested over the real protocol: all seven
  tools listed, affiliate links and an APA citation worked.
- New test `tests/package.test.ts` checks what npm would publish: it fails if
  `dist`, `csl`, `links.example.json` or `.env.example` drop out, or if private
  files sneak in. It needs `npm run build` first.
- `fast-xml-parser` upgraded 5.11.2 to 5.12.1 to clear a low-severity warning.
  Tests pass, and a live Library of Congress lookup still keeps the leading
  zero in an ISBN.
- Used for real on a note in the knowledge base (Tyler, drawing and painting
  the nude). Kim said it looked good.

**Done earlier:** folder renamed to `md-books-mcp`; GitHub repo
`mildlydiverting/md-books-mcp`; SSH to GitHub fixed (`main` tracks
`origin/main`); citation styles moved to Citation.js with the official CSL
style files.

## Publishing to npm

Kim does these (they need her login). Run from the project folder.

1. `npm run build`, then `npm test`. Both must pass (the package test needs the build).
2. `npm pack --dry-run`. Check the file list includes `dist`, `csl`,
   `links.example.json` and `.env.example`.
3. `npm login` (with her two-factor code).
4. `npm publish`. The name `md-books-mcp` looked free on 2026-11-20.
5. In a spare folder, run `npx -y md-books-mcp` to confirm it starts (it waits
   silently for a client; press Ctrl-C).
6. Update this file: remove the "not published" lines above.
7. For later releases: raise `version` in `package.json` first. npm will not
   accept the same version twice.

## What exists

| Piece | Where |
|---|---|
| Tools: `list_sources`, `find_elsewhere`, `search_books`, `get_book`, `format_citation`, `search_authors`, `get_author` | `src/tools.ts` |
| Provider interface and source-agnostic `Book` / `Author` models | `src/types.ts` |
| One file per source | `src/providers/` (`openlibrary`, `loc`, `hardcover`, `wikidata`, `bookbrainz`, `crossref`, `googlebooks`), registered in `src/providers/index.ts` |
| Shared HTTP, ISBN, citation, pacing, language and search-link helpers | `src/lib/` |
| Citation styles: APA, MLA, Chicago, Harvard, BibTeX, Wikipedia `{{cite book}}`, CSL-JSON, markdown (house format) | `src/lib/citation.ts` |
| Tests | `tests/unit.test.ts`, `tests/csl-json.test.ts`, `tests/package.test.ts` |

**Sources**

| Source | Key | Notes |
|---|---|---|
| `openlibrary` | none | Strong on editions and ISBNs |
| `hardcover` | `HARDCOVER_API_KEY` | Good on recent and genre fiction. GraphQL |
| `loc` | none | Library of Congress: SRU catalogue (MODS XML) plus id.loc.gov name authorities. Edition-accurate. Added 2026-11-06 |
| `bookbrainz` | none | MetaBrainz CC0 database; author identifiers; editions by name search only. Opt-in for book searches. Added 2026-11-06 |
| `crossref` | none | DOI registry; academic books; books only, opt-in for searches. Added 2026-11-06 |
| `wikidata` | none | Authority identifiers (VIAF, ISNI, LC). Opt-in for book searches |
| `googlebooks` | `GOOGLE_BOOKS_API_KEY` | Key is required; keyless quota is zero |

**How secrets reach the server**
- Both keys live in macOS Keychain under their own names, account `$USER`.
- Affiliate IDs are not secrets: they go in the `env` block of the Desktop
  entry (`BOOKSHOP_AFFILIATE_ID`, `AMAZON_ASSOCIATE_TAG`), beside the launcher.
- `~/bin/mcp-keychain.sh NAME... -- command` exports them and execs the server.
- Claude Code: registered as `books` (local scope, this project only).
- Claude Desktop: entry in `claude_desktop_config.json`, same launcher.
- A bare `.env` is not loaded. `.env.example` lists names only.

## What next

Suggested order. Kim approves each step before it starts.

1. Try the tools from a real session on an Obsidian note (a book or author
   mention, then a citation). This is the actual use case and has only been
   exercised over raw stdio and in a smoke test.
2. Tune the results: Hardcover returns junk such as study guides, and the
   fan-out merge is a plain concatenation with no de-duplication across sources.
3. Check the unverified search-link patterns and add Kim's local library.
   Affiliate links (Bookshop.org UK, Amazon UK) use `BOOKSHOP_AFFILIATE_ID` /
   `AMAZON_ASSOCIATE_TAG`, marked "(affiliate link)" in output. IDs are never
   committed. Affiliate rules: IDs must match `[\w-]+`; Amazon needs an ISBN-10
   (no 979 ISBNs); a user `links.json` isbnUrl overrides the affiliate URL.
4. Further sources, roughly easiest first:
   - Local libraries.
   - WorldCat and ISBNdb need paid or institutional keys.
   - Biblio, Bookshop.org UK and World of Books have no public API found.
     Check terms before any scraping.
5. Publish to npm (see "Publishing to npm" above).
6. Decisions for Kim, from the citation work: one written spec with worked
   examples for the house formats (smush, TASL, Wikipedia; smush exists three
   times elsewhere in her tools); Python route for standard styles (Node
   wrapper preferred; citeproc-py is weaker on Chicago and MLA). Findings in
   `~/Development/_development-notes/md-tools-pkim/_citation-engines-findings.md`.

## Things to look out for

- **Works vs editions.** Open Library and Hardcover searches return works
  (no publisher, no ISBN). ISBN lookups and Hardcover by-id lookups give
  edition-accurate data. For citations, pass an ISBN. The server must never
  invent a publisher or ISBN.
- **Library of Congress.** Use the SRU catalogue (`lx2.loc.gov/sru/lcdb`) and
  `id.loc.gov` only. The `loc.gov` JSON site is behind a Cloudflare bot check;
  do not try to get round it. Requests are paced one at a time (400 ms gap).
  LC records can cite other editions' ISBNs, so ISBN lookups put the record that
  carries that exact ISBN first. XML is parsed with `fast-xml-parser` (pinned
  5.12.1); keep `parseTagValue: false` or ISBNs lose leading zeros.
- **Crossref.** Public pool is about one request a second (paced to 1.1 s);
  `CROSSREF_CONTACT` unlocks the polite pool. ISBN searches must keep the
  `type:` filter or they return chapters. Dates ending 31 December are treated
  as year-only, because publishers deposit that when they only know the year.
  `select=` only accepts fields valid for the route (`edition-number`,
  `language` are not).
- **Place of publication** (`Book.place`) is filled only from data a source
  already returns: Open Library editions (`publish_places`), Library of
  Congress (`placeTerm`), Crossref (`publisher-location`). Kim's rule: never
  spend extra API calls to find it without asking her first. Harvard
  and markdown print it when present (Chicago 17th no longer does); when missing, `format_citation` adds a note
  telling the agent to ask before looking further. Google Books and Hardcover
  do not give it. The markdown style prints it too.
- **Open Library work id and edition** (`Book.identifiers.openlibrary_work`,
  `openlibrary_edition`, `Book.edition`). The quick ISBN lookup does not name
  the work, so `editionByIsbn` makes one extra, fail-soft request to
  `/books/OL…M.json` (server-side, no token cost). Kim asked for the work id in
  her markdown format, so this was judged worth it; she has not been told it is
  an extra call until now. Edition statements are rare in Open Library; LoC
  often has one. The Wikipedia `ol=` parameter (id without the `OL` prefix) was
  written from memory of the template docs, not checked: Wikimedia refused
  scripted requests to the docs.
- **CSL-JSON conformance.** `tests/csl-json.test.ts` validates the `csl-json`
  output against the official schema vendored in `tests/fixtures/` (ajv, dev
  dependency). Keep it passing; refresh the schema by re-downloading it (see the
  README beside it). A trial of Citation.js and cross-project findings are in
  `~/Development/_development-notes/md-tools-pkim/_citation-engines-findings.md`.
  APA, MLA, Chicago and Harvard now come from Citation.js 0.9.0 with the official CSL files in `csl/` (CC BY-SA, see `csl/README.md`); BibTeX stays hand-written because Citation.js's BibTeX turned a full date into `month = {may 14}`. Chicago is the 17th-edition notes-bibliography form, which drops the place; `Book.place` stays in the data. Wikipedia, markdown and CSL-JSON are hand-written (no CSL style exists for them).
- **BookBrainz.** Spec: `https://api.bookbrainz.org/1/docs/json`. Search is
  name-only and its hits have no authors or publishers, so the top five are
  hydrated one at a time (paced 700 ms), which makes a search take about
  6 s. `type=edition` and `type=author` work in lower case. Dates look like
  `+001929-10-21` (see `bbDate`). Edition detail uses `authorCredits`
  (the spec says `authorCredit`).
- **Search links** (`find_elsewhere`, `src/lib/links.ts`) are the answer for sites
  with no API or a bot check (Biblio, Bookshop.org UK, World of Books,
  WorldCat). Templates only; nothing is fetched. Kim can add sites in
  `~/.config/md-books-mcp/links.json` (example in `links.example.json`). WorldCat,
  Hardcover's URL pattern is unverified because it blocks scripts:
  ask Kim to click each once. Biblio's and Bookshop.org's (`/beta-search?bkshp-astro=t&keywords=`, a beta search that may change) came from Kim. Oxfam's (`/searchresults?...&Ntt=`) and eBay UK's (`/sch/267/i.html?_nkw=`) came from Kim's real search URLs (Oxfam's random `Rdm` parameter dropped; an ISBN with no match redirects to `/noSearchResults`, which is normal). Her local library
  catalogue is not added yet; it needs its search URL.
- **Wikidata rate limits** are strict. Calls go through a serial queue with one
  retry on 429. Wikidata is excluded from default book fan-out
  (`bookSearchByDefault: false`). Test it one call at a time.
- **Hardcover tokens.** `security add-generic-password -w` with no value uses a
  prompt that truncates long input (about 128 characters), which gave a 401.
  Store with `-w "$(pbpaste)"` instead. A leading "Bearer " is stripped by the
  server. Terms bar using the API to train LLMs; this server only reads the
  catalogue for personal use.
- **Auto-mode classifier** blocks commands that read or inspect Keychain
  values. Testing via `~/bin/mcp-keychain.sh` works. Do not try to display
  or measure a key.
- **MCP SDK v2** (`@modelcontextprotocol/server` 2.4.0): `McpServer`,
  `registerTool`, `serveStdio`, zod from `zod/v4`. Do not mix in v1 patterns
  from `whitney-mcp-ts`; the layout is shared but the imports differ.
- **Claude Desktop** starts servers without your shell `PATH`. If `node` is not
  found (nvm), use the full path from `which node` in the config.
- **stdout carries the protocol.** Log to stderr only.
- **Kim's conventions** (global CLAUDE.md): British English; one clarifying
  question at a time; propose a plan before large changes; version files with a
  changelog block; commit messages end with the Co-Authored-By line.
