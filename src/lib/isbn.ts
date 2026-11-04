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
