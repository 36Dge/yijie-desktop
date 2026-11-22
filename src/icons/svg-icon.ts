import { h, type FunctionalComponent } from "vue";

/** Render the mark from a local SVG using the caller's size and color. */
export function svgIcon(source: string, viewBox: string): FunctionalComponent<{ size?: number }> {
  const icon: FunctionalComponent<{ size?: number }> = (props, { attrs }) => h("svg", {
    ...attrs,
    width: props.size ?? 18,
    height: props.size ?? 18,
    viewBox,
  }, [h("use", { href: `${source}#mark` })]);
  icon.props = ["size"];
  icon.inheritAttrs = false;
  return icon;
}
