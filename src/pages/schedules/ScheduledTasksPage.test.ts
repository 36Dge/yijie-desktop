// @vitest-environment happy-dom
import { mount, flushPromises, DOMWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { NDialogProvider, NMessageProvider } from "naive-ui";
import { afterEach, expect, it, vi } from "vitest";
import ScheduledTasksPage from "./ScheduledTasksPage.vue";
import { useChatStore } from "../../stores/chat.store";
import { usePermissionStore } from "../../stores/permission.store";
import type { PlanSummary, Requests, RecordDetail } from "../../api/generated/scheduled-task-ipc.gen";
import { CHAT_EXECUTION_PREPARE_KEY } from "../../authorization/chat-authority-recovery";
import type { GrantView, RunView } from "../../domain/scheduled-execution.generated";
import type { PlanView } from "../../domain/scheduled-plan.generated";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(f => f()); document.body.innerHTML = ""; vi.restoreAllMocks(); });

async function page(failToggle = false, manualReady = false, failRun = false) {
  const plan: PlanView = { plan_id: crypto.randomUUID(), revision: 1, schedule_epoch: 1, definition: { name: "午夜闹铃", content: "整理每日摘要", rule: { frequency: "daily", time_zone: "Asia/Shanghai", local_time: "23:00" }, target: { mode: "dedicated_chat" } }, state: "paused", target_state: "unbound", effective_from: 1790000000, rule_version: 1, tzdb_version: "2026b" };
  const summary: PlanSummary = { plan_id: plan.plan_id, name: plan.definition.name, revision: 1, raw_state: "paused", effective_state: "paused", target_mode: "dedicated_chat", target_state: "unbound" };
  const grant: GrantView = { grant_id: crypto.randomUUID(), plan_id: plan.plan_id, plan_revision: 1, authorization_revision: 1, definition_digest: "a".repeat(64), workspace: { source: "managed_schedule", resource_id: plan.plan_id }, max_runs: 1, occupied_runs: 0, expires_at: Math.floor(Date.now() / 1000) + 600, state: "active" };
  const run: RunView = { run_id: crypto.randomUUID(), request_id: crypto.randomUUID(), plan_id: plan.plan_id, plan_revision: 1, schedule_epoch: 1, grant_id: grant.grant_id, operation_id: crypto.randomUUID(), trigger: "manual", workspace: grant.workspace, permission_mode: "ask", snapshot_digest: "b".repeat(64), delivery_state: "reserved", native_outcome: "unobserved", needs_attention: false };
  const detail: RecordDetail = { record: { kind: "run", key: { kind: "run", run_id: run.run_id }, plan: summary, run, conversation: { status: "unavailable" }, timing: { execution_time: "unknown", duration: "unknown", source: "no_execution_clock" }, attention: "none", business_result: "not_evaluated" }, configuration: { name: plan.definition.name, content: plan.definition.content, rule: plan.definition.rule, target_mode: plan.definition.target.mode } };
  let finishRun: (() => void) | undefined;
  const calls: { command: string; request: Requests[keyof Requests] }[] = [];
  let finishDelete: (() => void) | undefined;
  native.invoke.mockImplementation(async (command: string, args: { request: Requests[keyof Requests] }) => {
    const { request } = args; calls.push({ command, request });
    let data: unknown;
    switch (command) {
      case "schedule_operation_capabilities_v1": data = Object.fromEntries(["read", "save", "manual", "automatic", "draft", "single_run"].map(k => [k, { available: k === "read" || k === "save" || (k === "single_run" && manualReady), reason: k === "read" || k === "save" || (k === "single_run" && manualReady) ? "ready" : "candidate_disabled" }])); break;
      case "schedule_list_plan_cards_v1": data = { items: plan.state === "deleted" ? [] : [{ summary, content_preview: plan.definition.content, rule: plan.definition.rule, created_at: plan.effective_from }] }; break;
      case "schedule_list_record_rows_v1": data = { items: [{ record: detail.record, name: plan.definition.name, content_preview: plan.definition.content, source: detail.record.kind === "run" ? "run_snapshot" : "current_plan_reference" }] }; break;
      case "schedule_list_plans_v1": data = { items: [summary] }; break;
      case "schedule_preview_rerun_v1": data = { confirmation: { original_run_id: run.run_id, original_snapshot_digest: run.snapshot_digest, plan_id: plan.plan_id, revision: plan.revision, definition_digest: "c".repeat(64) }, original: plan.definition, current: plan.definition }; break;
      case "schedule_confirm_single_run_v1": data = { grant, kind: "manual" }; break;
      case "schedule_manual_run_v1":
        await new Promise<void>(resolve => { finishRun = resolve; });
        if (failRun) throw { schemaVersion: 1, requestId: request.requestId, code: "reservation_busy" };
        data = run; break;
      case "schedule_get_record_v1": data = detail; break;
      case "schedule_get_plan_v1": data = { plan, summary }; break;
      case "schedule_enable_plan_v1":
      case "schedule_pause_plan_v1":
        if (failToggle) throw { schemaVersion: 1, requestId: request.requestId, code: "revision_conflict" };
        plan.state = command === "schedule_enable_plan_v1" ? "enabled" : "paused"; plan.revision++;
        summary.raw_state = plan.state; summary.effective_state = plan.state; summary.revision = plan.revision;
        data = plan; break;
      case "schedule_delete_plan_v1":
        await new Promise<void>(resolve => { finishDelete = resolve; });
        plan.state = "deleted"; plan.revision++; data = plan; break;
      default: throw new Error(`Unexpected native call: ${command}`);
    }
    return { schemaVersion: 1, requestId: request.requestId, data };
  });
  const pinia = createPinia(); setActivePinia(pinia);
  const permission = usePermissionStore(); permission.phase = "ready"; permission.selectedTenantId = crypto.randomUUID(); permission.authorizationRevision = 1;
  vi.spyOn(permission, "hasCapability").mockReturnValue(true);
  const chat = useChatStore(); chat.phase = "ready"; chat.context = { contextId: crypto.randomUUID(), expiresAtEpochSeconds: 2_000_000_000, allowedActions: ["read_sessions"] };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/scheduled-tasks", component: ScheduledTasksPage }] });
  await router.push("/scheduled-tasks"); await router.isReady();
  const root = mount(defineComponent({ setup: () => () => h(NDialogProvider, null, { default: () => h(NMessageProvider, null, { default: () => h(RouterView) }) }) }), { attachTo: document.body, global: { plugins: [pinia, router], provide: { [CHAT_EXECUTION_PREPARE_KEY as symbol]: async () => true } } });
  disposers.push(() => root.unmount()); await flushPromises();
  return { root, calls, detail, run, finishRun: () => finishRun?.(), finishDelete: () => finishDelete?.() };
}

