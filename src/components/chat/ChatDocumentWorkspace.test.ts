// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ChatDocumentWorkspace from "./ChatDocumentWorkspace.vue";
import type { PreviewFile } from "../../domain/conversation-file-preview";
const native = vi.hoisted(() => ({ run: vi.fn(), events: new Map<string, (event: { payload: unknown }) => void>() }));
vi.mock("../../api/chat-document-preview-client", async original => ({ ...await original<object>(), documentPreviewClient: { run: native.run } }));
vi.mock("@tauri-apps/api/event", () => ({ TauriEvent:{WINDOW_FOCUS:"tauri://focus",WINDOW_BLUR:"tauri://blur"}, listen: vi.fn(async (name, callback) => { native.events.set(name,callback); return () => native.events.delete(name); }) }));
const file = (id: string): PreviewFile => ({ source: { kind: "artifact", sessionId: "s", turnId: "t", artifactId: id }, name: `${id}.txt`, mediaType: "text/plain", status: "ready", expiresAt: null });
const document = { kind: "text", revision: "a".repeat(64), expiresAt: Math.floor(Date.now()/1000)+600, sections: [], section: 0, offset: 0, nextOffset: null, previousOffset: null, partial: false, notice: null };
beforeEach(() => {
  native.events.clear(); native.run.mockReset();
  vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue({ x:0,y:0,width:1028,height:600,top:0,left:0,right:1028,bottom:600,toJSON:()=>({}) });
  native.run.mockImplementation(async (_context, action) => ({ status: action.action === "open" ? "ready" : "closed", viewId: action.viewId, document: action.action === "open" ? document : null, position: null }));
});
afterEach(() => vi.restoreAllMocks());
function create() { return mount(ChatDocumentWorkspace, { props: { contextId:"scope", scopeKey:"session", enabled:true }, slots:{default:"Conversation stays mounted"} }); }
it("starts collapsed, creates empty tabs without Native reads, and keeps the conversation mounted", async () => {
  const w=create(); try {
    expect(w.find("aside").exists()).toBe(false); w.vm.toggle(); await flushPromises();
    expect(w.text()).toContain("当前没有文件展示");
    await w.get('[aria-label="新标签页"]').trigger("click");
    expect(w.findAll('[role="tab"]')).toHaveLength(1); expect(native.run).not.toHaveBeenCalled();
    w.vm.toggle(); await flushPromises(); expect(w.text()).toContain("Conversation stays mounted"); expect(w.find("aside").exists()).toBe(false);
    w.vm.toggle(); await flushPromises(); expect(w.findAll('[role="tab"]')).toHaveLength(1);
  } finally { w.unmount(); }
});
it("serializes reads and retains only the latest pending file", async () => {
  const w=create(); let resolve!: (value: unknown)=>void;
  native.run.mockImplementation(async (_context, action) => action.action === "open" ? new Promise(r=>{resolve=r;}) : ({ document:null, position:null }));
  try {
    await flushPromises(); w.vm.openFile(file("one")); await flushPromises();
    w.vm.openFile(file("two")); w.vm.openFile(file("three")); await flushPromises();
    expect(native.run.mock.calls.filter(c=>c[1].action==="open")).toHaveLength(1);
    resolve({ document }); await flushPromises();
    const opens=native.run.mock.calls.filter(c=>c[1].action==="open"); expect(opens).toHaveLength(2); expect(opens[1]![1].source.artifactId).toBe("three");
    w.vm.toggle(); await flushPromises(); resolve({ document }); await flushPromises();
    expect(w.find("aside").exists()).toBe(false); expect(native.run.mock.calls.filter(c=>c[1].action==="open")).toHaveLength(2);
  } finally { w.unmount(); }
});
it("requires Native load completion, then revokes the view on scope change", async () => {
  const w=create(); try {
    await flushPromises(); w.vm.openFile(file("one")); await flushPromises(); expect(w.text()).toContain("正在加载预览");
    const open=native.run.mock.calls.find(c=>c[1].action==="open")![1];
    native.events.get("chat-document-preview-loaded")!({ payload:{viewId:open.viewId} }); await flushPromises();
    expect(w.text()).toContain("只读内容已加载");
    await w.setProps({scopeKey:"other"}); await flushPromises(); expect(w.find("aside").exists()).toBe(false);
    w.vm.toggle(); await flushPromises(); expect(w.findAll('[role="tab"]')).toHaveLength(0);
  } finally { w.unmount(); }
});
it("releases content in the background and reauthorizes on return", async () => {
  const w=create(); try {
    await flushPromises();w.vm.openFile(file("one"));await flushPromises();
    native.events.get("tauri://blur")!({payload:null});await flushPromises();
    expect(w.text()).toContain("预览已暂停，恢复后继续");
    expect(native.run.mock.calls.some(c=>c[1].action==="close")).toBe(true);
    native.events.get("tauri://focus")!({payload:null});await flushPromises();
    expect(native.run.mock.calls.filter(c=>c[1].action==="open")).toHaveLength(2);
  } finally {w.unmount();}
});

