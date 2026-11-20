/** Strip hyphens and spaces; uppercase a trailing X. */
export function cleanIsbn(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  const sum = [...isbn].reduce((acc, ch, i) => acc + (ch === "X" ? 10 : Number(ch)) * (10 - i), 0);
  return sum % 11 === 0;
}

export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  const sum = [...isbn].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  return sum % 10 === 0;
}

/** True for a checksum-valid ISBN-10 or ISBN-13, hyphens allowed. */
export function isValidIsbn(raw: string): boolean {
  const isbn = cleanIsbn(raw);
  return isValidIsbn10(isbn) || isValidIsbn13(isbn);
}

/** ISBN-13 for a valid ISBN-10 or ISBN-13 (978 prefix for ISBN-10). Empty string if invalid. */
export function toIsbn13(raw: string): string {
  const isbn = cleanIsbn(raw);
  if (isValidIsbn13(isbn)) return isbn;
  if (!isValidIsbn10(isbn)) return "";
  const body = `978${isbn.slice(0, 9)}`;
  const sum = [...body].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** ISBN-10 for a valid ISBN-10, or a valid 978-prefixed ISBN-13. Empty string otherwise (979 has no ISBN-10). */
export function toIsbn10(raw: string): string {
  const isbn = cleanIsbn(raw);
  if (isValidIsbn10(isbn)) return isbn;
  if (!isValidIsbn13(isbn) || !isbn.startsWith("978")) return "";
  const body = isbn.slice(3, 12);
  const sum = [...body].reduce((acc, ch, i) => acc + Number(ch) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return `${body}${check === 10 ? "X" : check}`;
}
