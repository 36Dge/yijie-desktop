// Ordinary, reproducible local media for task-isolation and playback checks.
import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = path.join(root, ".local/media-stress-20261114");
mkdirSync(output, { recursive: true });
for (const [name, color] of [["red", "0xc65349"], ["blue", "0x3c71b5"], ["green", "0x419c73"]]) {
  const video = path.join(output, `video-${name}.mp4`), image = path.join(output, `image-${name}.png`);
  if (!existsSync(video)) {
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-n", "-f", "lavfi", "-i", "color=c=0xe7e7e7:s=640x360:r=24:d=12", "-vf", `drawbox=x=200:y=60:w=240:h=240:color=${color}:t=fill`, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", video], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("Cannot generate ordinary video fixture");
  }
  if (!existsSync(image)) {
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-n", "-i", video, "-frames:v", "1", image], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("Cannot generate ordinary image fixture");
  }
}
console.log("Created ordinary red, blue and green media under .local/media-stress-20261114.");
