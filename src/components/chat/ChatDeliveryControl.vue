<script setup lang="ts">
import type { DeliveryState } from "../../api/chat-delivery-client";
defineProps<{ states: readonly DeliveryState[]; loading: boolean; cancelling: string | null; canCancel: boolean; error: string; notice: string }>();
defineEmits<{ refresh: []; cancel: [operationId: string] }>();
</script>

<template>
  <div v-if="states.length || loading || error || notice" class="chat-delivery" aria-label="提交状态" :aria-busy="loading || cancelling !== null">
    <p v-if="loading" role="status">正在核对提交状态…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-for="item in states" :key="item.operationId" role="status">
      <template v-if="item.cancellable">此提交尚未发送。<button type="button" class="yj-control" :disabled="!canCancel || loading || cancelling !== null" @click="$emit('cancel', item.operationId)">{{ cancelling === item.operationId ? '正在取消…' : '取消未发送的提交' }}</button><span v-if="!canCancel">当前没有取消权限。</span></template>
      <template v-else>提交结果待核实，暂不可取消。请查看原提交，避免重复发送。</template>
    </p>
    <button v-if="states.length || error" type="button" class="yj-control" :disabled="loading || cancelling !== null" @click="$emit('refresh')">刷新状态</button>
  </div>
</template>

<style scoped>
.chat-delivery { display: flex; flex-direction: column; align-items: flex-start; gap: var(--yj-space-2); color: var(--yj-color-text-body); font-size: var(--yj-font-size-body); }
.chat-delivery p { margin: 0; overflow-wrap: anywhere; }
.chat-delivery button { margin-inline: var(--yj-space-2); }
</style>
