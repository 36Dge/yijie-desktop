<script lang="ts">
import { cloneVNode, Comment, computed, defineComponent, h, inject, mergeProps, onBeforeUnmount, provide, ref, useId, watch, type InjectionKey, type PropType } from "vue";
import { NTooltip, type PopoverPlacement } from "naive-ui";

interface TooltipOwner { resume(): void }
const parentTooltipKey: InjectionKey<TooltipOwner> = Symbol("parent-tooltip");
const activeTooltip = ref<symbol | null>(null);

/** Adds a themed hint without a wrapper element or a second native title bubble. */
export default defineComponent({
  name: "YjTooltip",
  inheritAttrs: false,
  props: {
    text: String as PropType<string | null>,
    placement: { type: String as PropType<PopoverPlacement>, default: "top" },
    showArrow: { type: Boolean, default: true },
    to: { type: [String, Object, Boolean] as PropType<string | HTMLElement | false>, default: undefined },
  },
  emits: ["show"],
  setup(props, { slots, attrs, emit }) {
    const id = useId();
    const owner = Symbol("tooltip");
    const parent = inject(parentTooltipKey, null);
    const hovered = ref(false);
    const focused = ref(false);
    const dismissed = ref(false);
    const show = computed(() => Boolean(props.text) && !dismissed.value && activeTooltip.value === owner && (hovered.value || focused.value));
    watch(show, visible => { if (visible) emit("show"); });
    function resume() {
      if (!dismissed.value && props.text && (hovered.value || focused.value)) activeTooltip.value = owner;
      else parent?.resume();
    }
    function leave() {
      if (activeTooltip.value === owner) activeTooltip.value = null;
      resume();
    }
    function dismiss() {
      dismissed.value = true;
      if (activeTooltip.value === owner) activeTooltip.value = null;
    }
    provide(parentTooltipKey, { resume });
    watch(() => props.text, () => { if (!props.text) dismiss(); });
    onBeforeUnmount(() => { if (activeTooltip.value === owner) activeTooltip.value = null; });
    return () => h(NTooltip, {
      trigger: "manual", show: show.value, placement: props.placement, showArrow: props.showArrow, arrowPointToCenter: true, to: props.to,
      onMouseenter: () => { hovered.value = true; resume(); },
      onMouseleave: () => { hovered.value = false; leave(); },
    }, {
      trigger: () => {
        const child = slots.default?.().find(node => node.type !== Comment);
        if (!child) return null;
        const describedBy = [child.props?.["aria-describedby"], show.value ? id : null].filter(Boolean).join(" ");
        return cloneVNode(child, mergeProps(attrs, {
          "aria-describedby": describedBy || undefined,
          "data-yj-tooltip": props.text,
          onMouseenter: () => { hovered.value = true; dismissed.value = false; resume(); },
          onMouseleave: () => { hovered.value = false; leave(); },
          onFocusin: (event: FocusEvent) => {
            focused.value = event.target instanceof Element && event.target.matches(":focus-visible");
            if (focused.value) { dismissed.value = false; resume(); }
          },
          onFocusout: () => { focused.value = false; leave(); },
          onPointerdown: dismiss,
          onKeydown: (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); },
        }), true);
      },
      default: () => h("span", { id }, props.text ?? ""),
    });
  },
});
</script>
