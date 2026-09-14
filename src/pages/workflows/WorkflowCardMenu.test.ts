// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { afterEach, expect, it, vi } from "vitest";
import axe from "axe-core";
import WorkflowPage from "./WorkflowPage.vue";
import { workflowNativeClient as native, WorkflowNativeError, type WorkflowSchemas } from "../../api/workflow-native-client";
vi.mock("../../authorization/workflow-local-ui-config", () => ({ workflowLocalUiEnabled: true }));
const row: WorkflowSchemas["WorkflowSummary"] = { workflow_id:"15301",revision:"15302",name:"菜单合成流程",description:"正常文本整理",runnable:false,updated_at_ms:1 };
let wrapper:VueWrapper;
afterEach(()=>{wrapper?.unmount();vi.restoreAllMocks();document.body.innerHTML="";});
async function setup() {
 vi.spyOn(native,"status").mockResolvedValue({ protocol_version:1,ready:true,state:"ready",run_epoch:"15300000-0000-4000-8000-000000000001",limits:{input_bytes:4096,prefix_bytes:1024,output_bytes:5120,canvas_bytes:262144,message_bytes:524288,max_active_runs:1,execution_budget_seconds:30,editor_ttl_seconds:300} });
 vi.spyOn(native,"list").mockResolvedValue({items:[row]});
 const remove=vi.spyOn(native,"delete").mockResolvedValue({workflow_id:row.workflow_id,deleted:true});
 const router=createRouter({history:createMemoryHistory(),routes:[{path:"/workflows",component:WorkflowPage},{path:"/workflows/:workflowId",name:"workflow-editor",component:{template:"<h1>编辑页面</h1>"}},{path:"/chat",component:{template:"<h1>Chat</h1>"}}]});
 await router.push("/workflows");wrapper=mount(RouterView,{attachTo:document.body,global:{plugins:[router]}});await flushPromises();
 return {router,remove};
}
async function menu(label:string) {
 await wrapper.get('button[aria-label="菜单合成流程，更多"]').trigger("click");await flushPromises();
 const options=Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
 expect(options.map(n=>n.textContent?.trim())).toEqual(["编辑","删除"]);
 options.find(n=>n.textContent?.trim()===label)!.click();await flushPromises();
}
const dialog=()=>document.querySelector('[role="alertdialog"]')!;
const button=(label:string)=>Array.from(dialog().querySelectorAll<HTMLButtonElement>('button')).find(n=>n.textContent?.trim()===label)!;
it("More opens two actions; Edit routes to the selected real workflow",async()=>{
 const {router,remove}=await setup();await menu("编辑");expect(router.currentRoute.value.path).toBe('/workflows/15301');expect(remove).not.toHaveBeenCalled();
});
it("Delete first confirms the named resource; cancelling keeps the card and makes no write",async()=>{
 const {remove}=await setup();await menu("删除");expect(dialog().textContent).toContain('确定删除“菜单合成流程”吗');expect(remove).not.toHaveBeenCalled();
 const result=await axe.run(dialog(),{rules:{region:{enabled:false}}});expect(result.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
 button("取消").click();await flushPromises();expect(remove).not.toHaveBeenCalled();expect(wrapper.find('a[href="/workflows/15301"]').exists()).toBe(true);
});
it("retains the card until confirmed; stale list responses cannot restore it",async()=>{
 const {router,remove}=await setup();let finish!:(v:WorkflowSchemas['DeleteResult'])=>void;remove.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await menu("删除");button("删除工作流").click();await flushPromises();
 expect(remove).toHaveBeenCalledExactlyOnceWith({workflow_id:'15301',expected_revision:'15302'});expect(wrapper.find('a[href="/workflows/15301"]').exists()).toBe(true);expect(button("取消").disabled).toBe(true);
 await router.push('/chat');expect(router.currentRoute.value.path).toBe('/workflows');
 finish({workflow_id:'15301',deleted:true});await flushPromises();expect(wrapper.find('a[href="/workflows/15301"]').exists()).toBe(false);expect(wrapper.text()).toContain('已删除“菜单合成流程”');
});
it("ambiguous deletion retries exactly the original ID/revision",async()=>{
 const {remove}=await setup();remove.mockRejectedValueOnce(new WorkflowNativeError('operation_unknown'));
 await menu("删除");button("删除工作流").click();await flushPromises();expect(button("取消").disabled).toBe(true);expect(wrapper.find('a[href="/workflows/15301"]').exists()).toBe(true);
 button("重试确认删除").click();await flushPromises();expect(remove.mock.calls).toEqual([[{workflow_id:'15301',expected_revision:'15302'}],[{workflow_id:'15301',expected_revision:'15302'}]]);expect(wrapper.find('a[href="/workflows/15301"]').exists()).toBe(false);
});

it("a retry preflight failure cannot erase an earlier uncertain deletion",async()=>{
 const {remove}=await setup();remove.mockRejectedValueOnce(new WorkflowNativeError('operation_unknown')).mockRejectedValueOnce(new WorkflowNativeError('service_unavailable'));
 await menu("删除");button("删除工作流").click();await flushPromises();button("重试确认删除").click();await flushPromises();
 expect(button("取消").disabled).toBe(true);expect(button("重试确认删除")).toBeDefined();expect(wrapper.find('a[href="/workflows/15301"]').exists()).toBe(true);
});
