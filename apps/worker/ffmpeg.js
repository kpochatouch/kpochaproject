// apps/worker/ffmpeg.js
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { downloadToFile, uploadFile } from "./r2.js";

const run = promisify(exec);

const TMP = process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp";

export async function processVideo(asset) {
  const origKey = String(asset?.original?.key || "");
  if (!origKey) throw new Error("asset.original.key missing");

  const ext = (origKey.split(".").pop() || "mp4").replace(/[^a-z0-9]/gi, "");
  const input = path.join(TMP, `${asset._id}-original.${ext || "mp4"}`);
  const outputDir = path.join(TMP, `${asset._id}-hls`);
  const thumbFile = path.join(TMP, `${asset._id}-thumb.jpg`);

  fs.mkdirSync(outputDir, { recursive: true });
  ["v0", "v1", "v2"].forEach((d) =>
    fs.mkdirSync(path.join(outputDir, d), { recursive: true }),
  );

  // 1) Download original
  await downloadToFile(asset.original.key, input);

  // 2) Probe streams (audio present? width/height/duration?)
  const probe = await ffprobe(input);
  const vStream =
    (probe.streams || []).find((s) => s.codec_type === "video") || null;
  const hasAudio = (probe.streams || []).some((s) => s.codec_type === "audio");

  const width = Number(vStream?.width || 0);
  const height = Number(vStream?.height || 0);

  const durationSec = Number(probe.format?.duration || 0);

  // 3) Generate thumbnail (best-effort)
  // pick frame at 0.5s (or 0 if duration is unknown)
  const seek =
    durationSec && Number.isFinite(durationSec) && durationSec > 1 ? 0.5 : 0;
  await run(
    [
      `ffmpeg -y`,
      `-ss ${seek}`,
      `-i "${input}"`,
      `-frames:v 1`,
      `-q:v 3`,
      `"${thumbFile}"`,
    ].join(" "),
  );

  // 4) HLS transcode (audio-safe)
  // Note: keep it Windows-safe by quoting only file paths.
  const common = [
    `ffmpeg -y`,
    `-i "${input}"`,
    `-filter_complex "[0:v]split=3[v1][v2][v3]"`,
    `-map "[v1]" -s 1920x1080 -c:v:0 libx264 -b:v:0 5000k`,
    `-map "[v2]" -s 1280x720  -c:v:1 libx264 -b:v:1 2800k`,
    `-map "[v3]" -s 854x480   -c:v:2 libx264 -b:v:2 1400k`,
  ];

  const audioPart = hasAudio ? [`-map 0:a:0 -c:a aac -b:a 128k`] : []; // no audio mapping at all

  const varMap = hasAudio
    ? `-var_stream_map "v:0,a:0 v:1,a:0 v:2,a:0"`
    : `-var_stream_map "v:0 v:1 v:2"`;

  const hlsPart = [
    `-f hls`,
    `-hls_time 4`,
    `-hls_playlist_type vod`,
    `-hls_segment_filename "${outputDir}/v%v/segment_%03d.ts"`,
    `-master_pl_name master.m3u8`,
    varMap,
    `"${outputDir}/v%v/index.m3u8"`,
  ];

  const cmd = [...common, ...audioPart, ...hlsPart].join(" ");
  await run(cmd);

  // 5) Upload thumbnail
  const thumbKey = `media/${asset.ownerUid}/${asset._id}/thumb.jpg`;
  if (fs.existsSync(thumbFile)) {
    await uploadFile(thumbKey, thumbFile, "image/jpeg");
  }

  // 6) Upload HLS files
  const files = getAllFiles(outputDir);
  for (const file of files) {
    const relative = path.relative(outputDir, file).replaceAll("\\", "/");
    const key = `media/${asset.ownerUid}/${asset._id}/hls/${relative}`;
    await uploadFile(key, file, guessContentType(file));
  }

  // 7) Persist keys + meta
  asset.original = {
    ...(asset.original || {}),
    width,
    height,
    durationSec,
    // size is optional unless you want to HEAD the object
  };

  asset.thumbnail = {
    key: thumbKey,
    width: 0,
    height: 0,
  };

  asset.hls = {
    masterPlaylistKey: `media/${asset.ownerUid}/${asset._id}/hls/master.m3u8`,
  };

  asset.renditions = [
    {
      name: "1080p",
      playlistKey: `media/${asset.ownerUid}/${asset._id}/hls/v0/index.m3u8`,
      bandwidth: 5000000,
      width: 1920,
      height: 1080,
    },
    {
      name: "720p",
      playlistKey: `media/${asset.ownerUid}/${asset._id}/hls/v1/index.m3u8`,
      bandwidth: 2800000,
      width: 1280,
      height: 720,
    },
    {
      name: "480p",
      playlistKey: `media/${asset.ownerUid}/${asset._id}/hls/v2/index.m3u8`,
      bandwidth: 1400000,
      width: 854,
      height: 480,
    },
  ];

  await asset.save();

  // optional cleanup (safe best-effort)
  try {
    fs.rmSync(outputDir, { recursive: true, force: true });
  } catch {}
  try {
    fs.unlinkSync(input);
  } catch {}
  try {
    fs.unlinkSync(thumbFile);
  } catch {}
}

async function ffprobe(filePath) {
  // JSON output; works on Windows/Linux if ffprobe is installed
  const cmd = `ffprobe -v error -print_format json -show_streams -show_format "${filePath}"`;
  const { stdout } = await run(cmd);
  try {
    return JSON.parse(stdout || "{}");
  } catch {
    return {};
  }
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
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}
