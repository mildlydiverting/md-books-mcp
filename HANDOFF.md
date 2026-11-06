# Handoff: md-books-mcp

Last updated 2026-11-05. Read this first, then `README.md`.

## Where we are

A working, locally run MCP server (stdio, MCP spec 2026-07-28) that looks up
books and authors from several pluggable sources and formats citations.
All five sources are verified against live data. 30 unit tests pass.
It is registered and tested in Claude Code and Claude Desktop.

**Not yet done:**
- The folder is still named `mcp-google-books`. Rename it to `md-books-mcp`
  (see "Folder rename" below). The package name, server name and README
  already say `md-books-mcp`.
- No GitHub remote. Code is local only, so the other Mac cannot pull it.
- Not published to npm, so `npx md-books-mcp` does not work yet.

## What exists

| Piece | Where |
|---|---|
| Tools: `list_sources`, `search_books`, `get_book`, `format_citation`, `search_authors`, `get_author` | `src/tools.ts` |
| Provider interface and source-agnostic `Book` / `Author` models | `src/types.ts` |
| One file per source | `src/providers/` (`openlibrary`, `loc`, `hardcover`, `wikidata`, `googlebooks`), registered in `src/providers/index.ts` |
| Shared HTTP, ISBN and citation helpers | `src/lib/` |
| Citation styles: APA, MLA, Chicago, BibTeX | `src/lib/citation.ts` |
| Tests | `tests/unit.test.ts` |

**Sources**

| Source | Key | Notes |
|---|---|---|
| `openlibrary` | none | Strong on editions and ISBNs |
| `hardcover` | `HARDCOVER_API_KEY` | Good on recent and genre fiction. GraphQL |
| `loc` | none | Library of Congress: SRU catalogue (MODS XML) plus id.loc.gov name authorities. Edition-accurate. Added 2026-11-06 |
| `wikidata` | none | Authority identifiers (VIAF, ISNI, LC). Opt-in for book searches |
| `googlebooks` | `GOOGLE_BOOKS_API_KEY` | Key is required; keyless quota is zero |

**How secrets reach the server**
- Both keys live in macOS Keychain under their own names, account `$USER`.
- `~/bin/mcp-keychain.sh NAME... -- command` exports them and execs the server.
- Claude Code: registered as `books` (local scope, this project only).
- Claude Desktop: entry in `claude_desktop_config.json`, same launcher.
- A bare `.env` is not loaded. `.env.example` lists names only.

## What next

Suggested order. Kim approves each step before it starts.

1. Rename the folder, update the two registrations, push to a new GitHub repo.
2. Try the tools from a real session on an Obsidian note (a book or author
   mention, then a citation). This is the actual use case and has only been
   exercised over raw stdio and in a smoke test.
3. Tune the results: Hardcover returns junk such as study guides, and the
   fan-out merge is a plain concatenation with no de-duplication across sources.
4. Further sources, roughly easiest first:
   - Crossref (keyless; academic books and chapters with DOIs).
   - BookBrainz (open API; check its state first).
   - Local libraries.
   - WorldCat and ISBNdb need paid or institutional keys.
   - Biblio, Bookshop.org UK and World of Books have no public API found.
     Check terms before any scraping.
5. Optional: publish to npm so `npx` works.

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
  5.11.2); keep `parseTagValue: false` or ISBNs lose leading zeros.
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

## Folder rename

Do this when no Claude session has the folder open:

```bash
mv ~/Development/mcp-google-books ~/Development/md-books-mcp
```

Then:
- Claude Code: `claude mcp remove books`, then re-add from the new folder
  (README has the command; local scope is keyed to the project path).
- Claude Desktop: change the path in `claude_desktop_config.json`, restart.
- Check `git status` is clean and `npm test` passes in the new location.
