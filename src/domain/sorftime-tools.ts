// Published marketplace aliases bind a service and a method. Direct calls in
// older histories carry the same method under the Sorftime server instead.
const catalog = {
  category_tree: ["m_b36dd5030774405dd3a4eef40551ae7e92244e4c20a4141636591fa1f7ed", "读取类目树"],
  category_search_from_top_node: ["m_4c98d010d448950b1abcb218c7e891a8a6bcc32f760ac17e2930d0a466fb", "按上级类目查询"],
  category_search_from_product_name: ["m_1d673ceb21a3c8e9b62a3a9ff2d142c1f4e1442ebce7e1b92ae02ef420b2", "查询 Amazon 类目"],
  category_name_search: ["m_01c8f1e2578484e06124803a716fd12d7cbe0bafac9ccf31381173c611d2", "按名称查询类目"],
  category_report: ["m_2d771efc4d5dff378792e72c4f054f0390012410439fab7409c58c7c082f", "查询类目报告"],
  category_products: ["m_8b36c2d3b0d4682e7182e82f3b0fd093f941081d7863b1d8a52690ac9c6d", "查询类目商品"],
  category_products_extended: ["m_9cc0e4c46de4f996daf161d33cde0bbee45f90d5afbcb3229db141d103f7", "查询类目商品"],
  product_detail: ["m_1432d121c0c49225c55e2f004f8fe2f5f8fcf841083c77681ea73541b96f", "查看 Amazon 商品详情"],
  product_trend: ["m_22569a9d5af2c64c646ea53948cf59f20f72d2ada7664b9bf6e1d10e1774", "查询商品趋势"],
  common_usage_query: ["m_d37f79f74790aefcccf8aeef5328803e8537c99b783655a96aa1a62b11e6", "查询 Sorftime 剩余额度"],
  get_time: ["m_bb937a0bb01629b3692420a9a321bc3dc75cf914bb3fd49db53045e95f06", "查询 Sorftime 服务时间"],
} as const;

export type SorftimeMethod = keyof typeof catalog;
export const sorftimeCategoryTool = catalog.category_search_from_product_name[0];
type Tool = Readonly<{method: SorftimeMethod; title: string; source: string; auxiliary: boolean}>;
const tools = new Map<string, Tool>();
for (const method of Object.keys(catalog) as SorftimeMethod[]) {
  const [alias, title] = catalog[method];
  const auxiliary = method === "common_usage_query" || method === "get_time";
  tools.set(`yijie_market/${alias}`, {method, title, auxiliary, source: "Sorftime"});
  tools.set(`sorftime/${method}`, {method, title, auxiliary, source: "Sorftime（旧版）"});
}

export function sorftimeTool(server?: string, tool?: string) {
  return tools.get(`${server}/${tool}`);
}
