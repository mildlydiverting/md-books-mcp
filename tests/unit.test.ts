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
  it("APA", () => {
    expect(formatCitation(book, "apa")).toBe("Le Guin, U. K. (2003). *The Dispossessed: An Ambiguous Utopia*. Harper.");
  });
  it("MLA", () => {
    expect(formatCitation(book, "mla")).toBe("Le Guin, Ursula K. *The Dispossessed: An Ambiguous Utopia*. Harper, 2003.");
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
      publish_date: "2003",
      identifiers: { isbn_13: ["9780141439518"] },
    });
    expect(b).toMatchObject({ id: "isbn:9780141439518", publisher: "Penguin Books", publishedDate: "2003", isbn13: "9780141439518" });
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
    <originInfo><dateIssued encoding="marc">1974</dateIssued><agent><namePart>Harper &amp; Row</namePart></agent><dateIssued>[1974]</dateIssued></originInfo>
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
