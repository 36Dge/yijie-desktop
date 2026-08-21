import {
  ARTIFACT_NATIVE_ERROR_CODES,
  ArtifactNativeContractError,
  artifactNativeRequest,
  parseArtifactNativeError,
  parseArtifactSaveResponse,
  type ArtifactNativeErrorCode,
  type ArtifactNativeErrorShape,
  type ArtifactNativeIdentity,
  type ArtifactSaveResult,
} from "./chat-artifact-native";

export const ARTIFACT_REPORT_NATIVE_SCHEMA_VERSION = 1 as const;
export const ARTIFACT_REPORT_NATIVE_COMMAND_NAMES = [
  "chat_read_artifact_report_preview_v1",
  "chat_save_artifact_report_v1",
] as const;
export const ARTIFACT_REPORT_NATIVE_ERROR_CODES = ARTIFACT_NATIVE_ERROR_CODES;

export type ArtifactReportNativeErrorCode = ArtifactNativeErrorCode;
export type ArtifactReportNativeErrorShape = ArtifactNativeErrorShape;
export type ArtifactReportNativeIdentity = ArtifactNativeIdentity;
export type ArtifactReportSaveResult = ArtifactSaveResult;
export type ArtifactReportScalar = string | number | boolean | null;

type CommonSection = Readonly<{
  ordinal: number;
  id: string;
  required: boolean;
  truncated: boolean;
}>;

export type ArtifactReportSection =
  | (CommonSection & Readonly<{ type: "summary" | "paragraph"; heading: string | null; text: string }>)
  | (CommonSection & Readonly<{
    type: "metrics";
    items: readonly Readonly<{ label: string; value: number | string; unit: string | null }>[];
  }>)
  | (CommonSection & Readonly<{
    type: "table";
    caption: string | null;
    columns: readonly Readonly<{ ordinal: number; key: string; label: string }>[];
    rows: readonly (readonly ArtifactReportScalar[])[];
  }>)
  | (CommonSection & Readonly<{
    type: "chart";
    title: string | null;
    chartType: "bar" | "line" | "pie";
    labels: readonly string[];
    series: readonly Readonly<{ ordinal: number; name: string; values: readonly number[] }>[];
    aligned: boolean;
  }>)
  | (CommonSection & Readonly<{
    type: "callout";
    tone: "info" | "success" | "warning" | "error";
    title: string | null;
    text: string;
  }>)
  | (CommonSection & Readonly<{ type: "unsupported"; required: false }>);

export type ArtifactReportPreviewResult = Readonly<{
  schemaVersion: 1;
  title: string;
  generatedAt: string;
  sourceTime: string | null;
  truncated: boolean;
  sections: readonly ArtifactReportSection[];
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PROJECTION_BYTES = 524_288;
const MAX_RESPONSE_BYTES = 1_048_576;
const encoder = new TextEncoder();

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArtifactNativeContractError();
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new ArtifactNativeContractError();
  }
}

function encodedBytes(value: unknown): number {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new ArtifactNativeContractError();
  }
}

function containsUnsafeControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    );
  });
}

function text(value: unknown, maximum: number, minimum = 0): string {
  if (typeof value !== "string") throw new ArtifactNativeContractError();
  const count = [...value].length;
  if (count < minimum || count > maximum || containsUnsafeControl(value)) {
    throw new ArtifactNativeContractError();
  }
  return value;
}

function nullableText(value: unknown, maximum: number): string | null {
  return value === null ? null : text(value, maximum);
}

function ordinal(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new ArtifactNativeContractError();
  }
  return value as number;
}

function common(section: Record<string, unknown>): CommonSection {
  if (typeof section.required !== "boolean" || typeof section.truncated !== "boolean") {
    throw new ArtifactNativeContractError();
  }
  return {
    ordinal: ordinal(section.ordinal, 63),
    id: text(section.id, 64, 1),
    required: section.required,
    truncated: section.truncated,
  };
}