function dialogButton(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(b => b.textContent === label)!;
}

it("shows the task name and retained-history explanation, and cancels without deleting", async () => {
  const { root, calls } = await page();
  await root.get('[aria-label="删除任务"]').trigger("click"); await flushPromises();
  const modal = document.querySelector('[role="alertdialog"]')!;
  expect(modal.textContent).toContain("删除定时任务？");
  expect(modal.textContent).toContain("确定要删除「午夜闹铃」吗？此操作无法撤销。删除后不再自动执行，已有执行对话和运行日志会保留。");
  dialogButton("取消").click(); await flushPromises();
  expect(new DOMWrapper(document.querySelector('[role="alertdialog"]')!).isVisible()).toBe(false);
  expect(root.findAll(".schedule-plan-card")).toHaveLength(1);
  expect(calls.some(c => c.command === "schedule_delete_plan_v1")).toBe(false);
});

it("submits deletion once, blocks repeated clicks while saving, and leaves only the updated list", async () => {
  const { root, calls, finishDelete } = await page();
  await root.get('[aria-label="删除任务"]').trigger("click"); await flushPromises();
  dialogButton("删除").click(); await flushPromises();
  expect(dialogButton("取消").disabled).toBe(true);
  expect(dialogButton("删除").disabled).toBe(true);
  dialogButton("删除").click();
  expect(calls.filter(c => c.command === "schedule_delete_plan_v1")).toHaveLength(1);
  finishDelete(); await flushPromises();
  expect(new DOMWrapper(document.querySelector('[role="alertdialog"]')!).isVisible()).toBe(false);
  expect(root.findAll(".schedule-plan-card")).toHaveLength(0);
  expect(root.text()).toContain("还没有定时任务");
  expect(root.text()).not.toContain("计划已删除，历史记录已保留");
  expect(root.find('[aria-label="已查证的计划"]').exists()).toBe(false);
  expect(root.text()).not.toContain("当前版本");
  expect(root.text()).not.toContain("午夜闹铃");
});


it("switches on and off directly and announces both successful changes", async () => {
  const { root, calls } = await page();
  await root.get('[role="switch"]').trigger("click"); await flushPromises();
  expect(root.get('[role="switch"]').attributes("aria-checked")).toBe("true");
  expect(document.body.textContent).toContain("定时任务已开启");
  expect(root.text()).not.toContain("确认自动运行");
  await root.get('[role="switch"]').trigger("click"); await flushPromises();
  expect(root.get('[role="switch"]').attributes("aria-checked")).toBe("false");
  expect(document.body.textContent).toContain("定时任务已关闭");
  expect(calls.filter(c => c.command === "schedule_enable_plan_v1")).toHaveLength(1);
  expect(calls.filter(c => c.command === "schedule_pause_plan_v1")).toHaveLength(1);
  expect(calls.some(c => c.command === "schedule_confirm_enable_v1")).toBe(false);
});

it("keeps the switch off and reports the error if enabling fails", async () => {
  const { root } = await page(true);
  await root.get('[role="switch"]').trigger("click"); await flushPromises();
  expect(root.get('[role="switch"]').attributes("aria-checked")).toBe("false");
  expect(document.body.textContent).not.toContain("定时任务已开启");
  expect(root.find('[role="alert"]').exists()).toBe(true);
});


