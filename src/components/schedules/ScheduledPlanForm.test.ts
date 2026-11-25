// @vitest-environment happy-dom
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { NDialogProvider, NInput, NSelect } from "naive-ui";
import ScheduledPlanForm from "./ScheduledPlanForm.vue";
// The modal focus trap uses the actual dialog element to contain the picker.
const mountOptions = { attachTo: document.body, global: { stubs: { transition: false } } };
const disposers: (()=>void)[]=[];
afterEach(()=>{ disposers.splice(0).forEach(f=>f());document.body.innerHTML=""; });
it("submits a native-previewed paused definition and excludes unsaveable draft targets", async()=>{
  const preview=vi.fn(async()=>({next_at:1800000000,skipped_slots:[],candidates_examined:1,rule_version:1,tzdb_version:"2026b"}));
  const targets=vi.fn(async()=>({items:[{conversation_id:crypto.randomUUID(),title:"草案",updated_at:1,workspace_source:"managed_schedule" as const,can_save:false,execution:"blocked" as const,reason:"target_unavailable" as const}]}));
  const saved=vi.fn();
  const root=mount(defineComponent({setup:()=>()=>h(NDialogProvider,null,{default:()=>h(ScheduledPlanForm,{plan:null,busy:false,uncertain:false,error:"",preview,targets,onSave:saved})})}),mountOptions);disposers.push(()=>root.unmount());
  const form=root.findComponent(ScheduledPlanForm);const inputs=form.findAllComponents(NInput);
  expect(preview).toHaveBeenCalledOnce();
  await flushPromises();
  inputs.find(input=>input.props("inputProps")?.["aria-label"]==="任务名称")!.vm.$emit("update:value","每日检查");
  inputs.find(input=>input.props("inputProps")?.["aria-label"]==="任务内容")!.vm.$emit("update:value","只保存计划");
  inputs.find(input=>input.props("inputProps")?.["aria-label"]==="时区")!.vm.$emit("update:value","Asia/Tokyo");
  const body = new DOMWrapper(document.body);
  const time = body.get('button[aria-label="当地时间，09:00"]');
  await time.trigger("click");
  await flushPromises();
  const picker = body.get('[role="dialog"][aria-label="选择计划时间"]');
  const [hours, minutes] = picker.findAll('[role="listbox"]');
  const hourOptions = hours!.findAll('[role="option"]');
  const minuteOptions = minutes!.findAll('[role="option"]');
  expect(hourOptions).toHaveLength(24);
  expect(minuteOptions).toHaveLength(60);
  await hourOptions[0]!.trigger("click");
  await minuteOptions[7]!.trigger("click");
  await picker.get(".schedule-clock__footer button").trigger("click");
  expect(time.text()).toBe("00:07");
  expect(time.attributes("aria-expanded")).toBe("false");
  await vi.waitFor(()=>expect(preview).toHaveBeenLastCalledWith({frequency:"daily",local_time:"00:07",time_zone:"Asia/Tokyo"}));
  const modes=form.findAllComponents(NSelect);
  modes[1]!.vm.$emit("update:value","existing_chat");
  await vi.waitFor(()=>expect(targets).toHaveBeenCalled());
  const selector=form.findAllComponents(NSelect).slice(-1)[0]!;
  expect(selector.props("options")).toEqual([]);
  modes[1]!.vm.$emit("update:value","new_chat_each_run");
  await form.vm.$nextTick();
  const submit=document.querySelector<HTMLFormElement>("form")!; submit.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
  expect(saved).toHaveBeenCalledOnce();expect(saved.mock.calls[0]![0]).toMatchObject({name:"每日检查",target:{mode:"new_chat_each_run"},rule:{frequency:"daily",local_time:"00:07",time_zone:"Asia/Tokyo"}});
});

it("opens the saved month, selects a leap-day by keyboard and keeps the plan's calendar date", async () => {
  const preview = vi.fn(async () => ({next_at:1835413200,skipped_slots:[],candidates_examined:1,rule_version:1,tzdb_version:"2026b"}));
  const initialDefinition = {name:"月末提醒",content:"核对计划",target:{mode:"dedicated_chat" as const},
    rule:{frequency:"once" as const,time_zone:"Pacific/Honolulu",local_date:"2028-03-01",local_time:"00:07"}};
  const root = mount(defineComponent({setup: () => () => h(NDialogProvider,null,{default:() => h(ScheduledPlanForm,{
    plan:null, initialDefinition, busy:false, uncertain:false, error:"", preview, targets:async () => ({items:[]}),
  })})}),mountOptions);
  disposers.push(() => root.unmount());
  await flushPromises();
  const body = new DOMWrapper(document.body);
  const date = body.get('button[aria-label="运行日期，2028-03-01"]');
  await date.trigger("click");
  await flushPromises();
  const calendar = body.get('[role="dialog"][aria-label="选择运行日期"]');
  await calendar.get('button[aria-pressed="true"]').trigger("keydown", { key: "ArrowLeft" });
  expect(calendar.get('[tabindex="0"]').attributes("aria-label")).toBe("2028-02-29");
  await calendar.get('[tabindex="0"]').trigger("click");
  expect(date.text()).toBe("2028-02-29");
  expect(date.attributes("aria-expanded")).toBe("false");
  await vi.waitFor(() => expect(preview).toHaveBeenLastCalledWith({...initialDefinition.rule, local_date:"2028-02-29"}));
});

it("clears the displayed time and blocks saving when a newer rule is incomplete", async () => {
  const result = { next_at: 1800000000, skipped_slots: [], candidates_examined: 1, rule_version: 1 as const, tzdb_version: "2026b" };
  let finishPending!: (value: typeof result) => void;
  const preview = vi.fn()
    .mockResolvedValueOnce(result)
    .mockImplementationOnce(() => new Promise<typeof result>(resolve => { finishPending = resolve; }));
  const initialDefinition = {
    name: "每日巡检", content: "核对商品信息", target: { mode: "dedicated_chat" as const },
    rule: { frequency: "daily" as const, time_zone: "Asia/Shanghai", local_time: "09:00" },
  };
  const root = mount(defineComponent({ setup: () => () => h(NDialogProvider, null, { default: () => h(ScheduledPlanForm, {
    plan: null, initialDefinition, busy: false, uncertain: false, error: "", preview, targets: async () => ({ items: [] }),
  }) }) }), mountOptions);
  disposers.push(() => root.unmount());
  await flushPromises();
  const body = new DOMWrapper(document.body);
  const status = body.get(".schedule-form__preview");
  const save = body.get<HTMLButtonElement>('button[type="submit"]');
  await vi.waitFor(() => expect(status.attributes("data-state")).toBe("ready"));
  expect(status.text()).toContain("Asia/Shanghai");
  expect(save.element.disabled).toBe(false);

  await body.get("summary").trigger("click");
  await body.get('input[aria-label="时区"]').setValue("Asia/Tokyo");
  expect(status.text()).toContain("正在计算");
  expect(status.text()).not.toContain("Asia/Shanghai");
  expect(save.element.disabled).toBe(true);
  await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
  const frequency = root.findAllComponents(NSelect).find(select => select.attributes("aria-label") === "频率")!;
  frequency.vm.$emit("update:value", "once");
  await flushPromises();
  finishPending(result);
  await flushPromises();
  expect(status.text()).toContain("选择运行日期");
  expect(save.element.disabled).toBe(true);
});
