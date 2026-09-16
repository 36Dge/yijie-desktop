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
/**
 * 当前 editor 页包含离开会失去的本地内容或待确认操作查询上下文。true 包含可保存草稿差异、仅保留于本页内存且尚不支持持久保存的 UI 设计状态、尚待核对的操作上下文；false 表示当前 producer 确认这些保护条件均不存在。此标志只驱动宿主应用内离开确认，不代表内容已发送或已保存、内容可被 save_draft 接受、执行权限、操作终态或原生窗口及应用退出已被拦截。consumer 不得据此自动保存、试运行、发布或取消既有操作。
 */
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
/**
 * 当前 editor 页包含离开会失去的本地内容或待确认操作查询上下文。true 包含可保存草稿差异、仅保留于本页内存且尚不支持持久保存的 UI 设计状态、尚待核对的操作上下文；false 表示当前 producer 确认这些保护条件均不存在。此标志只驱动宿主应用内离开确认，不代表内容已发送或已保存、内容可被 save_draft 接受、执行权限、操作终态或原生窗口及应用退出已被拦截。consumer 不得据此自动保存、试运行、发布或取消既有操作。
 */
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
/**
 * 当前 editor 页包含离开会失去的本地内容或待确认操作查询上下文。true 包含可保存草稿差异、仅保留于本页内存且尚不支持持久保存的 UI 设计状态、尚待核对的操作上下文；false 表示当前 producer 确认这些保护条件均不存在。此标志只驱动宿主应用内离开确认，不代表内容已发送或已保存、内容可被 save_draft 接受、执行权限、操作终态或原生窗口及应用退出已被拦截。consumer 不得据此自动保存、试运行、发布或取消既有操作。
 */
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
/**
 * 当前 editor 页包含离开会失去的本地内容或待确认操作查询上下文。true 包含可保存草稿差异、仅保留于本页内存且尚不支持持久保存的 UI 设计状态、尚待核对的操作上下文；false 表示当前 producer 确认这些保护条件均不存在。此标志只驱动宿主应用内离开确认，不代表内容已发送或已保存、内容可被 save_draft 接受、执行权限、操作终态或原生窗口及应用退出已被拦截。consumer 不得据此自动保存、试运行、发布或取消既有操作。
 */
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
/**
 * 当前 editor 页包含离开会失去的本地内容或待确认操作查询上下文。true 包含可保存草稿差异、仅保留于本页内存且尚不支持持久保存的 UI 设计状态、尚待核对的操作上下文；false 表示当前 producer 确认这些保护条件均不存在。此标志只驱动宿主应用内离开确认，不代表内容已发送或已保存、内容可被 save_draft 接受、执行权限、操作终态或原生窗口及应用退出已被拦截。consumer 不得据此自动保存、试运行、发布或取消既有操作。
 */
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
/**
 * 当前 editor 页包含离开会失去的本地内容或待确认操作查询上下文。true 包含可保存草稿差异、仅保留于本页内存且尚不支持持久保存的 UI 设计状态、尚待核对的操作上下文；false 表示当前 producer 确认这些保护条件均不存在。此标志只驱动宿主应用内离开确认，不代表内容已发送或已保存、内容可被 save_draft 接受、执行权限、操作终态或原生窗口及应用退出已被拦截。consumer 不得据此自动保存、试运行、发布或取消既有操作。
 */
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
/**
 * 当前 editor 页包含离开会失去的本地内容或待确认操作查询上下文。true 包含可保存草稿差异、仅保留于本页内存且尚不支持持久保存的 UI 设计状态、尚待核对的操作上下文；false 表示当前 producer 确认这些保护条件均不存在。此标志只驱动宿主应用内离开确认，不代表内容已发送或已保存、内容可被 save_draft 接受、执行权限、操作终态或原生窗口及应用退出已被拦截。consumer 不得据此自动保存、试运行、发布或取消既有操作。
 */
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