it("retains tabs across temporary same-session readiness refresh, but clears on authority change", async () => {
  const w=create(); try {
    await flushPromises(); w.vm.openFile(file("one")); await flushPromises();
    await w.setProps({ enabled:false }); await flushPromises();
    expect(w.find("aside").exists()).toBe(true);
    expect(w.findAll('[role="tab"]')).toHaveLength(1);
    expect(w.text()).toContain("预览已暂停");
    expect(native.run.mock.calls.some(c=>c[1].action==="close")).toBe(true);
    await w.setProps({ enabled:true }); await flushPromises();
    expect(w.findAll('[role="tab"]')).toHaveLength(1);
    expect(native.run.mock.calls.filter(c=>c[1].action==="open")).toHaveLength(2);
    await w.setProps({ scopeKey:"session:permission-revoked",enabled:false }); await flushPromises();
    expect(w.find("aside").exists()).toBe(false);
    await w.setProps({ enabled:true }); w.vm.toggle(); await flushPromises();
    expect(w.findAll('[role="tab"]')).toHaveLength(0);
  } finally { w.unmount(); }
});

it("keeps the same scope's tabs through expiring Native context and reauthorizes the replacement", async () => {
  const w=create(); try {
    await flushPromises(); w.vm.openFile(file("one")); await flushPromises();
    await w.setProps({contextId:null,enabled:false}); await flushPromises();
    expect(w.findAll('[role="tab"]')).toHaveLength(1);
    expect(native.run.mock.calls.some(c=>c[0]==="scope" && c[1].action==="close")).toBe(true);
    await w.setProps({contextId:"renewed",enabled:true}); await flushPromises();
    expect(w.findAll('[role="tab"]')).toHaveLength(1);
    expect(native.run.mock.calls.filter(c=>c[1].action==="open").slice(-1)[0]![0]).toBe("renewed");
    await w.setProps({scopeKey:"different-tenant"}); await flushPromises();
    expect(w.find("aside").exists()).toBe(false);
    w.vm.toggle(); await flushPromises(); expect(w.findAll('[role="tab"]')).toHaveLength(0);
  } finally {w.unmount();}
});

it("hides the Native child for the existing image dialog and restores it after close", async () => {
  const w=create(); const overlay=globalThis.document.createElement("section");
  overlay.setAttribute("role","dialog"); overlay.setAttribute("aria-modal","true");
  const settle=()=>new Promise(resolve=>setTimeout(resolve,35));
  try {
    await flushPromises();w.vm.openFile(file("one"));await flushPromises();
    const open=native.run.mock.calls.find(c=>c[1].action==="open")![1];
    native.events.get("chat-document-preview-loaded")!({payload:{viewId:open.viewId}});await flushPromises();await settle();
    expect(native.run.mock.calls.filter(c=>c[1].action==="resize").slice(-1)[0]![1].visible).toBe(true);
    globalThis.document.body.appendChild(overlay);await settle();
    expect(native.run.mock.calls.filter(c=>c[1].action==="resize").slice(-1)[0]![1].visible).toBe(false);
    overlay.remove();await settle();
    expect(native.run.mock.calls.filter(c=>c[1].action==="resize").slice(-1)[0]![1].visible).toBe(true);
    expect(w.findAll('[role="tab"]')).toHaveLength(1);
  } finally {overlay.remove();w.unmount();}
});
