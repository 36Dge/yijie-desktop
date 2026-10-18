/** Local display content only. Intentionally independent of executable expert contracts. */
export interface ExpertShowcase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string | null;
  readonly iconUrl: string | null;
  readonly tags: readonly string[];
  readonly quickPrompts: readonly string[];
  readonly usageCount: number | null;
  readonly category: string | null;
}
