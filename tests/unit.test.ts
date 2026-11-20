import { describe, expect, it } from "vitest";
import { formatCitation } from "../src/lib/citation.js";
import { isValidIsbn } from "../src/lib/isbn.js";
import { buildQ, toBook } from "../src/providers/googlebooks.js";
import { providers } from "../src/providers/index.js";

const volume = {
  id: "abc123",
  volumeInfo: {
    title: "The Dispossessed",
    subtitle: "An Ambiguous Utopia",
    authors: ["Ursula K. Le Guin"],
    publisher: "Harper",
    publishedDate: "2003-05-14",
    industryIdentifiers: [
      { type: "ISBN_10", identifier: "0061054887" },
      { type: "ISBN_13", identifier: "9780061054884" },
    ],
    imageLinks: { thumbnail: "http://books.google.com/x?id=abc&edge=curl" },
  },
};

describe("isbn", () => {
  it("accepts valid ISBNs with hyphens", () => {
    expect(isValidIsbn("978-0-14-143951-8")).toBe(true);
    expect(isValidIsbn("0-8044-2957-X")).toBe(true);
  });
  it("rejects bad checksums", () => {
    expect(isValidIsbn("9780141439519")).toBe(false);
    expect(isValidIsbn("hello")).toBe(false);
  });
});

describe("google books mapping", () => {
  it("maps a volume onto Book", () => {
    const b = toBook(volume);
    expect(b).toMatchObject({ source: "googlebooks", id: "abc123", isbn13: "9780061054884", isbn10: "0061054887" });
    expect(b.coverUrl).toBe("https://books.google.com/x?id=abc");
  });
  it("builds field-operator queries", () => {
    expect(buildQ({ title: "Dispossessed", author: "Le Guin", isbn: "978-0-06-105488-4", limit: 5 })).toBe(
      'isbn:9780061054884 intitle:"Dispossessed" inauthor:"Le Guin"',
    );
  });
});

describe("citations", () => {
  const book = toBook(volume);
  // APA, MLA, Chicago and Harvard come from Citation.js with the official CSL files, so these
  // tests pin what those styles produce for our records rather than our own rules.
  it("APA", () => {
    expect(formatCitation(book, "apa")).toBe("Le Guin, U. K. (2003). *The Dispossessed: An Ambiguous Utopia*. Harper.");
  });
  it("MLA", () => {
    expect(formatCitation(book, "mla")).toBe("Le Guin, Ursula K. *The Dispossessed: An Ambiguous Utopia*. Harper, 2003.");
  });
  it("Harvard (Cite Them Right)", () => {
    expect(formatCitation(book, "harvard")).toBe("Le Guin, U.K. (2003) *The Dispossessed: An Ambiguous Utopia*. Harper.");
    const two = { ...book, authors: ["Ann Smith", "Bo Jones"] };
    expect(formatCitation(two, "harvard")).toContain("Smith, A. and Jones, B. (2003)");
    const many = { ...book, authors: ["Ann Smith", "Bo Jones", "Cy Lee", "Di Wu"] };
    expect(formatCitation(many, "harvard")).toContain("Smith, A. *et al.* (2003)");
    expect(formatCitation({ ...book, authors: [], publishedDate: undefined }, "harvard")).toBe("*The Dispossessed: An Ambiguous Utopia* (no date). Harper.");
  });
  it("prints the edition statement when the record has one", () => {
    const ed = { ...book, edition: "2nd ed." };
    expect(formatCitation(ed, "apa")).toContain("(2nd ed.)");
    expect(formatCitation(ed, "harvard")).toContain("2nd ed.");
    expect(formatCitation(ed, "mla")).toContain("2nd ed.");
    expect(formatCitation(ed, "chicago")).toContain("2nd ed.");
    expect(formatCitation(ed, "bibtex")).toContain("edition = {2nd ed.}");
  });
  it("decodes html entities from the engine", () => {
    const amp = { ...book, authors: ["Ann Smith", "Bo Jones"], title: "Salt & Light", subtitle: undefined };
    expect(formatCitation(amp, "apa")).toContain("Salt & Light");
    expect(formatCitation(amp, "apa")).not.toContain("&#");
  });
  it("uses the place of publication where the style wants it", () => {
    const placed = { ...book, place: "London" };
    expect(formatCitation(placed, "harvard")).toBe("Le Guin, U.K. (2003) *The Dispossessed: An Ambiguous Utopia*. London: Harper.");
    expect(formatCitation(placed, "bibtex")).toContain("address = {London}");
    // APA, MLA and Chicago (17th edition) do not print a place.
    expect(formatCitation(placed, "apa")).not.toContain("London");
    expect(formatCitation(placed, "mla")).not.toContain("London");
    expect(formatCitation(placed, "chicago")).not.toContain("London");
    // A place without a publisher has nothing to attach to.
    expect(formatCitation({ ...placed, publisher: undefined }, "harvard")).not.toContain("London");
  });
  it("BibTeX", () => {
    expect(formatCitation(book, "bibtex")).toContain("@book{leguin2003,");
  });
});

