// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { afterEach, expect, it, vi } from "vitest";
import axe from "axe-core";
import { workflowNativeClient as native, WorkflowNativeError, type WorkflowSchemas } from "../../api/workflow-native-client";
import WorkflowPage from "./WorkflowPage.vue";
vi.mock("../../authorization/workflow-local-ui-config", () => ({ workflowLocalUiEnabled: true }));
const workflow: WorkflowSchemas["Workflow"] = { workflow_id: "15301", revision: "15302", name: "中文流程", description: "本地文本整理", canvas: '{"nodes":[],"edges":[]}', runnable: false, updated_at_ms: 1 };
const status: WorkflowSchemas["ServiceStatus"] = { protocol_version: 1, ready: true, state: "ready", run_epoch: "15300000-0000-4000-8000-000000000001", limits: { input_bytes: 4096, prefix_bytes: 1024, output_bytes: 5120, canvas_bytes: 262144, message_bytes: 524288, max_active_runs: 1, execution_budget_seconds: 30, editor_ttl_seconds: 300 } };
let wrapper: VueWrapper;
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); document.body.innerHTML = ""; });
async function setup() {
 vi.spyOn(native,"status").mockResolvedValue(status); vi.spyOn(native,"list").mockResolvedValue({ items: [] });
 const open = vi.spyOn(native,"open"); const create = vi.spyOn(native,"create").mockResolvedValue(workflow);
 const router=createRouter({history:createMemoryHistory(),routes:[{path:"/workflows",component:WorkflowPage},{path:"/workflows/:workflowId",name:"workflow-editor",component:{template:"<h1>工作流编辑页面</h1>"}},{path:"/chat",component:{template:"<div>Chat</div>"}}]});
 await router.push("/workflows"); wrapper=mount(RouterView,{attachTo:document.body,global:{plugins:[router]}});await flushPromises();
 await wrapper.get(".workflow-page__create-card").trigger("click");await flushPromises();
 return {router,create,open};
}
const button=(text:string)=>Array.from(document.querySelectorAll("button")).find(b=>b.textContent?.trim()===text)!;
async function fill(name="中文流程",description="本地文本整理") {
 const input=document.querySelector<HTMLInputElement>("#workflow-create-name")!; input.value=name;input.dispatchEvent(new Event("input",{bubbles:true}));
 const area=document.querySelector<HTMLTextAreaElement>("#workflow-create-description")!;area.value=description;area.dispatchEvent(new Event("input",{bubbles:true}));await flushPromises();
}
it("opens a labelled required form; ordinary corrections and cancellation never create",async()=>{
 const {create,router}=await setup();expect(create).not.toHaveBeenCalled();expect(button("确认").disabled).toBe(true);
 await fill("中".repeat(31),"描述");document.querySelector<HTMLInputElement>("#workflow-create-name")!.dispatchEvent(new Event("blur"));await flushPromises();
 expect(button("确认").disabled).toBe(true);expect(document.body.textContent).toContain("工作流名称不能超过 30 个字");
 await fill("中文流程","界".repeat(601));expect(button("确认").disabled).toBe(true);
 await fill();expect(button("确认").disabled).toBe(false);
 const a11y=await axe.run(document.querySelector('[role="dialog"]')!,{rules:{region:{enabled:false}}});expect(a11y.violations.filter(v=>v.impact==="critical"||v.impact==="serious")).toEqual([]);
 button("取消").click();await flushPromises();expect(create).not.toHaveBeenCalled();expect(router.currentRoute.value.path).toBe("/workflows");
});
it("waits for confirmed ID and prevents repeat writes before navigating without opening a departing session",async()=>{
 const {create,router,open}=await setup();let resolve!:(w:WorkflowSchemas["Workflow"])=>void;create.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 await fill();button("确认").click();await flushPromises();
 expect(create).toHaveBeenCalledExactlyOnceWith({name:"中文流程",description:"本地文本整理"});expect(router.currentRoute.value.path).toBe("/workflows");expect(button("取消").disabled).toBe(true);
 document.querySelector("form.workflow-create-dialog__form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await flushPromises();expect(create).toHaveBeenCalledOnce();
 await router.push("/chat");expect(router.currentRoute.value.path).toBe("/workflows");
 resolve(workflow);await flushPromises();expect(router.currentRoute.value.path).toBe("/workflows/15301");expect(open).not.toHaveBeenCalled();
});
it("retains unknown create operation and queries it before entering the confirmed workflow",async()=>{
 const {create,router,open}=await setup();const operation="15300000-0000-4000-8000-000000000003";
 create.mockRejectedValueOnce(new WorkflowNativeError("operation_unknown",operation));
 const query=vi.spyOn(native,"query").mockResolvedValue({receipt:{operation_id:operation,kind:"create",phase:"completed",workflow_id:"15301"}});
 await fill();button("确认").click();await flushPromises();expect(button("取消").disabled).toBe(true);expect(document.querySelector<HTMLInputElement>("#workflow-create-name")!.value).toBe("中文流程");
 button("查询创建结果").click();await flushPromises();expect(query).toHaveBeenCalledExactlyOnceWith({kind:"operation",operation_id:operation});expect(create).toHaveBeenCalledOnce();expect(router.currentRoute.value.path).toBe("/workflows/15301");expect(open).not.toHaveBeenCalled();
});
