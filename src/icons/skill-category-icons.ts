import { h, type Component, type FunctionalComponent } from "vue";
import {
  ChartNoAxesCombined,
  Megaphone,
  MousePointerClick,
  PackageSearch,
  Wrench,
} from "@lucide/vue";

/** Heading-only accents on the existing Lucide silhouettes. The original
 * geometry, sizing, stroke weight and accessibility attributes stay intact.
 * Card icons intentionally keep their separate, monochrome registry entries. */
function withLimeStrokes(base: Component, paths: readonly string[]): FunctionalComponent {
  const icon: FunctionalComponent = (_, { attrs }) => h(base, attrs, {
    default: () => paths.map((d) => h("path", {
      d,
      stroke: "var(--yj-color-brand-primary)",
      "aria-hidden": "true",
    })),
  });
  icon.inheritAttrs = false;
  return icon;
}

// Accent geometry follows @lucide/vue 1.27.0 (ISC), already a project dependency.
// Copyright (c) 2026 Lucide Icons and Contributors
// Permission to use, copy, modify, and/or distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
export const SkillCategorySourcing = withLimeStrokes(PackageSearch, [
  "m7.5 4.27 8.997 5.148",
]);
export const SkillCategoryResearch = withLimeStrokes(ChartNoAxesCombined, [
  "m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15",
]);
export const SkillCategoryContent = withLimeStrokes(Megaphone, ["M8 6v8"]);
export const SkillCategoryTraffic = withLimeStrokes(MousePointerClick, [
  "M14 4.1 12 6",
  "m5.1 8-2.9-.8",
  "m6 12-1.9 2",
  "M7.2 2.2 8 5.1",
]);
export const SkillCategoryOperations = withLimeStrokes(Wrench, ["m6 18 6-6"]);
