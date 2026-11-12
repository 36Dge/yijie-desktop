import type { ArtifactProjection } from "./chat-artifact";

export function artifactImageTitle(name: string | null): string {
  const title = (name ?? "").trim().replace(/\.(?:png|jpe?g|webp|gif|svg)$/i, "");
  return !title || /^generated[-_ ]?image(?:[-_ ]?\d+)?$/i.test(title) ? "生成的图片" : title;
}

export function artifactImageStatus(artifact: ArtifactProjection): string {
  switch (artifact.status) {
    case "announced":
    case "generating":
    case "processing": return "生成中…";
    case "transferring": return "加载中…";
    case "cancelled": return "图片生成已取消";
    case "expired": return "图片已过期，无法预览或下载。";
    case "failed":
      switch (artifact.errorCode) {
        case "limit_exceeded": return "图片生成额度受限，请检查用量上限后重新提交。";
        case "unsupported_provider": return "图片服务暂不可用，请核对模型配置与账户额度。";
        case "integrity_failed": return "图片未通过校验，请重新提交生成需求。";
        case "resource_unavailable": return "暂时无法取得图片；原请求可能已受理，重新生成将发起新请求。";
        default: return artifact.retryable ? "图片生成失败，可在输入框重新提交需求。" : "图片生成失败，请调整需求后重新提交。";
      }
    default: return "图片暂时无法显示。";
  }
}
