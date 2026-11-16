// Generated from builtin-web-retrieval/1. DO NOT EDIT.

export type McpServerElicitationRequestParams = {
  serverName: string;
  threadId: string;
  /**
   * Active Codex turn when this elicitation was observed, if app-server could correlate one.
   *
   * This is nullable because MCP models elicitation as a standalone server-to-client request identified by the MCP server request id. It may be triggered during a turn, but turn context is app-server correlation rather than part of the protocol identity of the elicitation itself.
   */
  turnId?: string | null;
  [k: string]: unknown;
} & (
  | {
      _meta?: unknown;
      message: string;
      mode: "form";
      requestedSchema: McpElicitationSchema;
      [k: string]: unknown;
    }
  | {
      _meta?: unknown;
      message: string;
      mode: "openai/form";
      requestedSchema: unknown;
      [k: string]: unknown;
    }
  | {
      _meta?: unknown;
      elicitationId: string;
      message: string;
      mode: "url";
      url: string;
      [k: string]: unknown;
    }
);
export type McpElicitationPrimitiveSchema =
  McpElicitationEnumSchema | McpElicitationStringSchema | McpElicitationNumberSchema | McpElicitationBooleanSchema;
export type McpElicitationEnumSchema =
  McpElicitationSingleSelectEnumSchema | McpElicitationMultiSelectEnumSchema | McpElicitationLegacyTitledEnumSchema;
export type McpElicitationSingleSelectEnumSchema =
  McpElicitationUntitledSingleSelectEnumSchema | McpElicitationTitledSingleSelectEnumSchema;
export type McpElicitationStringType = "string";
export type McpElicitationMultiSelectEnumSchema =
  McpElicitationUntitledMultiSelectEnumSchema | McpElicitationTitledMultiSelectEnumSchema;
export type McpElicitationArrayType = "array";
export type McpElicitationStringFormat = "email" | "uri" | "date" | "date-time";
export type McpElicitationNumberType = "number" | "integer";
export type McpElicitationBooleanType = "boolean";
export type McpElicitationObjectType = "object";

/**
 * Typed form schema for MCP `elicitation/create` requests.
 *
 * This matches the `requestedSchema` shape from the MCP 2025-11-25 `ElicitRequestFormParams` schema.
 */
export interface McpElicitationSchema {
  $schema?: string | null;
  properties: {
    [k: string]: McpElicitationPrimitiveSchema;
  };
  required?: string[] | null;
  type: McpElicitationObjectType;
}
export interface McpElicitationUntitledSingleSelectEnumSchema {
  default?: string | null;
  description?: string | null;
  enum: string[];
  title?: string | null;
  type: McpElicitationStringType;
}
export interface McpElicitationTitledSingleSelectEnumSchema {
  default?: string | null;
  description?: string | null;
  oneOf: McpElicitationConstOption[];
  title?: string | null;
  type: McpElicitationStringType;
}
export interface McpElicitationConstOption {
  const: string;
  title: string;
}
export interface McpElicitationUntitledMultiSelectEnumSchema {
  default?: string[] | null;
  description?: string | null;
  items: McpElicitationUntitledEnumItems;
  maxItems?: number | null;
  minItems?: number | null;
  title?: string | null;
  type: McpElicitationArrayType;
}
export interface McpElicitationUntitledEnumItems {
  enum: string[];
  type: McpElicitationStringType;
}
export interface McpElicitationTitledMultiSelectEnumSchema {
  default?: string[] | null;
  description?: string | null;
  items: McpElicitationTitledEnumItems;
  maxItems?: number | null;
  minItems?: number | null;
  title?: string | null;
  type: McpElicitationArrayType;
}
export interface McpElicitationTitledEnumItems {
  anyOf: McpElicitationConstOption[];
}
export interface McpElicitationLegacyTitledEnumSchema {
  default?: string | null;
  description?: string | null;
  enum: string[];
  enumNames?: string[] | null;
  title?: string | null;
  type: McpElicitationStringType;
}
export interface McpElicitationStringSchema {
  default?: string | null;
  description?: string | null;
  format?: McpElicitationStringFormat | null;
  maxLength?: number | null;
  minLength?: number | null;
  title?: string | null;
  type: McpElicitationStringType;
}
export interface McpElicitationNumberSchema {
  default?: number | null;
  description?: string | null;
  maximum?: number | null;
  minimum?: number | null;
  title?: string | null;
  type: McpElicitationNumberType;
}
export interface McpElicitationBooleanSchema {
  default?: boolean | null;
  description?: string | null;
  title?: string | null;
  type: McpElicitationBooleanType;
}
// Generated from builtin-web-retrieval/1. DO NOT EDIT.

export type McpServerElicitationAction = "accept" | "decline" | "cancel";

export interface McpServerElicitationRequestResponse {
  /**
   * Optional client metadata for form-mode action handling.
   */
  _meta?: {
    [k: string]: unknown;
  };
  action: McpServerElicitationAction;
  /**
   * Structured user input for accepted elicitations, mirroring RMCP `CreateElicitationResult`.
   *
   * This is nullable because decline/cancel responses have no content.
   */
  content?: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
