import { createLucideIcon } from "@lucide/vue";

// Filled selection variants of the existing @lucide/vue 1.27.0 thumb outlines.
// Keep a transparent gap between the cuff and palm, including on dark surfaces.
// Copyright (c) 2026 Lucide Icons and Contributors (ISC)
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

export const ThumbsUpFilled = createLucideIcon("thumbs-up-filled", [
  ["path", {
    d: "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22h-9V10.12L12 2a3.13 3.13 0 0 1 3 3.88Z",
    fill: "currentColor",
  }],
  ["rect", { x: 2, y: 10, width: 3, height: 12, rx: 1, fill: "currentColor" }],
]);

export const ThumbsDownFilled = createLucideIcon("thumbs-down-filled", [
  ["path", {
    d: "M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2h9v11.88L12 22a3.13 3.13 0 0 1-3-3.88Z",
    fill: "currentColor",
  }],
  ["rect", { x: 19, y: 2, width: 3, height: 12, rx: 1, fill: "currentColor" }],
]);
