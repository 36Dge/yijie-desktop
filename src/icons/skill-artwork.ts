import type { ManagedSkillProjection, SkillCategory } from "../domain/skill-marketplace";
import artwork0 from "../assets/skills/generated/aliexpress-supplier-evaluator.png";
import artwork1 from "../assets/skills/generated/dropshipping-supplier-integrator.png";
import artwork2 from "../assets/skills/generated/product-supplier-sourcing.png";
import artwork3 from "../assets/skills/generated/sales-negotiator.png";
import artwork4 from "../assets/skills/generated/supplier-performance-manager.png";
import artwork5 from "../assets/skills/generated/alibaba-amazon-market-intel.png";
import artwork6 from "../assets/skills/generated/competitor-deep-analysis.png";
import artwork7 from "../assets/skills/generated/cross-border-selection.png";
import artwork8 from "../assets/skills/generated/jungle-scout-deep-dive-analyzer.png";
import artwork9 from "../assets/skills/generated/market-insight-product-selection.png";
import artwork10 from "../assets/skills/generated/product-attribute-analyzer.png";
import artwork11 from "../assets/skills/generated/product-selection.png";
import artwork12 from "../assets/skills/generated/review-analyst-agent.png";
import artwork13 from "../assets/skills/generated/scenario-driven-product-scout.png";
import artwork14 from "../assets/skills/generated/content-breakdown.png";
import artwork15 from "../assets/skills/generated/content-strategy.png";
import artwork16 from "../assets/skills/generated/copywriting.png";
import artwork17 from "../assets/skills/generated/product-marketing-context.png";
import artwork18 from "../assets/skills/generated/social-media-content-creator.png";
import artwork19 from "../assets/skills/generated/vibe-marketing.png";
import artwork20 from "../assets/skills/generated/xiaohongshu-content-creator.png";
import artwork21 from "../assets/skills/generated/amazon-listing-expert.png";
import artwork22 from "../assets/skills/generated/amazon-ppc-campaign-manager.png";
import artwork23 from "../assets/skills/generated/amz-hot-keywords.png";
import artwork24 from "../assets/skills/generated/amz-product-optimizer.png";
import artwork25 from "../assets/skills/generated/ecommerce-seo-optimizer.png";
import artwork26 from "../assets/skills/generated/etsy-seo-optimizer.png";
import artwork27 from "../assets/skills/generated/product-description-generator.png";
import artwork28 from "../assets/skills/generated/seo-keyword-research.png";
import artwork29 from "../assets/skills/generated/tiktok-ads-strategy.png";
import artwork30 from "../assets/skills/generated/amazon-brand-protection.png";
import artwork31 from "../assets/skills/generated/buy-now-pay-later-setup.png";
import artwork32 from "../assets/skills/generated/ecommerce-gdpr-compliance.png";
import artwork33 from "../assets/skills/generated/invoice-generator.png";
import artwork34 from "../assets/skills/generated/multichannel-inventory-sync.png";
import artwork35 from "../assets/skills/generated/payment-fraud-detector.png";
import artwork36 from "../assets/skills/generated/tiktok-shop-setup.png";
import artwork37 from "../assets/skills/generated/warehouse-fulfillment-workflow.png";
import artwork38 from "../assets/skills/generated/category-sourcing-selection.png";
import artwork39 from "../assets/skills/generated/category-market-research.png";
import artwork40 from "../assets/skills/generated/category-content-marketing.png";
import artwork41 from "../assets/skills/generated/category-traffic-advertising.png";
import artwork42 from "../assets/skills/generated/category-store-operations.png";

// Generated artwork belongs to the renderer; stable catalog IDs keep wire data
// and installed skill bundles independent of this presentation-only mapping.
const skillArtwork: Readonly<Record<string, string>> = Object.freeze({
  "yijie.sourcing-selection.aliexpress-supplier-evaluator": artwork0,
  "yijie.sourcing-selection.dropshipping-supplier-integrator": artwork1,
  "yijie.sourcing-selection.product-supplier-sourcing": artwork2,
  "yijie.sourcing-selection.sales-negotiator": artwork3,
  "yijie.sourcing-selection.supplier-performance-manager": artwork4,
  "yijie.market-research.alibaba-amazon-market-intel": artwork5,
  "yijie.market-research.competitor-deep-analysis": artwork6,
  "yijie.market-research.cross-border-selection": artwork7,
  "yijie.market-research.jungle-scout-deep-dive-analyzer": artwork8,
  "yijie.market-research.market-insight-product-selection": artwork9,
  "yijie.market-research.product-attribute-analyzer": artwork10,
  "yijie.market-research.product-selection": artwork11,
  "yijie.market-research.review-analyst-agent": artwork12,
  "yijie.market-research.scenario-driven-product-scout": artwork13,
  "yijie.content-marketing.content-breakdown": artwork14,
  "yijie.content-marketing.content-strategy": artwork15,
  "yijie.content-marketing.copywriting": artwork16,
  "yijie.content-marketing.product-marketing-context": artwork17,
  "yijie.content-marketing.social-media-content-creator": artwork18,
  "yijie.content-marketing.vibe-marketing": artwork19,
  "yijie.content-marketing.xiaohongshu-content-creator": artwork20,
  "yijie.traffic-advertising.amazon-listing-expert": artwork21,
  "yijie.traffic-advertising.amazon-ppc-campaign-manager": artwork22,
  "yijie.traffic-advertising.amz-hot-keywords": artwork23,
  "yijie.traffic-advertising.amz-product-optimizer": artwork24,
  "yijie.traffic-advertising.ecommerce-seo-optimizer": artwork25,
  "yijie.traffic-advertising.etsy-seo-optimizer": artwork26,
  "yijie.traffic-advertising.product-description-generator": artwork27,
  "yijie.traffic-advertising.seo-keyword-research": artwork28,
  "yijie.traffic-advertising.tiktok-ads-strategy": artwork29,
  "yijie.store-operations.amazon-brand-protection": artwork30,
  "yijie.store-operations.buy-now-pay-later-setup": artwork31,
  "yijie.store-operations.ecommerce-gdpr-compliance": artwork32,
  "yijie.store-operations.invoice-generator": artwork33,
  "yijie.store-operations.multichannel-inventory-sync": artwork34,
  "yijie.store-operations.payment-fraud-detector": artwork35,
  "yijie.store-operations.tiktok-shop-setup": artwork36,
  "yijie.store-operations.warehouse-fulfillment-workflow": artwork37,
});

const categoryArtwork = {
  "sourcing-selection": artwork38,
  "market-research": artwork39,
  "content-marketing": artwork40,
  "traffic-advertising": artwork41,
  "store-operations": artwork42,
} as const satisfies Readonly<Record<SkillCategory, string>>;

export function skillCategoryArtwork(category: SkillCategory): string {
  return categoryArtwork[category];
}

export function skillCardArtwork(
  skill: Pick<ManagedSkillProjection, "id" | "category">,
): string {
  return Object.prototype.hasOwnProperty.call(skillArtwork, skill.id)
    ? skillArtwork[skill.id]!
    : skillCategoryArtwork(skill.category);
}
