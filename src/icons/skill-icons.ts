import type { ManagedSkillProjection } from "../domain/skill-marketplace";
import { isYjIconName, type YjIconName } from "./registry";

// Card artwork is a renderer concern. Match stable IDs so existing bundles can
// keep their category icon keys, and display-name/localization changes are safe.
const skillIcons: Readonly<Record<string, YjIconName>> = Object.freeze({
  "yijie.sourcing-selection.aliexpress-supplier-evaluator": "skillSupplierEvaluation",
  "yijie.sourcing-selection.dropshipping-supplier-integrator": "skillDropshipping",
  "yijie.sourcing-selection.product-supplier-sourcing": "skillSupplierSearch",
  "yijie.sourcing-selection.sales-negotiator": "skillNegotiation",
  "yijie.sourcing-selection.supplier-performance-manager": "skillSupplierPerformance",

  "yijie.market-research.alibaba-amazon-market-intel": "skillMarketIntelligence",
  "yijie.market-research.competitor-deep-analysis": "skillCompetitorAnalysis",
  "yijie.market-research.cross-border-selection": "skillCrossBorderSelection",
  "yijie.market-research.jungle-scout-deep-dive-analyzer": "skillMarketDataAnalysis",
  "yijie.market-research.market-insight-product-selection": "skillDemandTrends",
  "yijie.market-research.product-attribute-analyzer": "skillProductAttributes",
  "yijie.market-research.product-selection": "skillProductRanking",
  "yijie.market-research.review-analyst-agent": "skillReviewAnalysis",
  "yijie.market-research.scenario-driven-product-scout": "skillScenarioDiscovery",

  "yijie.content-marketing.content-breakdown": "skillContentBreakdown",
  "yijie.content-marketing.content-strategy": "skillContentStrategy",
  "yijie.content-marketing.copywriting": "skillCopywriting",
  "yijie.content-marketing.product-marketing-context": "skillMarketingContext",
  "yijie.content-marketing.social-media-content-creator": "skillSocialContent",
  "yijie.content-marketing.vibe-marketing": "skillBrandMood",
  "yijie.content-marketing.xiaohongshu-content-creator": "skillLifestyleContent",

  "yijie.traffic-advertising.amazon-listing-expert": "skillListingReview",
  "yijie.traffic-advertising.amazon-ppc-campaign-manager": "skillPpcCampaign",
  "yijie.traffic-advertising.amz-hot-keywords": "skillTrendingKeywords",
  "yijie.traffic-advertising.amz-product-optimizer": "skillProductOptimization",
  "yijie.traffic-advertising.ecommerce-seo-optimizer": "skillEcommerceSeo",
  "yijie.traffic-advertising.etsy-seo-optimizer": "skillMarketplaceTags",
  "yijie.traffic-advertising.product-description-generator": "skillProductDescription",
  "yijie.traffic-advertising.seo-keyword-research": "skillKeywordResearch",
  "yijie.traffic-advertising.tiktok-ads-strategy": "skillVideoAdvertising",

  "yijie.store-operations.amazon-brand-protection": "skillBrandProtection",
  "yijie.store-operations.buy-now-pay-later-setup": "skillInstallmentPayments",
  "yijie.store-operations.ecommerce-gdpr-compliance": "skillPrivacyCompliance",
  "yijie.store-operations.invoice-generator": "skillInvoicing",
  "yijie.store-operations.multichannel-inventory-sync": "skillInventorySync",
  "yijie.store-operations.payment-fraud-detector": "skillPaymentRisk",
  "yijie.store-operations.tiktok-shop-setup": "skillShopSetup",
  "yijie.store-operations.warehouse-fulfillment-workflow": "skillWarehouseFulfillment",
});

export function skillCardIcon(
  skill: Pick<ManagedSkillProjection, "id" | "iconKey">,
): YjIconName {
  if (Object.prototype.hasOwnProperty.call(skillIcons, skill.id)) {
    return skillIcons[skill.id]!;
  }
  return isYjIconName(skill.iconKey) ? skill.iconKey : "plugin";
}
