// @vitest-environment happy-dom
import { h, KeepAlive } from "vue";
import { NMessageProvider } from "naive-ui";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { afterEach, expect, it, vi } from "vitest";
import axe from "axe-core";
import WorkflowPage from "./WorkflowPage.vue";
import { MY_WORKFLOWS } from "../../domain/workflow-showcase";
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
 await router.push("/workflows");wrapper=mount(NMessageProvider,{slots:{default:()=>h(RouterView,{}, {default: ({Component}: {Component: ReturnType<typeof h>}) => h(KeepAlive,{include:['WorkflowPage'],max:1},()=>Component)})},attachTo:document.body,global:{plugins:[router]}});await flushPromises();
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
it.each(MY_WORKFLOWS.flatMap(example => ["编辑", "删除"].map(action => ({ example, action }))))("example $example.title $action only shows a toast and preserves every workflow", async ({ example, action }) => {
 const {router,remove}=await setup();
 const originalCards=wrapper.findAll(".workflow-summary-card__title").map(card=>card.text());
  const trigger=wrapper.get(`button[aria-label="${example.title}，更多"]`);
  await trigger.trigger("click");await flushPromises();
  const options=Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  expect(options.map(option=>option.textContent?.trim())).toEqual(["编辑","删除"]);
  options.find(option=>option.textContent?.trim()===action)!.click();await flushPromises();
  expect(document.querySelector(".n-message")?.textContent).toContain("示例工作流，暂不支持操作");
  expect(trigger.attributes("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger.element);
  expect(router.currentRoute.value.path).toBe("/workflows");
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(remove).not.toHaveBeenCalled();
  expect(wrapper.findAll(".workflow-summary-card__title").map(card=>card.text())).toEqual(originalCards);
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
 finish({workflow_id:'15301',deleted:true});await flushPromises();expect(wrapper.find('a[href="/workflows/15301"]').exists()).toBe(false);expect(wrapper.text()).not.toContain('已删除');
 await router.push('/chat');await router.push('/workflows');await flushPromises();
 expect(wrapper.find('a[href="/workflows/15301"]').exists()).toBe(false);expect(wrapper.text()).not.toContain('已删除');
});

it.each(['/chat', '/workflows/15301'])("returning from %s retains the rail while the list refreshes in place", async destination => {
 const {router}=await setup();
 expect(native.list).toHaveBeenCalledTimes(1);
 const rail=wrapper.get<HTMLElement>('[aria-label="我的工作流列表"]').element;
 rail.scrollLeft=123;
 let finish!: (value: WorkflowSchemas['WorkflowList']) => void;
 // A normal delayed response, with no service/process manipulation.
 vi.mocked(native.list).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await router.push(destination);await router.push('/workflows');await flushPromises();
 expect(wrapper.get('[aria-label="我的工作流列表"]').element).toBe(rail);
 expect(rail.scrollLeft).toBe(123);
 expect(wrapper.find('a[href="/workflows/15301"]').exists()).toBe(true);
 expect(wrapper.text()).not.toContain('正在读取');
 expect(wrapper.get('.workflow-card-rail').attributes('aria-busy')).toBe('true');
 finish({items:[{...row,name:'更新后的流程'}]});await flushPromises();
 expect(wrapper.text()).toContain('更新后的流程');
 expect(wrapper.get('.workflow-card-rail').attributes('aria-busy')).toBe('false');
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
