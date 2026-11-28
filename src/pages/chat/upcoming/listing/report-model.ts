export interface ReportPhoto { src: string; title: string; caption: string; contain?: boolean }
export interface ReportChart { type: "chart"; kind: "bar" | "line" | "pie"; title: string; note: string; unit: string; points: [string, number][] }
export type ReportBlock =
  | { type: "photos"; photos: ReportPhoto[] }
  | { type: "rewrite"; before: string; after: string; reason: string }
  | { type: "table"; title: string; columns: string[]; rows: string[][] }
  | ReportChart
  | { type: "charts"; charts: ReportChart[] }
  | { type: "flow"; title: string; steps: { title: string; text: string }[] }
  | { type: "matrix"; title: string; columns: string[]; rows: { label: string; values: ("已有" | "可补" | "待核")[] }[] }
  | { type: "notes"; items: { title: string; text: string }[] };

export interface ReportSection {
  id: string;
  nav: string;
  title: string;
  lead: string;
  blocks: ReportBlock[];
}
export interface PlatformReport {
  name: string;
  market: string;
  identifier: string;
  summary: string;
  overview?: { title: string; text: string }[];
  metrics: { label: string; value: string }[];
  sections: ReportSection[];
  sourceNote: string;
}
