import { computed, inject, onBeforeUnmount, provide, ref, shallowRef, watch, type InjectionKey, type Ref } from "vue";

interface WorkspaceFullscreenHost {
  target: Readonly<Ref<HTMLElement | null>>;
  activate(owner: symbol): void;
  release(owner: symbol): void;
}

const workspaceFullscreenKey: InjectionKey<WorkspaceFullscreenHost> = Symbol("workspace-fullscreen");

export function provideWorkspaceFullscreen(target: Readonly<Ref<HTMLElement | null>>) {
  const owner = shallowRef<symbol | null>(null);
  provide(workspaceFullscreenKey, {
    target,
    activate: value => { owner.value = value; },
    release: value => { if (owner.value === value) owner.value = null; },
  });
  return { active: computed(() => owner.value !== null) };
}

export function useWorkspaceFullscreen() {
  const host = inject(workspaceFullscreenKey, null);
  const owner = Symbol("workspace-fullscreen-owner");
  const fullscreen = ref(false);
  watch(fullscreen, value => { if (value) host?.activate(owner); else host?.release(owner); }, { flush: "sync" });
  onBeforeUnmount(() => host?.release(owner));
  return { fullscreen, fullscreenTarget: computed(() => host?.target.value ?? null) };
}
