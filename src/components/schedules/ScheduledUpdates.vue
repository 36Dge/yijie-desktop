<script setup lang="ts">
import { h } from "vue";
import { NButton, useNotification, type NotificationReactive } from "naive-ui";
import { useRouter } from "vue-router";
import { useScheduledUpdates } from "../../pages/schedules/use-scheduled-updates";
const notifications = useNotification(); const router = useRouter();
const active = new Map<string, NotificationReactive>();
const labels = { pending: "", needs_attention: "定时任务需要处理", completed: "定时任务执行已结束", failed: "定时任务执行失败", interrupted: "定时任务已停止" };
useScheduledUpdates((item, announce) => {
  active.get(item.run_id)?.destroy(); active.delete(item.run_id);
  if (!announce) return;
  // Keep unresolved work discoverable; completed notices are brief and history remains.
  const message = notifications.create({
    title: labels[item.state], content: item.name,
    description: item.state === "needs_attention" ? "审批或执行状态需要核对，请查看记录并进入原对话处理。" : "查看本次记录与完整对话；执行结束不代表业务结果已通过评估。",
    type: item.state === "failed" ? "error" : item.state === "needs_attention" ? "warning" : "info",
    duration: item.state === "needs_attention" ? 0 : 15000,
    action: () => h(NButton, { size: "small", onClick: async () => {
      const failure = await router.push({ path: "/scheduled-tasks", query: { run: item.run_id } });
      if (!failure) { message.destroy(); active.delete(item.run_id); }
    } }, { default: () => "查看记录" }),
    onAfterLeave: () => { if (active.get(item.run_id) === message) active.delete(item.run_id); },
  });
  active.set(item.run_id, message);
  // Avoid covering the window if many completions arrived while the UI was busy.
  if (active.size > 3) { const first = active.keys().next().value!; active.get(first)?.destroy(); active.delete(first); }
}, () => { for (const notice of active.values()) notice.destroy(); active.clear(); });
</script>
<template><span class="scheduled-updates-observer" aria-hidden="true" /></template>
<style scoped>.scheduled-updates-observer { display: none; }</style>
