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

  try {
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
  } catch (e) {
    console.warn(
      "[worker][ffmpeg] thumbnail generation failed:",
      e?.message || e,
    );
  }

  // 4) HLS transcode (audio-safe) — FIXED
  // Root cause (confirmed from your DB error): your previous command produced duplicate/identical variants,
  // so the HLS muxer rejected it ("Same elementary stream found more than once").
  // Fix: create distinct scaled video streams via filter_complex and map them explicitly.

  const filter = [
    `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v1080]`,
    `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v720]`,
    `[0:v]scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2[v480]`,
  ].join(";");

  const maps = [
    `-map "[v1080]" -c:v:0 libx264 -b:v:0 5000k -maxrate:v:0 5350k -bufsize:v:0 7500k`,
    `-map "[v720]"  -c:v:1 libx264 -b:v:1 2800k -maxrate:v:1 2996k -bufsize:v:1 4200k`,
    `-map "[v480]"  -c:v:2 libx264 -b:v:2 1400k -maxrate:v:2 1498k -bufsize:v:2 2100k`,
  ];

  const audioPart = hasAudio
    ? [
        `-map 0:a:0 -c:a:0 aac -b:a:0 128k -ac:a:0 2`,
        `-map 0:a:0 -c:a:1 aac -b:a:1 128k -ac:a:1 2`,
        `-map 0:a:0 -c:a:2 aac -b:a:2 128k -ac:a:2 2`,
      ]
    : [];

  const varMap = hasAudio
    ? `-var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2"`
    : `-var_stream_map "v:0 v:1 v:2"`;

  const cmd = [
    `ffmpeg -y`,
    `-i "${input}"`,
    `-filter_complex "${filter}"`,
    ...maps,
    ...audioPart,
    `-preset veryfast`,
    `-pix_fmt yuv420p`,
    `-g 48`,
    `-keyint_min 48`,
    `-sc_threshold 0`,
    `-f hls`,
    `-hls_time 4`,
    `-hls_playlist_type vod`,
    `-hls_flags independent_segments`,
    `-hls_segment_filename "${outputDir}/v%v/segment_%03d.ts"`,
    `-master_pl_name master.m3u8`,
    varMap,
    `"${outputDir}/v%v/index.m3u8"`,
  ].join(" ");

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
