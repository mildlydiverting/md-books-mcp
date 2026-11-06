import type { BookProvider } from "../types.js";
import { googleBooksProvider } from "./googlebooks.js";
import { hardcoverProvider } from "./hardcover.js";
import { locProvider } from "./loc.js";
import { wikidataProvider } from "./wikidata.js";
import { openLibraryProvider } from "./openlibrary.js";

/**
 * All known providers, in default fan-out order. To add a source, import it
 * here and add it to this list. Nothing else needs to change.
 */
export const providers: BookProvider[] = [openLibraryProvider, locProvider, hardcoverProvider, wikidataProvider, googleBooksProvider];

const byId = new Map(providers.map((p) => [p.id, p]));

export function getProvider(id: string): BookProvider | undefined {
  return byId.get(id);
}

export function availableProviders(): BookProvider[] {
  return providers.filter((p) => p.isAvailable());
}
