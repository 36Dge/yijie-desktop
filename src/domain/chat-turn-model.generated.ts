// Generated from chat-turn-model-v1.schema.json. Do not edit.
// SHA256 d8944c12c8e6114c161faa3c6607d0ed9971945ebdcf46e4984e86b4d55df6dc
export interface TurnModelRequest {
  readonly sessionId: string;
  readonly turnId: string;
}
export interface TurnModelView {
  readonly sessionId: string;
  readonly turnId: string;
  readonly profileId: string | null;
}
