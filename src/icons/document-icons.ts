import { h, type FunctionalComponent } from "vue";

// Original folded-page artwork for the user-requested solid document style.
// Shared geometry keeps every format aligned in the 28px artifact icon slot.
function documentIcon(color: string, mark: string, strokeWidth = 2.2): FunctionalComponent<{ size?: number }> {
  const icon: FunctionalComponent<{ size?: number }> = (props, { attrs }) => h("svg", {
    ...attrs,
    width: props.size ?? 28,
    height: props.size ?? 28,
    viewBox: "0 0 28 28",
    fill: "none",
    stroke: "none",
  }, [
    h("path", {
      d: "M7 2h10l8 8v12c0 2.5-1.5 4-4 4H7c-2.5 0-4-1.5-4-4V6c0-2.5 1.5-4 4-4Z",
      fill: `var(--yj-color-document-${color})`,
    }),
    h("path", {
      d: "M17 2v4c0 2.5 1.5 4 4 4h4Z",
      fill: "var(--yj-color-document-fold)",
    }),
    h("path", {
      d: mark,
      stroke: "var(--yj-color-document-mark)",
      "stroke-width": strokeWidth,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  ]);
  icon.props = ["size"];
  icon.inheritAttrs = false;
  return icon;
}

export const DocumentMarkdown = documentIcon("markdown", "M9 21v-7.3q0-1 1 .3l4 6 4-6q1-1.3 1-.3V21");
export const DocumentWord = documentIcon("word", "m8 14 2.5 7 3.5-5.5 3.5 5.5 2.5-7");
export const DocumentPresentation = documentIcon("presentation", "M10 22v-9h5a3 3 0 0 1 0 6h-5");
export const DocumentSpreadsheet = documentIcon("spreadsheet", "m10 14 8 8m0-8-8 8");
export const DocumentPdf = documentIcon("pdf", "M6.5 21v-6h1.7a1.6 1.6 0 0 1 0 3.2H6.5m6 2.8v-6h1.3c3.4 0 3.4 6 0 6Zm6.5 0v-6h3m-3 2.8h2.5", 1.35);
export const DocumentText = documentIcon("text", "M9 14h10m-5 0v8");
export const DocumentCode = documentIcon("code", "m10 14-3 3.5 3 3.5m8-7 3 3.5-3 3.5m-3-8-2 9", 1.7);
export const DocumentGeneric = documentIcon("generic", "M8.5 14h11m-11 4h11m-11 4h7", 1.7);
