// Bundled user-provided artwork; keys preserve the catalogue serverName.
import icon0 from "../assets/connectors/cue.png?url";
import icon1 from "../assets/connectors/baixiao-mcp.png?url";
import icon2 from "../assets/connectors/dxe-mcp-server.svg?url";
import icon3 from "../assets/connectors/Hologrow.png?url";
import icon4 from "../assets/connectors/X-Store.png?url";
import icon5 from "../assets/connectors/yintai-open-platform.png?url";
import icon6 from "../assets/connectors/yuyidata.png?url";
import icon8 from "../assets/connectors/FTShare.png?url";
import icon9 from "../assets/connectors/yunting-consumerlens.png?url";
import icon10 from "../assets/connectors/google-calendar.png?url";
import icon11 from "../assets/connectors/google-maps.png?url";
import icon12 from "../assets/connectors/speechclaw.png?url";
import icon13 from "../assets/connectors/caoliao.png?url";
import icon14 from "../assets/connectors/wavenote.png?url";
import icon15 from "../assets/connectors/yida.png?url";
import icon16 from "../assets/connectors/qingflow.png?url";
import icon17 from "../assets/connectors/uupt.png?url";
import icon18 from "../assets/connectors/fenbeitong.png?url";
import icon19 from "../assets/connectors/bazhuayu.png?url";
import icon20 from "../assets/connectors/camscanner-mcp.png?url";
import icon21 from "../assets/connectors/todoist.svg?url";
import icon22 from "../assets/connectors/agentkey-qwen.png?url";
import icon23 from "../assets/connectors/huida-erp.png?url";
import icon24 from "../assets/connectors/FastMoss.png?url";
import icon25 from "../assets/connectors/smartsalary.png?url";
import icon26 from "../assets/connectors/qixin_insight.png?url";
import icon27 from "../assets/connectors/zerone.png?url";
import icon28 from "../assets/connectors/patent-analysis.svg?url";
import icon29 from "../assets/connectors/thinkingdata.jpg?url";
import icon30 from "../assets/connectors/morningstar.png?url";
import icon31 from "../assets/connectors/dichanai-mcp.svg?url";
import icon32 from "../assets/connectors/Yingmi.png?url";
import icon33 from "../assets/connectors/wind.png?url";
import icon34 from "../assets/connectors/yidian-company.png?url";
import icon35 from "../assets/connectors/investoday.png?url";
import icon36 from "../assets/connectors/dzh-mcp.png?url";
import icon37 from "../assets/connectors/Octoparse-data-hub.png?url";
import icon39 from "../assets/connectors/tushareMcp.png?url";
import icon40 from "../assets/connectors/eastmoney.png?url";
import icon41 from "../assets/connectors/gildata_finance_data_qwen.png?url";
import icon42 from "../assets/connectors/fanruan-growth-advisor.png?url";
import icon43 from "../assets/connectors/weibo.svg?url";
import icon44 from "../assets/connectors/jinshuju.svg?url";
import icon45 from "../assets/connectors/xiaoe-mcp.png?url";
import icon46 from "../assets/connectors/feisentry.png?url";
import icon47 from "../assets/connectors/xiaoliebian.png?url";
import icon48 from "../assets/connectors/ysk_mcp_3f824505d1faf80bc60c052729620929.png?url";
import icon49 from "../assets/connectors/3chat.png?url";
import icon50 from "../assets/connectors/xiaoliebian-geo.png?url";

import crossBorder0 from "../assets/connectors/lingxing.svg?url";
import crossBorder1 from "../assets/connectors/sif.svg?url";
import crossBorder2 from "../assets/connectors/keepa.svg?url";
import crossBorder3 from "../assets/connectors/pangolinfo.svg?url";
import crossBorder4 from "../assets/connectors/datahawk.svg?url";
import crossBorder5 from "../assets/connectors/seller-labs.svg?url";
import crossBorder6 from "../assets/connectors/shopify.svg?url";
import crossBorder7 from "../assets/connectors/sellersprite.svg?url";
import crossBorder8 from "../assets/connectors/sorftime.svg?url";

const connectorIcons: Readonly<Record<string, string>> = Object.freeze({
  "lingxing": crossBorder0,
  "sif": crossBorder1,
  "keepa": crossBorder2,
  "pangolinfo": crossBorder3,
  "datahawk": crossBorder4,
  "seller-labs": crossBorder5,
  "shopify": crossBorder6,
  "sellersprite": crossBorder7,
  "sorftime": crossBorder8,

  "cue": icon0,
  "baixiao-mcp": icon1,
  "dxe-mcp-server": icon2,
  "Hologrow": icon3,
  "X-Store": icon4,
  "yintai-open-platform": icon5,
  "yuyidata": icon6,
  "FTShare": icon8,
  "yunting-consumerlens": icon9,
  "google-calendar": icon10,
  "google-maps": icon11,
  "speechclaw": icon12,
  "caoliao": icon13,
  "wavenote": icon14,
  "yida": icon15,
  "qingflow": icon16,
  "uupt": icon17,
  "fenbeitong": icon18,
  "bazhuayu": icon19,
  "camscanner-mcp": icon20,
  "todoist": icon21,
  "agentkey-qwen": icon22,
  "huida-erp": icon23,
  "FastMoss": icon24,
  "smartsalary": icon25,
  "qixin_insight": icon26,
  "zerone": icon27,
  "patent-analysis": icon28,
  "thinkingdata": icon29,
  "morningstar": icon30,
  "dichanai-mcp": icon31,
  "Yingmi": icon32,
  "wind": icon33,
  "yidian-company": icon34,
  "investoday": icon35,
  "dzh-mcp": icon36,
  "Octoparse-data-hub": icon37,
  "tushareMcp": icon39,
  "eastmoney": icon40,
  "gildata_finance_data_qwen": icon41,
  "fanruan-growth-advisor": icon42,
  "weibo": icon43,
  "jinshuju": icon44,
  "xiaoe-mcp": icon45,
  "feisentry": icon46,
  "xiaoliebian": icon47,
  "ysk_mcp_3f824505d1faf80bc60c052729620929": icon48,
  "3chat": icon49,
  "xiaoliebian-geo": icon50,
});

export function connectorIconUrl(iconAssetId: string): string | null {
  return Object.prototype.hasOwnProperty.call(connectorIcons, iconAssetId) ? connectorIcons[iconAssetId]! : null;
}
