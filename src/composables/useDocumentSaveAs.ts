import { useMessage } from "naive-ui";

export type DocumentSaveAction = () => Promise<"saved" | void>;

export function useDocumentSaveAs() {
  const message = useMessage();
  return async (save: DocumentSaveAction) => {
    if (await save() === "saved") message.success("文件已保存");
  };
}
