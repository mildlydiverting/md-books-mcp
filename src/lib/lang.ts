/** ISO 639-2/3 three-letter codes to ISO 639-1 two-letter codes, for the languages books commonly come in. */
const THREE_TO_TWO: Record<string, string> = {
  eng: "en", fre: "fr", fra: "fr", ger: "de", deu: "de", spa: "es", ita: "it", por: "pt", dut: "nl", nld: "nl",
  rus: "ru", lat: "la", grc: "el", gre: "el", ell: "el", jpn: "ja", chi: "zh", zho: "zh", ara: "ar", heb: "he",
  swe: "sv", dan: "da", nor: "no", pol: "pl", wel: "cy", cym: "cy", gle: "ga",
};

export function toTwoLetterLanguage(code: string | undefined): string | undefined {
  return code ? THREE_TO_TWO[code.toLowerCase()] : undefined;
}
