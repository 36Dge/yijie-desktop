/** Presentation only. The native adapter projects the generated contract into these views. */
export type ConnectorAction = "install" | "enable" | "disable" | "configure" | "authorize" | "cancel" | "uninstall" | "retry" | "reopen";
export type ConnectorTone = "neutral" | "success" | "warning" | "error";

export interface ConnectorStatusView {
  readonly label: string;
  readonly tone: ConnectorTone;
}

export interface ConnectorView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly iconAssetId: string;
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly selectable: boolean;
  readonly status: ConnectorStatusView;
  readonly explanation: string | null;
  readonly configurationLabel: string;
  readonly busy: boolean;
  readonly actions: readonly ConnectorAction[];
}

export interface ConnectorChipView {
  readonly id: string;
  readonly name: string;
  readonly iconAssetId: string;
  readonly unavailableReason?: string | null;
}

export interface ConnectorPageView {
  readonly phase: "loading" | "ready" | "unavailable" | "permission-denied" | "incompatible";
  readonly entries: readonly ConnectorView[];
  readonly refreshing: boolean;
  readonly canManage: boolean;
  readonly error: string | null;
}

export function connectorCan(view: ConnectorView, action: ConnectorAction): boolean {
  return !view.busy && view.actions.includes(action);
}

export function connectorSwitchDisabled(view: ConnectorView, canManage: boolean): boolean {
  return !canManage || view.busy || (view.enabled
    ? !view.actions.includes("disable")
    : !view.actions.some(action => action === "enable" || action === "configure"));
}

export function filterConnectors(entries: readonly ConnectorView[], query: string): readonly ConnectorView[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle.length === 0 ? entries : entries.filter(entry =>
    `${entry.name} ${entry.description} ${entry.categoryLabel}`.toLocaleLowerCase().includes(needle),
  );
}

export function connectorPrimaryAction(view: ConnectorView): Readonly<{ action: ConnectorAction; label: string }> | null {
  // An installation can have an unknown outcome before it exists in a snapshot.
  // Its original operation must remain reachable from the details dialog.
  if (view.actions.includes("retry")) return { action: "retry", label: "重新确认状态" };
  if (!view.installed) return view.actions.includes("install") ? { action: "install", label: `安装 ${view.name}` } : null;
  if (view.enabled) return null;
  if (view.actions.includes("configure")) return { action: "configure", label: "配置连接器" };
  if (view.actions.includes("authorize")) return { action: "authorize", label: "授权连接" };
  if (view.actions.includes("enable")) return { action: "enable", label: `启用 ${view.name}` };
  return null;
}
