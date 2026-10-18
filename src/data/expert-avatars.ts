import mossResearch from "../assets/expert-showcase/moss-industry-research.png";
import equityResearch from "../assets/expert-showcase/equity-research.png";
import strategyBacktest from "../assets/expert-showcase/strategy-backtest-expert.png";
import salesVideo from "../assets/expert-showcase/linkfox-expert-aigc-videogen-sale.png";
import dataAnalyst from "../assets/expert-showcase/data-analyst-pro.png";
import uiDesigner from "../assets/expert-showcase/ui-designer.png";
import taobaoOps from "../assets/expert-showcase/tb-tm-ops-expert.png";
import pddOps from "../assets/expert-showcase/pdd-ops-expert.png";
import research from "../assets/expert-showcase/market-researcher.png";
import sourcing1688 from "../assets/expert-showcase/linkfox-expert-1688-sourcing-expert.png";
import videoReplica from "../assets/expert-showcase/linkfox-expert-aigc-videogen-viral-replicate.png";
import mannequin from "../assets/expert-showcase/linkfox-expert-aigc-imagegen-mannequin-to-model.png";
import tiktokShop from "../assets/expert-showcase/chuhaijiang-tiktok-shop-operations-expert.png";
import crossBorder from "../assets/expert-showcase/cross-border-ecommerce-operations-expert.png";
import xiaohongshu from "../assets/expert-showcase/xiaohongshu-copywriter.png";
import comic from "../assets/expert-showcase/agentgrid-comic-storyboard-director.jpg";

import quotation from "../assets/expert-showcase/tradebuddy-baojia.png";
import report from "../assets/expert-showcase/report-viz-expert.png";
import productManagement from "../assets/expert-showcase/product-management.png";
import novelCreator from "../assets/expert-showcase/novel-creator.png";

/** Local presentation only. These paths never become an ExpertRef or a Native request. */
const expertAvatars: ReadonlyMap<string, string> = new Map([
  ["moss-industry-research", mossResearch],
  ["equity-research", equityResearch],
  ["strategy-backtest-expert", strategyBacktest],
  ["linkfox-expert-aigc-videogen-sale", salesVideo],
  ["data-analyst-pro", dataAnalyst],
  ["ui-designer", uiDesigner],
  ["tb-tm-ops-expert", taobaoOps],
  ["pdd-ops-expert", pddOps],
  ["product-management", productManagement],
  ["novel-creator", novelCreator],
  ["market-researcher", research],
  ["linkfox-expert-1688-sourcing-expert", sourcing1688],
  ["linkfox-expert-aigc-videogen-viral-replicate", videoReplica],
  ["linkfox-expert-aigc-imagegen-mannequin-to-model", mannequin],
  ["chuhaijiang-tiktok-shop-operations-expert", tiktokShop],
  ["tradebuddy-baojia", quotation],
  ["report-viz-expert", report],
  ["cross-border-ecommerce-operations-expert", crossBorder],
  ["xiaohongshu-copywriter", xiaohongshu],
  ["agentgrid-comic-storyboard-director", comic],
]);

export function expertAvatar(expertId: string): string | undefined {
  return expertAvatars.get(expertId);
}
