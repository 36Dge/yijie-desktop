// @vitest-environment happy-dom
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { NDialogProvider } from "naive-ui";
import { afterEach, expect, it, vi } from "vitest";
import ChatPage from "./ChatPage.vue";
import { useChatStore } from "../../stores/chat.store";
import { usePermissionStore } from "../../stores/permission.store";
import { queueScheduleDraftIntent, clearScheduleDraftIntent, SCHEDULE_DRAFT_GUIDE } from "../../domain/scheduled-draft-intent";

const native = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onDragDropEvent: async () => () => undefined }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: {request:{requestId:string}}) => {
  native.calls.push(command);
  if (command === "schedule_operation_capabilities_v1") return {schemaVersion:1,requestId:args.request.requestId,data:Object.fromEntries(["read","save","draft","manual","automatic","single_run"].map(k=>[k,{available:k!=="manual"&&k!=="automatic"&&k!=="single_run",reason:k==="manual"||k==="automatic"||k==="single_run"?"candidate_disabled":"ready"}]))};
  if (command === "schedule_submit_draft_v1") throw {schemaVersion:1,requestId:args.request.requestId,code:"operation_unknown"};
  if (command === "schedule_read_draft_submission_receipt_v1") return {schemaVersion:1,requestId:args.request.requestId,data:{observation:"not_observed"}};
  throw Error(`Unexpected native call ${command}`);
} }));
const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(f=>f());native.calls.length=0;clearScheduleDraftIntent();document.body.innerHTML="";vi.restoreAllMocks(); });
async function page(draft: boolean) {
  const pinia=createPinia();setActivePinia(pinia);
  const permission=usePermissionStore();permission.phase="ready";permission.selectedTenantId=crypto.randomUUID();permission.authorizationRevision=1;
  vi.spyOn(permission,"hasCapability").mockReturnValue(true);
  const chat=useChatStore();chat.phase="ready";chat.context={contextId:crypto.randomUUID(),expiresAtEpochSeconds:2_000_000_000,allowedActions:["read_sessions","create_session","submit_turn","use_project"]};
  chat.localReadiness={lifecycle:"ready",host:"ready",runtime:"ready",storage:"ready",canSend:true,issueCode:null,retryable:false,recovery:"none"};
  if(draft)queueScheduleDraftIntent(permission.selectedTenantId,1);
  const router=createRouter({history:createMemoryHistory(),routes:[{path:"/chat",component:ChatPage},{path:"/chat/:sessionId",component:ChatPage},{path:"/scheduled-tasks",component:{template:"<div>管理页</div>"}}]});
  await router.push(draft ? "/chat?create=schedule" : "/chat");await router.isReady();
  const root=mount(defineComponent({setup:()=>()=>h(NDialogProvider,null,{default:()=>h(RouterView)})}),{attachTo:document.body,global:{plugins:[pinia,router]}});
  disposers.push(()=>root.unmount());await flushPromises();return {root,router,chat};
}
it("prefills only, hides ordinary project/attachment/permission controls, and queries uncertainty without resending",async()=>{
  const {root}=await page(true);
  expect((root.get("textarea").element as HTMLTextAreaElement).value).toBe(SCHEDULE_DRAFT_GUIDE);
  expect(root.find('[aria-label="添加图片或文件"]').exists()).toBe(false);
  expect(root.find('[aria-label="选择本地项目"]').exists()).toBe(false);
  expect(root.find('.chat-composer__permission').exists()).toBe(false);
  expect(native.calls).toEqual(["schedule_operation_capabilities_v1"]);
  await root.get("textarea").setValue("每个工作日生成文本摘要，请询问缺少的时间");
  await root.get('[aria-label="发送任务"]').trigger("click");await flushPromises();
  expect(native.calls.filter(c=>c==="schedule_submit_draft_v1")).toHaveLength(1);
  expect(root.text()).toContain("原请求结果待查证");
  const query=root.findAll("button").find(b=>b.text()==="查证原请求")!;await query.trigger("click");await flushPromises();
  expect(root.text()).toContain("尚未观察到原请求提交");
  expect(native.calls.filter(c=>c==="schedule_submit_draft_v1")).toHaveLength(1);
});
it("keeps an existing unsent input when the default mode-change confirmation is cancelled",async()=>{
  const {root,router}=await page(false);await root.get("textarea").setValue("保留我的未发送草稿");
  await root.findAll("button").find(b=>b.text()==="通过当前输入创建定时任务")!.trigger("click");await flushPromises();
  expect(document.body.textContent).toContain("确认切换");
  (Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="留在对话")!).click();await flushPromises();
  expect(router.currentRoute.value.query.create).toBeUndefined();
  expect((root.get("textarea").element as HTMLTextAreaElement).value).toBe("保留我的未发送草稿");
  expect(native.calls).toEqual([]);
});
