import entryAsset from "../../assets/mascot/provenance.json";

export interface MascotClipManifest {
  deliveryResolution: number[];
  frameCount: number;
  fps: number;
  playback: {
    columns: number;
    framesPerSheet: number;
    maxResidentSheets: number;
    sheets: { file: string }[];
  };
}
export interface MascotMedia { asset: MascotClipManifest; urls: string[] }

const manifests = import.meta.glob<unknown>("../../assets/mascot/hover/provenance.json", { eager: true, import: "default" });
const sheets = import.meta.glob<string>("../../assets/mascot/hover/frames/*.webp", { eager: true, query: "?url", import: "default" });

/** Media is optional until an audited, registered clip is explicitly accepted. */
export function getAcceptedHoverMedia(): MascotMedia | null {
  const candidate = manifests["../../assets/mascot/hover/provenance.json"];
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Partial<MascotClipManifest> & { acceptance?: { status?: string } };
  if (value.acceptance?.status !== "accepted"
    || !Array.isArray(value.deliveryResolution) || value.deliveryResolution.length !== 2
    || value.deliveryResolution[0] !== entryAsset.deliveryResolution[0]
    || value.deliveryResolution?.[1] !== entryAsset.deliveryResolution[1]
    || value.fps !== entryAsset.fps || !Number.isInteger(value.frameCount) || (value.frameCount ?? 0) < 2
    || value.playback?.columns !== entryAsset.playback.columns
    || value.playback?.framesPerSheet !== entryAsset.playback.framesPerSheet
    || value.playback?.maxResidentSheets !== entryAsset.playback.maxResidentSheets
    || !Array.isArray(value.playback.sheets)
    || value.playback.sheets.length !== Math.ceil(value.frameCount! / value.playback.framesPerSheet)
    || value.playback.sheets.some(sheet => !sheet || typeof sheet.file !== "string")) return null;
  const urls = value.playback.sheets.map(sheet => sheets[`../../assets/mascot/hover/${sheet.file}`]);
  if (urls.some(url => !url)) return null;
  return { asset: value as MascotClipManifest, urls };
}
