import type { ExpertShowcase } from "../domain/expert-showcase";

/** All ten imported experts now come exclusively from the reviewed Native catalog.
 * An old/unavailable catalog must never synthesize executable expert cards.
 * Keep the display-only type available for existing presentation components.
 */
export const expertShowcaseCatalog: readonly ExpertShowcase[] = [];
