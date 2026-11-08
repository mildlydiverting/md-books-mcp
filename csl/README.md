These are the official CSL style files, copied unchanged from
https://github.com/citation-style-language/styles and used by Citation.js to format citations:

| File | Style | Style file last updated |
|---|---|---|
| `apa.csl` | APA 7th edition | 2026-02-12 |
| `harvard-cite-them-right.csl` | Cite Them Right 12th edition (UK Harvard) | 2026-02-03 |
| `chicago-notes-bibliography.csl` | Chicago 17th edition, notes and bibliography (bibliography entry) | 2026-02-07 |
| `modern-language-association.csl` | MLA 9th edition | 2025-02-09 |

Licence: Creative Commons Attribution-ShareAlike 3.0 (stated inside each file), separate from this project's MIT licence.
To update one, download the new file over the old one, run `npm test` and look at the citation tests.
To add a style, add the file here and a line in `CSL_FILES` in `src/lib/citation.ts`.