describe("registry", () => {
  it("has unique provider ids", () => {
    const ids = providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("open library mapping", async () => {
  const { workToBook, editionToBook, buildQ } = await import("../src/providers/openlibrary.js");
  it("maps a work without inventing edition data", () => {
    const b = workToBook({ key: "/works/OL1W", title: "Emma", author_name: ["Jane Austen"], first_publish_year: 1815, cover_i: 7 });
    expect(b).toMatchObject({ source: "openlibrary", id: "OL1W", publishedDate: "1815", authors: ["Jane Austen"] });
    expect(b.publisher).toBeUndefined();
    expect(b.isbn13).toBeUndefined();
    expect(b.coverUrl).toBe("https://covers.openlibrary.org/b/id/7-M.jpg");
  });
  it("maps an edition found by ISBN", () => {
    const b = editionToBook("9780141439518", {
      title: "Pride and Prejudice",
      authors: [{ name: "Jane Austen" }],
      publishers: [{ name: "Penguin Books" }],
      publish_places: [{ name: "London" }],
      publish_date: "2003",
      identifiers: { isbn_13: ["9780141439518"] },
    });
    expect(b).toMatchObject({ id: "isbn:9780141439518", publisher: "Penguin Books", place: "London", publishedDate: "2003", isbn13: "9780141439518" });
  });
  it("builds field queries", () => {
    expect(buildQ({ title: "Emma", author: "Austen", limit: 5 })).toBe('title:"Emma" author:"Austen"');
  });
});

describe("open library authors", async () => {
  const { authorSearchDocToAuthor, authorToAuthor } = await import("../src/providers/openlibrary.js");
  it("maps an author search hit", () => {
    const a = authorSearchDocToAuthor({ key: "OL31353A", name: "Ursula K. Le Guin", birth_date: "21 October 1929", top_work: "The Left Hand of Darkness", work_count: 253 });
    expect(a).toMatchObject({ id: "OL31353A", workCount: 253, sourceUrl: "https://openlibrary.org/authors/OL31353A" });
  });
  it("keeps cross-system identifiers and handles object bios", () => {
    const a = authorToAuthor("OL31353A", { name: "X", bio: { value: "Writer." }, remote_ids: { wikidata: "Q181659" }, photos: [-1, 42] });
    expect(a.bio).toBe("Writer.");
    expect(a.identifiers).toEqual({ wikidata: "Q181659" });
    expect(a.photoUrl).toBe("https://covers.openlibrary.org/b/id/42-M.jpg");
  });
});

describe("wikidata mapping", async () => {
  const { formatTime, entityToAuthor, entityToBook } = await import("../src/providers/wikidata.js");
  const claim = (value: unknown) => ({ mainsnak: { datavalue: { value } } });
  it("formats dates by precision", () => {
    expect(formatTime({ time: "+1929-10-21T00:00:00Z", precision: 11 })).toBe("1929-10-21");
    expect(formatTime({ time: "+1969-03-00T00:00:00Z", precision: 10 })).toBe("1969-03");
    expect(formatTime({ time: "+1815-00-00T00:00:00Z", precision: 9 })).toBe("1815");
    expect(formatTime({ time: "+1800-00-00T00:00:00Z", precision: 8 })).toBeUndefined();
  });
  it("maps an author with cross-system identifiers", () => {
    const a = entityToAuthor({
      id: "Q181659",
      labels: { en: { value: "Ursula K. Le Guin" } },
      descriptions: { en: { value: "American author" } },
      claims: { P214: [claim("101734435")], P648: [claim("OL31353A")], P569: [claim({ time: "+1929-10-21T00:00:00Z", precision: 11 })] },
    });
    expect(a).toMatchObject({ id: "Q181659", birthDate: "1929-10-21", bio: "American author" });
    expect(a.identifiers).toEqual({ wikidata: "Q181659", viaf: "101734435", openlibrary: "OL31353A" });
  });
  it("maps a book and resolves author names", () => {
    const b = entityToBook(
      { id: "Q2008211", labels: { en: { value: "The Left Hand of Darkness" } }, claims: { P50: [claim({ id: "Q181659" })], P648: [claim("OL59864W")] } },
      new Map([["Q181659", "Ursula K. Le Guin"]]),
    );
    expect(b.authors).toEqual(["Ursula K. Le Guin"]);
    expect(b.identifiers).toEqual({ wikidata: "Q2008211", openlibrary: "OL59864W" });
  });
});

describe("hardcover mapping", async () => {
  const { searchDocToBook, recordToBook, authorDocToAuthor, authorRecordToAuthor, hitsOf, buildSearchText } = await import("../src/providers/hardcover.js");
  it("maps a search hit without guessing an edition's ISBN", () => {
    const b = searchDocToBook({ id: "123", title: "Emma", author_names: ["Jane Austen"], release_year: 1815, isbns: ["9780141439587", "0141439580"], slug: "emma", image: { url: "https://x/y.jpg" } });
    expect(b).toMatchObject({ source: "hardcover", id: "123", publishedDate: "1815", sourceUrl: "https://hardcover.app/books/emma", identifiers: { hardcover: "123" } });
    expect(b.isbn13).toBeUndefined();
  });
  it("keeps the ISBN the caller asked for if the book has it", () => {
    expect(searchDocToBook({ id: 1, isbns: ["9780141439587"] }, "978-0-14-143958-7").isbn13).toBe("9780141439587");
  });
  it("maps a book record with edition details", () => {
    const b = recordToBook({ id: 9, title: "Project Hail Mary", contributions: [{ author: { name: "Andy Weir" } }, { author: { name: "Andy Weir" } }], default_physical_edition: { isbn_13: "9780593135204", publisher: { name: "Ballantine" }, release_date: "2021-05-04", pages: 476 } });
    expect(b).toMatchObject({ authors: ["Andy Weir"], publisher: "Ballantine", isbn13: "9780593135204", publishedDate: "2021-05-04", pageCount: 476 });
  });
  it("maps authors and flattens string identifiers", () => {
    expect(authorDocToAuthor({ id: 5, name: "Andy Weir", books: ["The Martian"], books_count: 12, slug: "andy-weir" })).toMatchObject({ id: "5", topWork: "The Martian", sourceUrl: "https://hardcover.app/authors/andy-weir" });
    const a = authorRecordToAuthor({ id: 5, name: "Andy Weir", born_year: 1972, identifiers: { VIAF: "123", nested: { x: 1 } } });
    expect(a.birthDate).toBe("1972");
    expect(a.identifiers).toEqual({ hardcover: "5", viaf: "123" });
  });
  it("reads Typesense results as object or string", () => {
    const body = { hits: [{ document: { id: "1" } }, { document: { id: "2" } }] };
    expect(hitsOf(body)).toHaveLength(2);
    expect(hitsOf(JSON.stringify(body))).toHaveLength(2);
    expect(hitsOf(undefined)).toEqual([]);
  });
  it("joins query parts", () => {
    expect(buildSearchText({ title: "Emma", author: "Austen", limit: 5 })).toBe("Emma Austen");
  });
});

describe("library of congress mapping", async () => {
  const { forwardName, splitHeading, modsToBook, parseSru, buildCql, hitToAuthor, graphToAuthor } = await import("../src/providers/loc.js");

  const sru = (inner: string) => `<?xml version="1.0"?><zs:searchRetrieveResponse xmlns:zs="http://www.loc.gov/zing/srw/"><zs:version>1.1</zs:version><zs:records><zs:record><zs:recordData>${inner}</zs:recordData></zs:record></zs:records></zs:searchRetrieveResponse>`;
  const mods = `<mods xmlns="http://www.loc.gov/mods/v3">
    <titleInfo><nonSort xml:space="preserve">The  </nonSort><title>dispossessed</title><subTitle>an ambiguous Utopia</subTitle></titleInfo>
    <name type="personal" usage="primary"><namePart>Le Guin, Ursula K.,</namePart><namePart type="date">1929-2018</namePart></name>
    <name type="corporate"><namePart>Paul Avrich Collection (Library of Congress)</namePart></name>
    <originInfo><place><placeTerm type="code" authority="marccountry">nyu</placeTerm></place><dateIssued encoding="marc">1974</dateIssued><place><placeTerm type="text">New York</placeTerm></place><agent><namePart>Harper &amp; Row</namePart></agent><dateIssued>[1974]</dateIssued></originInfo>
    <language><languageTerm authority="iso639-2b" type="code">eng</languageTerm></language>
    <physicalDescription><extent>341 p. 22 cm.</extent></physicalDescription>
    <subject authority="lcsh"><topic>Utopias</topic></subject><subject authority="lcsh"><topic>Utopias</topic></subject>
    <identifier type="isbn">0060125632</identifier><identifier type="isbn">9780060125639</identifier>
    <identifier type="lccn">  73018667 </identifier>
  </mods>`;

  it("turns catalogue names into natural order", () => {
    expect(forwardName("Le Guin, Ursula K.,")).toBe("Ursula K. Le Guin");
    expect(forwardName("King, Martin Luther, Jr.")).toBe("Martin Luther King, Jr.");
    expect(forwardName("Homer")).toBe("Homer");
  });
  it("splits authority headings into name and dates", () => {
    expect(splitHeading("Le Guin, Ursula K., 1929-2018")).toEqual({ name: "Ursula K. Le Guin", birth: "1929", death: "2018" });
    expect(splitHeading("Pratchett, Terry")).toEqual({ name: "Terry Pratchett" });
    expect(splitHeading("Mitchell, David, 1969-")).toMatchObject({ birth: "1969", death: undefined });
  });
  it("maps a MODS record to an edition-accurate book", () => {
    const [record] = parseSru(sru(mods));
    const b = modsToBook(record!)!;
    expect(b).toMatchObject({
      source: "loc",
      id: "lccn:73018667",
      title: "The dispossessed",
      subtitle: "an ambiguous Utopia",
      authors: ["Ursula K. Le Guin"],
      publisher: "Harper & Row",
      place: "New York",
      publishedDate: "1974",
      isbn10: "0060125632",
      isbn13: "9780060125639",
      pageCount: 341,
      language: "en",
      subjects: ["Utopias"],
      sourceUrl: "https://lccn.loc.gov/73018667",
    });
  });
  it("skips records with no usable id", () => {
    const [record] = parseSru(sru(`<mods xmlns="http://www.loc.gov/mods/v3"><titleInfo><title>Orphan</title></titleInfo></mods>`));
    expect(modsToBook(record!)).toBeUndefined();
  });
  it("reports catalogue diagnostics as errors", () => {
    const body = `<zs:searchRetrieveResponse xmlns:zs="http://www.loc.gov/zing/srw/"><zs:diagnostics xmlns:diag="d"><diag:diagnostic><diag:message>Unsupported index</diag:message><diag:details>anywhere</diag:details></diag:diagnostic></zs:diagnostics></zs:searchRetrieveResponse>`;
    expect(() => parseSru(body)).toThrow(/Unsupported index/);
  });
  it("builds CQL", () => {
    expect(buildCql({ title: 'Emma "x"', author: "Austen", limit: 3 })).toBe('bath.title="Emma  x" and bath.author="Austen"');
    expect(buildCql({ isbn: "978-0-06-012563-9", limit: 3 })).toBe("bath.isbn=9780060125639");
    expect(buildCql({ text: "dune", limit: 3 })).toBe('cql.anywhere="dune"');
  });
  it("keeps people and drops work headings from author search", () => {
    const person = hitToAuthor({ token: "n78095474", aLabel: "Le Guin, Ursula K., 1929-2018", more: { rdftypes: ["PersonalName", "Authority"], variantLabels: ["Le Guin, Ursula, 1929-2018", "Ле Гуин, Урсула, 1929-2018"], activityfields: ["Science fiction", "Science fiction"] } });
    expect(person).toMatchObject({ id: "n78095474", name: "Ursula K. Le Guin", birthDate: "1929", deathDate: "2018", alternateNames: ["Ursula Le Guin"], topSubjects: ["Science fiction"] });
    expect(hitToAuthor({ token: "no2016091558", aLabel: "Le Guin, Ursula K. Rocannon's world", more: { rdftypes: ["NameTitle", "PersonalName"] } })).toBeUndefined();
  });
  it("maps an authority graph with identifiers and full dates", () => {
    const M = "http://www.loc.gov/mads/rdf/v1#";
    const a = graphToAuthor("n78095474", [
      {
        "@id": "http://id.loc.gov/authorities/names/n78095474",
        [`${M}authoritativeLabel`]: [{ "@value": "Le Guin, Ursula K., 1929-2018" }],
        [`${M}identifiesRWO`]: [{ "@id": "http://www.wikidata.org/entity/Q181659" }, { "@id": "http://viaf.org/viaf/101734435" }, { "@id": "https://isni.org/isni/0000000121457729" }],
        "http://www.w3.org/2004/02/skos/core#altLabel": [{ "@language": "und-latn", "@value": "Kroeber, Ursula, 1929-2018" }],
      },
      { "@id": "http://id.loc.gov/rwo/agents/n78095474", [`${M}birthDate`]: [{ "@value": "1929-10-21" }], [`${M}deathDate`]: [{ "@value": "2018-01-22" }] },
    ]);
    expect(a).toMatchObject({
      name: "Ursula K. Le Guin",
      birthDate: "1929-10-21",
      deathDate: "2018-01-22",
      alternateNames: ["Ursula Kroeber"],
      identifiers: { lc_naf: "n78095474", wikidata: "Q181659", viaf: "101734435", isni: "0000000121457729" },
    });
  });
});

describe("crossref mapping", async () => {
  const { workToBook, buildParams, normaliseDoi } = await import("../src/providers/crossref.js");
  it("maps a Crossref work to a book", () => {
    const b = workToBook({
      DOI: "10.1017/cbo9780511810633",
      title: ["Markov Chains"],
      subtitle: ["An introduction"],
      author: [{ given: "J. R.", family: "Norris" }, { name: "Some Institute" }],
      publisher: "Cambridge University Press",
      "publisher-location": "Cambridge",
      issued: { "date-parts": [[1997, 2, 28]] },
      ISBN: ["9780521481816", "0521481813", "not-an-isbn"],
      abstract: "<jats:p>Markov chains are <jats:italic>central</jats:italic>.</jats:p>",
      URL: "https://doi.org/10.1017/cbo9780511810633",
    });
    expect(b).toMatchObject({
      source: "crossref",
      id: "10.1017/cbo9780511810633",
      title: "Markov Chains",
      subtitle: "An introduction",
      place: "Cambridge",
      authors: ["J. R. Norris", "Some Institute"],
      publishedDate: "1997-02-28",
      isbn13: "9780521481816",
      isbn10: "0521481813",
      description: "Markov chains are central .",
      identifiers: { doi: "10.1017/cbo9780511810633" },
    });
  });
  it("falls back to editors and treats deposited year-end dates as just a year", () => {
    const b = workToBook({ DOI: "10.1515/x", title: ["Reading"], editor: [{ given: "D.", family: "Varisco" }], issued: { "date-parts": [[2011, 12, 31]] } });
    expect(b.authors).toEqual(["D. Varisco"]);
    expect(b.publishedDate).toBe("2011");
    expect(workToBook({ DOI: "10.1/x", issued: { "date-parts": [[2020]] } }).publishedDate).toBe("2020");
  });
  it("restricts searches to book types and keeps chapters out of ISBN lookups", () => {
    const isbn = buildParams({ isbn: "978-0-521-48181-6", limit: 3 });
    expect(isbn.get("filter")).toBe("isbn:9780521481816,type:book,type:monograph,type:edited-book,type:reference-book");
    const text = buildParams({ title: "Orientalism", author: "Said", limit: 5 });
    expect(text.get("query.bibliographic")).toBe("Orientalism");
    expect(text.get("query.author")).toBe("Said");
    expect(text.get("rows")).toBe("5");
  });
  it("accepts DOIs in several forms", () => {
    expect(normaliseDoi("https://doi.org/10.1017/CBO9780511810633")).toBe("10.1017/CBO9780511810633");
    expect(normaliseDoi("doi:10.1515/9780295802626")).toBe("10.1515/9780295802626");
    expect(normaliseDoi("nonsense")).toBeUndefined();
  });
});

describe("bookbrainz mapping", async () => {
  const { bbDate, editionToBook, authorToAuthor, searchText } = await import("../src/providers/bookbrainz.js");
  it("reads BookBrainz dates", () => {
    expect(bbDate("+001929-10-21")).toBe("1929-10-21");
    expect(bbDate("+002014")).toBe("2014");
    expect(bbDate("+001929-10")).toBe("1929-10");
    expect(bbDate(null)).toBeUndefined();
    expect(bbDate("nonsense")).toBeUndefined();
  });
  it("maps an edition, with ISBNs from its identifiers", () => {
    const b = editionToBook(
      {
        bbid: "df2c8eea-8d82-4410-8c92-ad0c185c4a92",
        defaultAlias: { name: "The Dispossessed" },
        authorCredits: { names: [{ name: "Ursula K. Le Guin" }] },
        publishers: [{ name: "Gollancz" }],
        releaseEventDate: "+002002",
        pages: 387,
        languages: ["eng"],
      },
      { identifiers: [{ type: "Barcode", value: "9781857988826" }, { type: "ISBN-13", value: "978-1-85798-882-6" }] },
    );
    expect(b).toMatchObject({ source: "bookbrainz", title: "The Dispossessed", authors: ["Ursula K. Le Guin"], publisher: "Gollancz", publishedDate: "2002", isbn13: "9781857988826", pageCount: 387, language: "en" });
    expect(editionToBook({ bbid: "x", defaultAlias: { name: "T" } }).isbn13).toBeUndefined();
  });
  it("maps an author with cross-system identifiers", () => {
    const a = authorToAuthor(
      { bbid: "e66704df", defaultAlias: { name: "Ursula K. Le Guin" }, beginDate: "+001929-10-21", endDate: "+002018-01-22" },
      { identifiers: [{ type: "Wikidata ID", value: "Q181659" }, { type: "ISNI", value: "0000 0001 2145 7729" }, { type: "VIAF", value: "101734435" }, { type: "Unknown", value: "x" }] },
    );
    expect(a).toMatchObject({ name: "Ursula K. Le Guin", birthDate: "1929-10-21", deathDate: "2018-01-22" });
    expect(a.identifiers).toEqual({ bookbrainz: "e66704df", wikidata: "Q181659", isni: "0000000121457729", viaf: "101734435" });
  });
  it("joins name search text", () => {
    expect(searchText({ title: "Emma", author: "Austen", limit: 3 })).toBe("Emma Austen");
  });
});

describe("search links", async () => {
  const { DEFAULT_SITES, buildLinks, fillTemplate, mergeSites } = await import("../src/lib/links.js");
  it("fills templates with encoded values", () => {
    expect(fillTemplate("https://x/?q={query}&a={author}", { isbn: "", title: "", author: "Le Guin", query: "The Dispossessed & more" })).toBe(
      "https://x/?q=The%20Dispossessed%20%26%20more&a=Le%20Guin",
    );
  });
  it("gives ISBN links only to sites that have an isbnUrl", () => {
    const links = buildLinks(DEFAULT_SITES, { isbn: "9780060125639" });
    const byId = Object.fromEntries(links.map((l) => [l.id, l.url]));
    expect(byId.biblio).toBe("https://biblio.co.uk/booksearch/keyisbn/9780060125639");
    expect(byId.hardcover).toBe("https://hardcover.app/search?q=9780060125639");
    expect(byId["bookshop-uk"]).toBe("https://uk.bookshop.org/beta-search?bkshp-astro=t&keywords=9780060125639");
    expect(byId.oxfam).toBe("https://onlineshop.oxfam.org.uk/searchresults?N=&No=0&Nr=product.active:1&type=search&Nf=sku.listPrice%7CGT+0&Ns=null&Ntk=&Nrpp=30&Ntt=9780060125639");
    expect(byId.ebay).toBe("https://www.ebay.co.uk/sch/267/i.html?_nkw=9780060125639&_from=R40");
    expect(byId.bookbrainz).toBeUndefined(); // name search only, so no ISBN link
    expect(buildLinks(DEFAULT_SITES, { isbn: "9780060125639", title: "The Dispossessed" }).map((l) => l.id)).toContain("bookbrainz");
  });
  it("skips sites that cannot handle the input", () => {
    const ids = buildLinks(DEFAULT_SITES, { title: "The Dispossessed", author: "Le Guin" }).map((l) => l.id);
    expect(ids).not.toContain("biblio"); // ISBN only
    expect(ids).toContain("worldcat");
    expect(buildLinks(DEFAULT_SITES, {})).toEqual([]);
  });
  it("merges a user file over the built-ins", () => {
    const { sites, warnings } = mergeSites(
      JSON.stringify([
        { id: "biblio", isbnUrl: "https://example.org/isbn/{isbn}" },
        { id: "worldcat", disabled: true },
        { id: "kent-libraries", name: "Kent Libraries", queryUrl: "https://example.org/search?q={query}" },
      ]),
    );
    expect(warnings).toEqual([]);
    expect(sites.find((s) => s.id === "biblio")).toMatchObject({ name: "Biblio (UK)", isbnUrl: "https://example.org/isbn/{isbn}" });
    expect(sites.some((s) => s.id === "worldcat")).toBe(false);
    expect(sites.find((s) => s.id === "kent-libraries")?.name).toBe("Kent Libraries");
  });
  it("ignores a bad user file with a warning instead of failing", () => {
    expect(mergeSites("{ not json").warnings[0]).toMatch(/not valid JSON/);
    const bad = mergeSites(JSON.stringify([{ id: "x", queryUrl: "javascript:alert(1)" }]));
    expect(bad.warnings[0]).toMatch(/links file ignored/);
    expect(bad.sites).toHaveLength(DEFAULT_SITES.length);
    expect(mergeSites(JSON.stringify([{ id: "empty" }])).warnings[0]).toMatch(/neither isbnUrl nor queryUrl/);
  });
});

describe("affiliate links", async () => {
  const { DEFAULT_SITES, buildLinks, withAffiliates, mergeSites } = await import("../src/lib/links.js");
  const { toIsbn10, toIsbn13 } = await import("../src/lib/isbn.js");
  it("converts between ISBN-10 and ISBN-13", () => {
    expect(toIsbn13("0060125632")).toBe("9780060125639");
    expect(toIsbn10("9780060125639")).toBe("0060125632");
    expect(toIsbn10(toIsbn13("0-306-40615-2"))).toBe("0306406152");
    expect(toIsbn10("9791034300000")).toBe(""); // 979 has no ISBN-10
    expect(toIsbn13("1234567890")).toBe(""); // bad checksum
  });
  it("changes nothing when no IDs are set", () => {
    const { sites, warnings } = withAffiliates(DEFAULT_SITES, {});
    expect(sites).toEqual(DEFAULT_SITES);
    expect(warnings).toEqual([]);
  });
  it("makes Bookshop and Amazon links from the IDs", () => {
    const { sites } = withAffiliates(DEFAULT_SITES, { BOOKSHOP_AFFILIATE_ID: "12345", AMAZON_ASSOCIATE_TAG: "example-21" });
    const links = buildLinks(sites, { isbn: "9781035021048" });
    const byId = Object.fromEntries(links.map((l) => [l.id, l]));
    expect(byId["bookshop-uk"]?.url).toBe("https://uk.bookshop.org/a/12345/9781035021048");
    expect(byId["bookshop-uk"]?.affiliate).toBe(true);
    expect(byId["amazon-uk"]?.url).toMatch(/^https:\/\/www\.amazon\.co\.uk\/dp\/[\dX]{10}\?tag=example-21$/);
    expect(byId.biblio?.affiliate).toBeUndefined();
  });
  it("keeps the plain Bookshop search for text queries, and skips Amazon without an ISBN-10", () => {
    const { sites } = withAffiliates(DEFAULT_SITES, { BOOKSHOP_AFFILIATE_ID: "12345", AMAZON_ASSOCIATE_TAG: "example-21" });
    const text = buildLinks(sites, { title: "The Dispossessed" });
    expect(text.find((l) => l.id === "bookshop-uk")?.affiliate).toBeUndefined();
    expect(text.some((l) => l.id === "amazon-uk")).toBe(false);
    expect(buildLinks(sites, { isbn: "9791034300000".slice(0, 12) + "0" }).some((l) => l.id === "amazon-uk")).toBe(false);
  });
  it("rejects IDs that could alter the URL", () => {
    const { sites, warnings } = withAffiliates(DEFAULT_SITES, { BOOKSHOP_AFFILIATE_ID: "1/../x", AMAZON_ASSOCIATE_TAG: "a&b=c" });
    expect(sites).toEqual(DEFAULT_SITES);
    expect(warnings).toHaveLength(2);
  });
  it("lets a user file override the affiliate URL", () => {
    const { sites } = mergeSites(JSON.stringify([{ id: "bookshop-uk", isbnUrl: "https://example.org/{isbn}" }]), withAffiliates(DEFAULT_SITES, { BOOKSHOP_AFFILIATE_ID: "12345" }).sites);
    expect(buildLinks(sites, { isbn: "9780060125639" }).find((l) => l.id === "bookshop-uk")?.affiliate).toBeUndefined();
  });
});

describe("wikipedia, CSL-JSON and markdown citations", () => {
  const base = {
    source: "openlibrary",
    id: "isbn:9780060125639",
    title: "The Dispossessed",
    subtitle: "An Ambiguous Utopia",
    authors: ["Ursula K. Le Guin", "Pat Smith"],
    publisher: "Harper Pub.",
    place: "New York",
    publishedDate: "1999-05-14",
    edition: "2nd ed.",
    isbn13: "9780060125639",
    identifiers: { openlibrary_edition: "OL5424470M", openlibrary_work: "OL59863W" },
  };

  it("Wikipedia cite book", () => {
    expect(formatCitation(base, "wikipedia")).toBe(
      "{{cite book |last1=Le Guin |first1=Ursula K. |last2=Smith |first2=Pat |title=The Dispossessed: An Ambiguous Utopia |date=1999-05-14 |edition=2nd ed. |publisher=Harper Pub. |location=New York |isbn=9780060125639 |ol=5424470M}}",
    );
    expect(formatCitation({ ...base, title: "A|B" }, "wikipedia")).toContain("title=A{{!}}B");
  });

  it("CSL-JSON is a valid one-item array", () => {
    const [item] = JSON.parse(formatCitation(base, "csl-json"));
    expect(item.type).toBe("book");
    expect(item.author[0]).toEqual({ family: "Le Guin", given: "Ursula K." });
    expect(item.issued).toEqual({ "date-parts": [[1999, 5, 14]] });
    expect(item["publisher-place"]).toBe("New York");
    expect(item.ISBN).toBe("9780060125639");
    expect(item.edition).toBe("2nd ed.");
  });

  it("markdown: full record", () => {
    expect(formatCitation(base, "markdown", { isbnLink: "https://biblio.co.uk/booksearch/keyisbn/9780060125639" })).toBe(
      "Le Guin, Ursula K.; Smith, Pat (1999) _The Dispossessed: An Ambiguous Utopia_. \\[2nd ed\\]. New York: Harper Pub. [9780060125639](https://biblio.co.uk/booksearch/keyisbn/9780060125639) Open Library: [OL59863W](https://openlibrary.org/works/OL59863W)",
    );
  });

  it("markdown: leaves out what the record lacks", () => {
    const bare = { source: "x", id: "1", title: "Thing", authors: ["A. Person"] };
    expect(formatCitation(bare, "markdown")).toBe("Person, A. (n.d.) _Thing_.");
  });
});
