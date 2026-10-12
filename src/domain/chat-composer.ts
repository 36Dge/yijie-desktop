export type ChatComposerSubmissionState = "idle" | "validating" | "submitting";

export type ChatComposerFocusSnapshot = Readonly<{
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: "forward" | "backward" | "none";
}>;

export interface ChatComposerHandle {
  focusInput?(): boolean;
  captureInputFocus(): ChatComposerFocusSnapshot | null;
  restoreInputFocus(snapshot: ChatComposerFocusSnapshot): boolean;
}