function parseSection(value: unknown): ArtifactReportSection {
  const section = record(value);
  const shared = common(section);
  if (section.type === "summary" || section.type === "paragraph") {
    exact(section, ["ordinal", "id", "type", "required", "truncated", "heading", "text"]);
    return { ...shared, type: section.type, heading: nullableText(section.heading, 1_024), text: text(section.text, 8_192) };
  }
  if (section.type === "metrics") {
    exact(section, ["ordinal", "id", "type", "required", "truncated", "items"]);
    if (!Array.isArray(section.items) || section.items.length > 32) throw new ArtifactNativeContractError();
    const items = section.items.map((entry) => {
      const item = record(entry);
      exact(item, ["label", "value", "unit"]);
      if (!(typeof item.value === "string" || (typeof item.value === "number" && Number.isFinite(item.value)))) {
        throw new ArtifactNativeContractError();
      }
      return {
        label: text(item.label, 80, 1),
        value: typeof item.value === "string" ? text(item.value, 128) : item.value,
        unit: nullableText(item.unit, 32),
      };
    });
    return { ...shared, type: "metrics", items };
  }
  if (section.type === "table") {
    exact(section, ["ordinal", "id", "type", "required", "truncated", "caption", "columns", "rows"]);
    if (!Array.isArray(section.columns) || section.columns.length > 32 || !Array.isArray(section.rows) || section.rows.length > 200) {
      throw new ArtifactNativeContractError();
    }
    const columns = section.columns.map((entry, index) => {
      const column = record(entry);
      exact(column, ["ordinal", "key", "label"]);
      if (ordinal(column.ordinal, 31) !== index) throw new ArtifactNativeContractError();
      return { ordinal: index, key: text(column.key, 64, 1), label: text(column.label, 80, 1) };
    });
    const rows = section.rows.map((entry) => {
      if (!Array.isArray(entry) || entry.length !== columns.length) throw new ArtifactNativeContractError();
      return entry.map((cell) => {
        if (typeof cell === "string") return text(cell, 1_024);
        if (cell === null || typeof cell === "boolean" || (typeof cell === "number" && Number.isFinite(cell))) return cell;
        throw new ArtifactNativeContractError();
      });
    });
    return { ...shared, type: "table", caption: nullableText(section.caption, 1_024), columns, rows };
  }
  if (section.type === "chart") {
    exact(section, ["ordinal", "id", "type", "required", "truncated", "title", "chartType", "labels", "series", "aligned"]);
    if (!(["bar", "line", "pie"] as unknown[]).includes(section.chartType) || !Array.isArray(section.labels) || section.labels.length > 128 || !Array.isArray(section.series) || section.series.length > 16 || typeof section.aligned !== "boolean") {
      throw new ArtifactNativeContractError();
    }
    const labels = section.labels.map((label) => text(label, 128));
    let points = 0;
    const series = section.series.map((entry, index) => {
      const item = record(entry);
      exact(item, ["ordinal", "name", "values"]);
      if (ordinal(item.ordinal, 15) !== index || !Array.isArray(item.values) || item.values.length > 128 || item.values.some((number) => typeof number !== "number" || !Number.isFinite(number))) {
        throw new ArtifactNativeContractError();
      }
      points += item.values.length;
      return { ordinal: index, name: text(item.name, 80, 1), values: item.values as number[] };
    });
    if (points > 2_048 || section.aligned !== series.every((item) => item.values.length === labels.length)) {
      throw new ArtifactNativeContractError();
    }
    return { ...shared, type: "chart", title: nullableText(section.title, 1_024), chartType: section.chartType as "bar" | "line" | "pie", labels, series, aligned: section.aligned };
  }
  if (section.type === "callout") {
    exact(section, ["ordinal", "id", "type", "required", "truncated", "tone", "title", "text"]);
    if (!(["info", "success", "warning", "error"] as unknown[]).includes(section.tone)) throw new ArtifactNativeContractError();
    return { ...shared, type: "callout", tone: section.tone as "info" | "success" | "warning" | "error", title: nullableText(section.title, 1_024), text: text(section.text, 8_192) };
  }
  exact(section, ["ordinal", "id", "type", "required", "truncated"]);
  if (section.type !== "unsupported" || section.required !== false || section.truncated !== false) {
    throw new ArtifactNativeContractError();
  }
  return { ...shared, type: "unsupported", required: false };
}

export const artifactReportNativeRequest = artifactNativeRequest;

export function parseArtifactReportPreviewResponse(value: unknown): ArtifactReportPreviewResult {
  if (encodedBytes(value) > MAX_RESPONSE_BYTES) throw new ArtifactNativeContractError();
  const outer = record(value);
  exact(outer, ["schemaVersion", "requestId", "data"]);
  if (outer.schemaVersion !== 1 || typeof outer.requestId !== "string" || !UUID.test(outer.requestId)) {
    throw new ArtifactNativeContractError();
  }
  const data = record(outer.data);
  if (encodedBytes(data) > MAX_PROJECTION_BYTES) throw new ArtifactNativeContractError();
  exact(data, ["schemaVersion", "title", "generatedAt", "sourceTime", "truncated", "sections"]);
  if (data.schemaVersion !== 1 || typeof data.generatedAt !== "string" || (data.sourceTime !== null && typeof data.sourceTime !== "string") || typeof data.truncated !== "boolean" || !Array.isArray(data.sections) || data.sections.length > 64) {
    throw new ArtifactNativeContractError();
  }
  return {
    schemaVersion: 1,
    title: text(data.title, 200, 1),
    generatedAt: data.generatedAt,
    sourceTime: data.sourceTime,
    truncated: data.truncated,
    sections: data.sections.map((section, index) => {
      const parsed = parseSection(section);
      if (parsed.ordinal !== index) throw new ArtifactNativeContractError();
      return parsed;
    }),
  };
}

export const parseArtifactReportSaveResponse = parseArtifactSaveResponse;
export const parseArtifactReportNativeError = parseArtifactNativeError;
