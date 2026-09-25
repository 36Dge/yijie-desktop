// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { NDialogProvider, NInput, NSelect } from "naive-ui";
import ScheduledPlanForm from "./ScheduledPlanForm.vue";
const disposers: (()=>void)[]=[];
afterEach(()=>{ disposers.splice(0).forEach(f=>f());document.body.innerHTML=""; });
it("submits a native-previewed paused definition and excludes unsaveable draft targets", async()=>{
  const preview=vi.fn(async()=>({next_at:1800000000,skipped_slots:[],candidates_examined:1,rule_version:1,tzdb_version:"2026b"}));
  const targets=vi.fn(async()=>({items:[{conversation_id:crypto.randomUUID(),title:"草案",updated_at:1,workspace_source:"managed_schedule" as const,can_save:false,execution:"blocked" as const,reason:"target_unavailable" as const}]}));
  const saved=vi.fn();
  const root=mount(defineComponent({setup:()=>()=>h(NDialogProvider,null,{default:()=>h(ScheduledPlanForm,{plan:null,busy:false,uncertain:false,error:"",preview,targets,onSave:saved})})}),{attachTo:document.body});disposers.push(()=>root.unmount());
  const form=root.findComponent(ScheduledPlanForm);const inputs=form.findAllComponents(NInput);
  inputs.find(input=>input.props("inputProps")?.["aria-label"]==="计划名称")!.vm.$emit("update:value","每日检查");
  inputs.find(input=>input.props("inputProps")?.["aria-label"]==="任务内容")!.vm.$emit("update:value","只保存计划");
  await vi.waitFor(()=>expect(preview).toHaveBeenCalled());
  const modes=form.findAllComponents(NSelect);
  modes[1]!.vm.$emit("update:value","existing_chat");
  await vi.waitFor(()=>expect(targets).toHaveBeenCalled());
  const selector=form.findAllComponents(NSelect).slice(-1)[0]!;
  expect(selector.props("options")).toEqual([]);
  modes[1]!.vm.$emit("update:value","new_chat_each_run");
  await form.vm.$nextTick();
  const submit=document.querySelector<HTMLFormElement>("form")!; submit.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
  expect(saved).toHaveBeenCalledOnce();expect(saved.mock.calls[0]![0]).toMatchObject({name:"每日检查",target:{mode:"new_chat_each_run"},rule:{frequency:"daily"}});
});
