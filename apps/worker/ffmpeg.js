// apps/worker/ffmpeg.js
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { downloadToFile, uploadFile } from "./r2.js";

const run = promisify(exec);

// Cross-platform temp directory (Windows/Linux)
const TMP = process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp";

export async function processVideo(asset) {
  // Use asset id as stable folder name
  const input = path.join(TMP, `${asset._id}-original.mp4`);
  const outputDir = path.join(TMP, `${asset._id}-hls`);

  // Ensure output folders exist
  fs.mkdirSync(outputDir, { recursive: true });
  ["v0", "v1", "v2"].forEach((d) => {
    fs.mkdirSync(path.join(outputDir, d), { recursive: true });
  });

  // 1) Download original from R2
  await downloadToFile(asset.original.key, input);

  // 2) Run FFmpeg (Windows-safe: one-line command, quoted paths)
  // -map 0:a? prevents failing when video has no audio track.
  const cmd = [
    `ffmpeg -y`,
    `-i "${input}"`,
    `-filter_complex "[0:v]split=3[v1][v2][v3]"`,
    `-map "[v1]" -s 1920x1080 -c:v:0 libx264 -b:v:0 5000k`,
    `-map "[v2]" -s 1280x720 -c:v:1 libx264 -b:v:1 2800k`,
    `-map "[v3]" -s 854x480  -c:v:2 libx264 -b:v:2 1400k`,
    `-map 0:a? -c:a aac -b:a 128k`,
    `-f hls`,
    `-hls_time 4`,
    `-hls_playlist_type vod`,
    `-hls_segment_filename "${outputDir}/v%v/segment_%03d.ts"`,
    `-master_pl_name master.m3u8`,
    `-var_stream_map "v:0,a:0 v:1,a:0 v:2,a:0"`,
    `"${outputDir}/v%v/index.m3u8"`,
  ].join(" ");

  await run(cmd);

  // 3) Upload generated files back to R2
  const files = getAllFiles(outputDir);

  for (const file of files) {
    // Ensure keys always use forward slashes even on Windows
    const relative = path.relative(outputDir, file).replaceAll("\\", "/");
    const key = `media/${asset.ownerUid}/${asset._id}/hls/${relative}`;

    await uploadFile(key, file, guessContentType(file));
  }

  // 4) Save master playlist key
  asset.hls = {
    masterPlaylistKey: `media/${asset.ownerUid}/${asset._id}/hls/master.m3u8`,
  };

  await asset.save();
}

function getAllFiles(dir) {
  const results = [];
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) results.push(...getAllFiles(full));
    else results.push(full);
  }
  return results;
}

function guessContentType(file) {
  if (file.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (file.endsWith(".ts")) return "video/mp2t";
  if (file.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}
