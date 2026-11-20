<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { ChatComposerFocusSnapshot } from "../../domain/chat-composer";
import type { ChatSkillChip } from "../../domain/chat-skills";
import { skillOffset, skillTextParts, type SkillPosition } from "../../domain/chat-skill-placement";
import ChatSkillChips from "./ChatSkillChips.vue";
import { readSkillEditor } from "./skill-editor-dom";

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  text: string; skills: readonly ChatSkillChip[]; readonly: boolean; removalDisabled: boolean; hintId?: string;
}>();
const emit = defineEmits<{
  edit: [text: string, positions: readonly SkillPosition[]];
  remove: [id: string];
  query: [];
}>();
const root = ref<HTMLElement | null>(null);
const targets = shallowRef(new Map<string, HTMLElement>());
const chips = computed(() => props.skills.flatMap(skill => {
  const target = targets.value.get(skill.id);
  return target ? [{ skill, target }] : [];
}));
let lastRange: ChatComposerFocusSnapshot | null = null;
const composing = ref(false);
const hintPosition = ref<{ left: string; top: string } | null>(null);
function capture() {
  const current = root.value && readSkillEditor(root.value).range;
  if (current) lastRange = current;
  return lastRange;
}
function selectionChanged() {
  const el = root.value;
  if (el?.contains(el.ownerDocument.getSelection()?.anchorNode ?? null)) capture();
}
function positionHint() {
  const el = root.value, selection = el?.ownerDocument.getSelection();
  hintPosition.value = null;
  if (!props.hintId || !el || !selection?.rangeCount || !selection.isCollapsed || !el.contains(selection.anchorNode)) return;
  const caret = selection.getRangeAt(0).getBoundingClientRect(), box = el.getBoundingClientRect();
  if (!caret.height || caret.bottom < box.top || caret.top > box.bottom) return;
  const scale = box.width / el.offsetWidth || 1;
  hintPosition.value = { left: `${(caret.right - box.left) / scale}px`, top: `${(caret.top - box.top) / scale}px` };
}
function restore(snapshot: ChatComposerFocusSnapshot) {
  if (!root.value) return false;
  root.value.focus({ preventScroll: true });
  const doc = readSkillEditor(root.value);
  const a = doc.pointAt(snapshot.selectionStart), b = doc.pointAt(snapshot.selectionEnd);
  const [anchor, focus] = snapshot.selectionDirection === "backward" ? [b, a] : [a, b];
  root.value.ownerDocument.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  lastRange = snapshot;
  return true;
}
function sync() {
  const el = root.value;
  if (!el || composing.value) return;
  const current = readSkillEditor(el);
  const offsets = props.skills.map(skill => skillOffset(skill, props.text));
  if (current.text === props.text && current.positions.length === props.skills.length &&
    current.positions.every((p, i) => p.id === props.skills[i]!.id && p.offset === offsets[i])) {
    if (current.tokens.size !== targets.value.size || [...current.tokens].some(([id, target]) => targets.value.get(id) !== target)) targets.value = current.tokens;
    return;
  }
  const next = new Map<string, HTMLElement>();
  const nodes = skillTextParts(props.text, props.skills, offsets).map(part => {
    if ("text" in part) return document.createTextNode(part.text);
    const token = current.tokens.get(part.skill.id) ?? document.createElement("span");
    token.dataset.skillId = part.skill.id;
    token.contentEditable = "false";
    token.className = "inline-skill-token";
    next.set(part.skill.id, token);
    return token;
  });
  const focused = el.ownerDocument.activeElement === el;
  el.replaceChildren(...nodes);
  targets.value = next;
  if (focused && current.range) restore(current.range);
}
function input() {
  if (!root.value) return;
  const doc = readSkillEditor(root.value);
  if (props.readonly || (props.removalDisabled && doc.positions.length !== props.skills.length)) { sync(); return; }
  lastRange = doc.range ?? lastRange;
  emit("edit", doc.text, doc.positions);
  if (!composing.value) emit("query");
}
function beforeInput(event: InputEvent) {
  // A native soft break in pre-wrap can leave two newline text nodes at EOF.
  // Insert one plain newline through the browser's editing/undo transaction.
  if (!props.readonly && !event.isComposing && event.inputType === "insertLineBreak") {
    event.preventDefault();
    document.execCommand("insertText", false, "\n");
  }
}
function paste(event: ClipboardEvent) {
  if (event.defaultPrevented || !event.clipboardData || props.readonly) return;
  event.preventDefault();
  const text = event.clipboardData.getData("text/plain");
  if (text) document.execCommand("insertText", false, text);
}
watch([() => props.text, () => props.skills], sync, { flush: "post" });
watch([() => props.hintId, () => props.text], positionHint, { flush: "post" });
onMounted(() => { sync(); document.addEventListener("selectionchange", selectionChanged); });
onBeforeUnmount(() => document.removeEventListener("selectionchange", selectionChanged));
defineExpose({ capture, restore, positionHint, inputState: () => root.value && readSkillEditor(root.value) });
</script>

<template>
  <div ref="root" v-bind="$attrs" role="textbox" tabindex="0" aria-multiline="true" aria-label="输入你的任务需求"
    :contenteditable="!readonly" :aria-readonly="readonly || undefined" spellcheck="true"
    @beforeinput="beforeInput" @input="input" @blur="capture" @keyup="capture" @mouseup="capture"
    @compositionstart="composing = true" @compositionend="composing = false; input()"
    @paste="paste" @scroll="positionHint" @drop.prevent />
  <span v-if="hintId && hintPosition" :id="hintId" class="inline-skill-hint" :style="hintPosition">输入以筛选</span>
  <Teleport v-for="{skill, target} in chips" :key="skill.id" :to="target">
    <ChatSkillChips :entries="[skill]" :disabled="removalDisabled" @mousedown.prevent @keydown.stop @remove="emit('remove', $event)" />
  </Teleport>
</template>

<style scoped>
[role="textbox"] { white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; -webkit-user-select: text; user-select: text; }
[role="textbox"] :deep(.inline-skill-token) { display: inline-block; max-width: 100%; padding-inline: var(--yj-space-1); vertical-align: middle; }
.inline-skill-hint { position: absolute; margin-inline-start: var(--yj-space-1); color: var(--yj-color-text-tertiary); pointer-events: none; }
</style>
