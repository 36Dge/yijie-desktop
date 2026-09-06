/** Preview-only module alias. No native bridge or application process is used. */
export const nativePreviewDiagnostics = {
  attemptedCommands: [] as string[],
  passiveSubscriptions: [] as string[],
};

export type UnlistenFn = () => void;

export async function invoke<T>(command: string): Promise<T> {
  nativePreviewDiagnostics.attemptedCommands.push(command);
  throw new Error(`Native commands are unavailable in the isolated color preview: ${command}`);
}

export async function listen<T>(event: string, handler?: (event: { payload: T }) => void): Promise<UnlistenFn> {
  void handler;
  nativePreviewDiagnostics.passiveSubscriptions.push(event);
  return () => undefined;
}

export const once = listen;

export async function emit(event: string): Promise<void> {
  nativePreviewDiagnostics.attemptedCommands.push(`event:${event}`);
  throw new Error("Native events are unavailable in the isolated color preview.");
}

export function isTauri(): boolean {
  return false;
}

const previewWindow = {
  label: "component-color-preview",
  onDragDropEvent: async (): Promise<UnlistenFn> => {
    nativePreviewDiagnostics.passiveSubscriptions.push("preview:drag-drop");
    return () => undefined;
  },
};

export function getCurrentWindow() {
  return previewWindow;
}

export async function getAllWindows() {
  return [previewWindow];
}