it("starts immediately without a dialog and shows a closable toast after native acceptance", async () => {
  const { root, calls, finishRun } = await page(false, true);
  await root.get('[aria-label="立即执行"]').trigger("click"); await flushPromises();
  expect(document.querySelector('[aria-label="确认运行一次"]')).toBeNull();
  expect(document.body.textContent).not.toContain("任务已开始执行");
  expect(root.get('[aria-label="立即执行"]').attributes("disabled")).toBeDefined();
  await root.get('[aria-label="立即执行"]').trigger("click"); await flushPromises();
  expect(calls.filter(c => c.command === "schedule_manual_run_v1")).toHaveLength(1);
  finishRun(); await flushPromises();
  expect(document.body.textContent).toContain("任务已开始执行");
  expect(document.querySelector('.n-message .n-base-close')).not.toBeNull();
  expect(root.find('[aria-label="本次运行记录"]').exists()).toBe(false);
  expect(root.text()).not.toContain("授权已保存");
});

it("reports a rejected immediate run without a success toast or confirmation dialog", async () => {
  const { root, finishRun } = await page(false, true, true);
  await root.get('[aria-label="立即执行"]').trigger("click"); await flushPromises();
  finishRun(); await flushPromises();
  expect(document.body.textContent).not.toContain("任务已开始执行");
  expect(root.find('[role="alert"]').exists()).toBe(true);
  expect(document.querySelector('[aria-label="确认运行一次"]')).toBeNull();
});


it("opens a compact record dialog from the card or its title without a view-record action", async () => {
  const { root, detail, run } = await page(false, true);
  run.delivery_state = "terminal"; run.native_outcome = "completed";
  detail.record.timing = { execution_time: "known", duration: "known", source: "runtime_read", started_at: 1790151297, duration_ms: 2505, time_zone: "Asia/Shanghai" };
  await root.get('#scheduled-panel-tab-records').trigger("click");
  await vi.waitFor(() => expect(root.find('.schedule-record-card').exists()).toBe(true));
  expect(root.findAll('button').some(button => button.text() === "查看记录")).toBe(false);
  await root.get('.schedule-record-card').trigger("click"); await flushPromises();
  const modal = new DOMWrapper(document.querySelector('[aria-label="执行记录详情"]')!);
  expect(modal.findAll('dt').map(label => label.text())).toEqual(["任务名称", "执行状态", "触发方式", "执行时间", "执行耗时"]);
  expect(modal.text()).toContain("午夜闹铃"); expect(modal.text()).toContain("手动触发");
  expect(modal.text()).toContain("2026-09-23 16:14:57"); expect(modal.text()).toContain("2.505 秒");
  expect(modal.text()).not.toContain("整理每日摘要"); expect(modal.text()).not.toContain("业务结果尚未评估");
  expect(modal.find('[title*="Asia/Shanghai"]').exists()).toBe(true);
  expect(modal.findAll('button').find(button => button.text() === "查看完整对话")?.attributes("disabled")).toBeDefined();
  await modal.get('.n-card-header__close').trigger("click"); await flushPromises();
  await root.get('.schedule-record-card .schedule-card__title').trigger("click"); await flushPromises();
  expect(new DOMWrapper(document.querySelector('[aria-label="执行记录详情"]')!).isVisible()).toBe(true);
});

it("keeps row actions separate from opening record details", async () => {
  const { root, calls } = await page(false, true);
  await root.get('#scheduled-panel-tab-records').trigger("click");
  await vi.waitFor(() => expect(root.find('.schedule-record-card').exists()).toBe(true));
  await root.findAll('.schedule-record-card button').find(button => button.text() === "重新执行")!.trigger("click"); await flushPromises();
  expect(document.querySelector('[aria-label="执行记录详情"]')).toBeNull();
  expect(document.querySelector('[aria-label="确认重新执行一次"]')).not.toBeNull();
  expect(calls.some(call => call.command === "schedule_get_record_v1")).toBe(false);
});


it("shows a skipped occurrence without inventing execution timing or offering unavailable actions", async () => {
  const { root, detail } = await page(false, true);
  const key = { kind: "occurrence" as const, plan_id: detail.record.plan.plan_id, schedule_epoch: 1, logical_slot: "2026-09-25T09:00" };
  detail.record = { kind: "occurrence", key, plan: detail.record.plan, occurrence: { key, scheduled_at: 1790298000, disposition: "skipped_paused" }, timing: { execution_time: "not_started", duration: "not_started", source: "no_execution_clock" } };
  delete detail.configuration;
  await root.get('#scheduled-panel-tab-records').trigger("click");
  await vi.waitFor(() => expect(root.find('.schedule-record-card').exists()).toBe(true));
  await root.get('.schedule-record-card .schedule-card__title').trigger("click"); await flushPromises();
  const modal = new DOMWrapper(document.querySelector('[aria-label="执行记录详情"]')!);
  expect(modal.text()).toContain("暂停跳过"); expect(modal.text()).toContain("定时计划");
  expect(modal.findAll('dd').map(value => value.text()).filter(value => value === "未开始")).toHaveLength(2);
  for (const label of ["重新执行", "查看完整对话"]) expect(modal.findAll('button').find(button => button.text() === label)?.attributes("disabled")).toBeDefined();
});
