import { describe, expect, it } from "vitest";
import examples from "../../tests/fixtures/user-message-web-links.json";
import { userMessageUrlParts } from "./user-message-urls";

describe("literal URLs in submitted user text", () => {
  it.each(examples)("retains every original character and identifies public URLs (example %#)", ({text, urls}) => {
    const parts = userMessageUrlParts(text);
    expect(parts.map(part => part.text).join("")).toBe(text);
    expect(parts.filter(part => part.link).map(part => part.text)).toEqual(urls);
    for (const part of parts) expect(text.slice(part.start, part.start + part.text.length)).toBe(part.text);
  });
});
