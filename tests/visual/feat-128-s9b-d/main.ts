import { createApp } from "vue";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import VisualHarness from "./VisualHarness.vue";

const parameters = new URLSearchParams(window.location.search);
const theme = parameters.get("theme") === "dark" ? "dark" : "light";
const fixture = parameters.get("fixture") === "fallback"
  ? "fallback"
  : parameters.get("fixture") === "error"
    ? "error"
    : "full";
document.documentElement.dataset.theme = theme;

createApp(VisualHarness, { fixture, theme }).mount("#app");
