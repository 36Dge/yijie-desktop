import douyinAcquisition from "../assets/workflows/generated/douyin-acquisition.png";
import productBatchImage from "../assets/workflows/generated/product-batch-image.png";
import networkPriceMonitor from "../assets/workflows/generated/network-price-monitor.png";
import xiaohongshuContent from "../assets/workflows/generated/xiaohongshu-content.png";
import listingLocalization from "../assets/workflows/generated/listing-localization.png";
import adSearchTermOptimization from "../assets/workflows/generated/ad-search-term-optimization.png";
import fbaReplenishmentPlanning from "../assets/workflows/generated/fba-replenishment-planning.png";
import overseasReviewInsights from "../assets/workflows/generated/overseas-review-insights.png";
import customWorkflow from "../assets/workflows/generated/custom-workflow.png";

const WORKFLOW_ARTWORK: Readonly<Record<string, string>> = {
  "douyin-acquisition": douyinAcquisition,
  "product-batch-image": productBatchImage,
  "network-price-monitor": networkPriceMonitor,
  "xiaohongshu-content": xiaohongshuContent,
  "listing-localization": listingLocalization,
  "ad-search-term-optimization": adSearchTermOptimization,
  "fba-replenishment-planning": fbaReplenishmentPlanning,
  "overseas-review-insights": overseasReviewInsights,
};

/** Built-in workflows have dedicated artwork; local text flows share an automation mark. */
export function workflowCardArtwork(id: string): string {
  return Object.prototype.hasOwnProperty.call(WORKFLOW_ARTWORK, id) ? WORKFLOW_ARTWORK[id]! : customWorkflow;
}
