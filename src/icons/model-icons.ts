import { h, type FunctionalComponent } from "vue";
import kimi from "./custom/brands/kimi.svg?no-inline";
import minimax from "./custom/brands/minimax.svg?no-inline";
import deepseek from "./custom/brands/deepseek.svg?no-inline";
import glm from "./custom/brands/glm.svg?no-inline";

// Official monochrome marks; source and usage notes live beside the SVGs.
function modelIcon(source: string, viewBox: string): FunctionalComponent<{ size?: number }> {
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

export const ModelKimi = modelIcon(kimi, "0 0 1024 1024");
export const ModelMiniMax = modelIcon(minimax, "0 0 32 32");
export const ModelDeepSeek = modelIcon(deepseek, "0 0 27 23");
export const ModelGlm = modelIcon(glm, "4 4 22 22");
