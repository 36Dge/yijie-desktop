// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { NButton, NDialogProvider } from "naive-ui";
import ScheduledPlanForm from "./ScheduledPlanForm.vue";
import type { PlanDefinition } from "../../domain/scheduled-plan-v2.generated";
vi.mock("../../stores/chat.store",()=>({useChatStore:()=>({context:{contextId:"ordinary-context"}})}));
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn()}));
import { chatModelClient } from "../../api/chat-model-client";
import { modelDefinitions } from "../../domain/chat-models-v2.generated";
const disposers: (()=>void)[]=[];
afterEach(()=>{disposers.splice(0).forEach(f=>f());vi.restoreAllMocks();document.body.innerHTML="";});
it.each(["kimi-k3-1-pro-max-v1","kimi-k3-max-v1"] as const)("mounted candidate form preserves explicit model %s through save admission",async model=>{
 vi.spyOn(chatModelClient,"catalog").mockResolvedValue({schema_version:2,default_profile:"kimi-k3-1-pro-max-v1",models:modelDefinitions.map(profile=>({profile,available:true,reason:"ready" as const}))});
 const initialDefinition:PlanDefinition={name:"正常计划",content:"仅保存普通任务",model_profile:model,rule:{frequency:"daily",time_zone:"Asia/Shanghai",local_time:"09:00"},target:{mode:"new_chat_each_run"}};
 const saved=vi.fn();
 const root=mount(defineComponent({setup:()=>()=>h(NDialogProvider,null,{default:()=>h(ScheduledPlanForm,{plan:null,initialDefinition,busy:false,uncertain:false,error:"",preview:async()=>({next_at:1800000000,skipped_slots:[],candidates_examined:1,rule_version:1,tzdb_version:"2026b"}),targets:async()=>({items:[]}),onSave:saved})})}),{attachTo:document.body});
 disposers.push(()=>root.unmount());
 const form=root.findComponent(ScheduledPlanForm);
 await vi.waitFor(()=>expect(document.body.textContent).toContain("启用后预计"));
 const save=form.findAllComponents(NButton).find(b=>b.text()==="保存")!;
 expect(save.props("disabled")).toBe(model==="kimi-k3-max-v1");
 document.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
 if(model==="kimi-k3-max-v1")expect(saved).not.toHaveBeenCalled();
 else {expect(saved).toHaveBeenCalledOnce();expect(saved.mock.calls[0]![0]).toMatchObject({model_profile:model,name:"正常计划"});}
});
