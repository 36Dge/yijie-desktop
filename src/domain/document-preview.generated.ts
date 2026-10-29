// Generated from chat-document-preview-v1.schema.json; do not edit.
// SHA256 0f7b357120192640d26a68bb84b521d38bfab54f62017fed3587a20583325882

export type Source = Readonly<{ kind: "artifact"; sessionId: string; turnId: string; artifactId: string }> | Readonly<{ kind: "attachment"; sessionId: string; messageId: string | null; attachmentId: string }>;
export type Viewport = Readonly<{ x: number; y: number; width: number; height: number; dpr: number }>;
export type Location = Readonly<{ section: number; offset: number; zoom: number; scrollX: number; scrollY: number; revision: string | null }>;
export type Section = Readonly<{ id: number; label: string }>;
export type Action = Readonly<{ action: "open"; viewId: string; source: Source; viewport: Viewport; location: Location; theme: "light" | "dark" }> | Readonly<{ action: "resize"; viewId: string; viewport: Viewport; visible: boolean }> | Readonly<{ action: "position"; viewId: string }> | Readonly<{ action: "close"; viewId: string }>;
export type Request = Readonly<{ schemaVersion: 1; requestId: string; contextId: string; payload: Action }>;
export type Document = Readonly<{ kind: "html" | "text" | "docx" | "pptx" | "xlsx" | "pdf"; revision: string; expiresAt: number; sections: readonly (Section)[]; section: number; offset: number; nextOffset: number | null; previousOffset: number | null; partial: boolean; notice: string | null }>;
export type Position = Readonly<{ scrollX: number; scrollY: number }>;
export type Result = Readonly<{ status: "ready" | "resized" | "position" | "closed"; viewId: string; document: Document | null; position: Position | null }>;
export type Response = Readonly<{ schemaVersion: 1; requestId: string; data: Result }>;
export type Invalidated = Readonly<{ viewId: string; reason: "expired" | "forbidden" | "unavailable" }>;
export type Loaded = Readonly<{ viewId: string }>;
