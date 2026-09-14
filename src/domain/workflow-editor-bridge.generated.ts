/* Generated from workflow editor source. Do not edit by hand. */
import type { components } from "./workflow-local.generated.js";

export type WorkflowEditorBridgeV1 = (WorkflowEditorBridgeV11 | WorkflowEditorBridgeV12 | WorkflowEditorBridgeV13 | WorkflowEditorBridgeV14 | WorkflowEditorBridgeV15 | WorkflowEditorBridgeV16 | WorkflowEditorBridgeV17 | WorkflowEditorBridgeV18)

/**
 * Source MessageChannel envelope; data DTOs reference the authoritative workflow-local OpenAPI components.
 */
export interface WorkflowEditorBridgeV11 {
protocol_version: 1
request_id: string
kind: "connect"
bridge_id: string
generation: number
dirty?: boolean
request?: components["schemas"]["EditorExchangeInput"]
response?: components["schemas"]["EditorExchangeResult"]
error?: components["schemas"]["ErrorResponse"]
}
/**
 * Source MessageChannel envelope; data DTOs reference the authoritative workflow-local OpenAPI components.
 */
export interface WorkflowEditorBridgeV12 {
protocol_version: 1
request_id: string
kind: "ready"
bridge_id: string
generation: number
dirty?: boolean
request?: components["schemas"]["EditorExchangeInput"]
response?: components["schemas"]["EditorExchangeResult"]
error?: components["schemas"]["ErrorResponse"]
}
/**
 * Source MessageChannel envelope; data DTOs reference the authoritative workflow-local OpenAPI components.
 */
export interface WorkflowEditorBridgeV13 {
protocol_version: 1
request_id: string
kind: "request"
bridge_id: string
generation: number
dirty?: boolean
request: components["schemas"]["EditorExchangeInput"]
response?: components["schemas"]["EditorExchangeResult"]
error?: components["schemas"]["ErrorResponse"]
}
/**
 * Source MessageChannel envelope; data DTOs reference the authoritative workflow-local OpenAPI components.
 */
export interface WorkflowEditorBridgeV14 {
protocol_version: 1
request_id: string
kind: "response"
bridge_id: string
generation: number
dirty?: boolean
request?: components["schemas"]["EditorExchangeInput"]
response: components["schemas"]["EditorExchangeResult"]
error?: never
}
/**
 * Source MessageChannel envelope; data DTOs reference the authoritative workflow-local OpenAPI components.
 */
export interface WorkflowEditorBridgeV15 {
protocol_version: 1
request_id: string
kind: "response"
bridge_id: string
generation: number
dirty?: boolean
request?: components["schemas"]["EditorExchangeInput"]
response?: never
error: components["schemas"]["ErrorResponse"]
}
/**
 * Source MessageChannel envelope; data DTOs reference the authoritative workflow-local OpenAPI components.
 */
export interface WorkflowEditorBridgeV16 {
protocol_version: 1
request_id: string
kind: "dirty_changed"
bridge_id: string
generation: number
dirty: boolean
request?: components["schemas"]["EditorExchangeInput"]
response?: components["schemas"]["EditorExchangeResult"]
error?: components["schemas"]["ErrorResponse"]
}
/**
 * Source MessageChannel envelope; data DTOs reference the authoritative workflow-local OpenAPI components.
 */
export interface WorkflowEditorBridgeV17 {
protocol_version: 1
request_id: string
kind: "request_close"
bridge_id: string
generation: number
dirty?: boolean
request?: components["schemas"]["EditorExchangeInput"]
response?: components["schemas"]["EditorExchangeResult"]
error?: components["schemas"]["ErrorResponse"]
}
/**
 * Source MessageChannel envelope; data DTOs reference the authoritative workflow-local OpenAPI components.
 */
export interface WorkflowEditorBridgeV18 {
protocol_version: 1
request_id: string
kind: "request_history"
bridge_id: string
generation: number
dirty?: never
request?: never
response?: never
error?: never
}
