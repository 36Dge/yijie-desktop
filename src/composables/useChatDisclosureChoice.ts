import { computed, inject, provide, shallowRef, watch, type InjectionKey, type ShallowRef } from "vue";

const disclosureChoices: InjectionKey<ShallowRef<ReadonlyMap<string, unknown>>> = Symbol("chat-disclosure-choices");

/** Keep reading choices in the page while an authority refresh remounts its timeline.
 * No content, execution state or persistent preferences are retained here.
 */
export function provideChatDisclosureChoices(scope: () => string | null): void {
  const choices = shallowRef<ReadonlyMap<string, unknown>>(new Map());
  watch(scope, () => { choices.value = new Map(); }, { flush: "sync" });
  provide(disclosureChoices, choices);
}

export function useChatDisclosureChoice<T>(identity: () => string, initial: () => T) {
  const choices = inject(disclosureChoices, null) ?? shallowRef<ReadonlyMap<string, unknown>>(new Map());
  return computed<T>({
    get: () => choices.value.has(identity()) ? choices.value.get(identity()) as T : initial(),
    set: value => { choices.value = new Map(choices.value).set(identity(), value); },
  });
}
