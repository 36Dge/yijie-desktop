import { createApp } from "vue";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import VisualHarness from "./VisualHarness.vue";

const parameters = new URLSearchParams(window.location.search);
const theme = parameters.get("theme") === "dark" ? "dark" : "light";
const fixture = parameters.get("fixture") === "truncated-unknown"
  ? "truncated-unknown"
  : parameters.get("fixture") === "fallback-error"
    ? "fallback-error"
    : "full-known";
document.documentElement.dataset.theme = theme;

if (fixture === "fallback-error") {
  document.documentElement.style.setProperty("--yj-color-chart-series-1", " ");
}

createApp(VisualHarness, { fixture, theme }).mount("#app");
