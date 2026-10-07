import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  dashboardFactor,
  dashboardProducts,
  dashboardStats,
  type DashboardProduct,
  type StoreDashboardState,
  type StoreDashboardTab,
  type StoreDashboardMetric,
  type StoreOpportunity,
} from "../domain/store-dashboard";

export function useStoreDashboard() {
  const tab = ref<StoreDashboardTab>("overview");
  const shop = ref("all");
  const period = ref(30);
  const metric = ref<StoreDashboardMetric>("sales");
  const state = ref<StoreDashboardState>("ready");
  const query = ref("");
  const sort = ref("sales");
  const page = ref(1);
  const factor = computed(() => dashboardFactor(shop.value, period.value));
  const stats = computed(() => dashboardStats(factor.value));
  const products = computed(() =>
    dashboardProducts(factor.value)
      .filter((item) =>
        `${item.name}${item.id}${item.category}`
          .toLowerCase()
          .includes(query.value.toLowerCase()),
      )
      .sort((a, b) =>
        sort.value === "growth"
          ? b.growth - a.growth
          : sort.value === "score"
            ? b.score - a.score
            : b.sales - a.sales,
      ),
  );
  const pageCount = computed(() =>
    Math.max(1, Math.ceil(products.value.length / 5)),
  );
  const visibleProducts = computed(() =>
    products.value.slice((page.value - 1) * 5, page.value * 5),
  );
  const selectedProduct = ref<DashboardProduct | null>(null);
  const opportunity = ref<StoreOpportunity | null>(null);
  const execution = ref<"idle" | "running" | "done">("idle");
  const executionStep = ref(0);
  const completedByShop = ref<Record<string, string[]>>({});
  const completedIds = computed(() => completedByShop.value[shop.value] ?? []);
  const toast = ref("");
  const refreshed = ref(false);
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let executionTimer: ReturnType<typeof setInterval> | undefined;
  watch([query, sort, shop, period], () => {
    page.value = 1;
  });
  watch([shop, period], () => {
    if (state.value !== "ready" && state.value !== "loading") setState("ready");
  });
  watch(shop, () => {
    if (execution.value === "running") return;
    opportunity.value = null;
    execution.value = "idle";
    executionStep.value = 0;
  });
  function notify(message: string) {
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.value = "";
    }, 3500);
  }
  function refresh() {
    clearTimeout(refreshTimer);
    state.value = "loading";
    refreshTimer = setTimeout(() => {
      state.value = "ready";
      refreshed.value = true;
      notify("演示数据已更新");
    }, 650);
  }
  function setState(value: StoreDashboardState) {
    clearTimeout(refreshTimer);
    state.value = value;
  }
  function openOpportunity(item: StoreOpportunity) {
    opportunity.value = item;
    execution.value = completedIds.value.includes(item.id) ? "done" : "idle";
    executionStep.value = execution.value === "done" ? 3 : 0;
  }
  function runOpportunity() {
    if (!opportunity.value || execution.value !== "idle") return;
    const id = opportunity.value.id;
    const shopId = shop.value;
    execution.value = "running";
    executionStep.value = 0;
    executionTimer = setInterval(() => {
      executionStep.value += 1;
      if (executionStep.value >= 3) {
        clearInterval(executionTimer);
        execution.value = "done";
        const completed = (completedByShop.value[shopId] ??= []);
        if (!completed.includes(id)) completed.push(id);
        notify("演示方案已生成，可查看结果");
      }
    }, 850);
  }
  function closeOpportunity() {
    if (execution.value === "running") return;
    opportunity.value = null;
  }
  onBeforeUnmount(() => {
    clearTimeout(refreshTimer);
    clearTimeout(toastTimer);
    clearInterval(executionTimer);
  });
  return {
    tab,
    shop,
    period,
    metric,
    state,
    query,
    sort,
    page,
    factor,
    stats,
    products,
    pageCount,
    visibleProducts,
    selectedProduct,
    opportunity,
    execution,
    executionStep,
    completedIds,
    toast,
    refreshed,
    refresh,
    setState,
    notify,
    openOpportunity,
    runOpportunity,
    closeOpportunity,
  };
}
