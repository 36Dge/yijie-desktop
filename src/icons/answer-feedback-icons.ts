import { createLucideIcon } from "@lucide/vue";

// Rounded answer-toolbar variants of the @lucide/vue 1.27.0 outlines.
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

export const AnswerCopy = createLucideIcon("answer-copy", [
  ["rect", { x: 8, y: 8, width: 13, height: 13, rx: 3 }],
  ["path", { d: "M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" }],
]);

function thumbNodes(filled = false, down = false): Parameters<typeof createLucideIcon>[1] {
  const appearance: Record<string, string> = { fill: filled ? "currentColor" : "none" };
  if (down) appearance.transform = "rotate(180 12 12)";
  return [
    ["path", {
      d: "M7.8 10.5c1.6-1.7 3.4-4.5 4.3-7a1.8 1.8 0 0 1 2.6-1c1.3.7 1.6 2.3 1.1 3.8L14.7 10h4a2.7 2.7 0 0 1 2.6 3.4l-1.5 5.4a3 3 0 0 1-2.9 2.2H9.8a2 2 0 0 1-2-2Z",
      ...appearance,
    }],
    ["rect", { x: 2.5, y: 10.5, width: 3.3, height: 10.5, rx: 1.6, ...appearance }],
  ];
}

export const AnswerThumbsUp = createLucideIcon("answer-thumbs-up", thumbNodes());
export const AnswerThumbsDown = createLucideIcon("answer-thumbs-down", thumbNodes(false, true));
export const ThumbsUpFilled = createLucideIcon("thumbs-up-filled", thumbNodes(true));
export const ThumbsDownFilled = createLucideIcon("thumbs-down-filled", thumbNodes(true, true));
