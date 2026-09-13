/* Canonical workflow source validator declarations. DO NOT EDIT. */
import type { components } from "../../domain/workflow-local.generated.js";
import type { WorkflowEditorBridgeV1 } from "../../domain/workflow-editor-bridge.generated.js";
export type SchemaName = keyof components["schemas"];
export declare const validators: { readonly [K in SchemaName]: (value: unknown) => value is components["schemas"][K] };
export declare function validateBridge(value: unknown): value is WorkflowEditorBridgeV1;
