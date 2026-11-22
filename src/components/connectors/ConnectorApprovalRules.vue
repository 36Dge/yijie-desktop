<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { NButton } from "naive-ui";
import type { RememberedToolRule, RememberedToolRules } from "../../domain/market-host-v2-native.generated";

const props = defineProps<{
  serviceId: string;
  canManage: boolean;
  read: (id: string, revoke?: string, after?: string) => Promise<RememberedToolRules>;
}>();
const opened = ref(false);
const loading = ref(false);
const error = ref("");
const entries = ref<RememberedToolRule[]>([]);
const next = ref<string>();
let active = true;
onBeforeUnmount(() => { active = false; });

async function load(revoke?: string, after?: string) {
  if (loading.value || (revoke && (!props.canManage || error.value))) return;
  opened.value = true;
  loading.value = true;
  error.value = "";
  try {
    const result = await props.read(props.serviceId, revoke, after);
    if (!active) return;
    entries.value = after ? [...new Map([...entries.value, ...result.rules].map(rule => [rule.key, rule])).values()] : result.rules;
    next.value = result.next;
  } catch {
    if (active) error.value = revoke ? "撤销结果待确认，请刷新查看实际授权。" : "暂时无法读取长期授权。";
  } finally {
    if (active) loading.value = false;
  }
}
</script>

<template>
  <section class="connector-rules" aria-label="长期工具授权" :aria-busy="loading">
    <NButton v-if="!opened" text @click="load()">查看长期工具授权</NButton>
    <template v-else>
      <strong>长期工具授权</strong>
      <p v-if="error" role="status">{{ error }} <NButton text @click="load()">刷新</NButton></p>
      <p v-else-if="loading" role="status">正在核对授权…</p>
      <p v-else-if="!entries.length">此安装没有已保存的长期工具授权。</p>
      <ul v-if="entries.length">
        <li v-for="rule in entries" :key="rule.key">
          <span>{{ rule.tool }}</span>
          <NButton v-if="canManage" text :disabled="loading || !!error" :aria-label="`撤销 ${rule.tool} 的长期授权`" @click="load(rule.key)">撤销</NButton>
        </li>
      </ul>
      <NButton v-if="next && !error" text :disabled="loading" @click="load(undefined, next)">查看更多</NButton>
    </template>
  </section>
</template>

<style scoped>
.connector-rules { display: grid; justify-items: start; gap: var(--yj-space-2); }
.connector-rules p, .connector-rules ul { margin: 0; padding: 0; }
.connector-rules ul { list-style: none; width: 100%; }
.connector-rules li { display: flex; align-items: center; justify-content: space-between; gap: var(--yj-space-2); }
.connector-rules li span { min-width: 0; overflow-wrap: anywhere; }
</style>
