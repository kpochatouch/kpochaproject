// apps/worker/ffmpeg.js
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { downloadToFile, uploadFile } from "./r2.js";

const TMP = process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp";

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      const text = String(chunk || "");
      stdout += text;
      if (stdout.length > 20000) stdout = stdout.slice(-20000);
    });

    child.stderr?.on("data", (chunk) => {
      const text = String(chunk || "");
      stderr += text;
      if (stderr.length > 40000) stderr = stderr.slice(-40000);
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const err = new Error(
        `${command} exited with code ${code}${stderr ? `: ${stderr.slice(-1000)}` : ""}`,
      );
      err.code = code;
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });
  });
}

function logMemory(tag) {
  const m = process.memoryUsage();
  const toMB = (n) => Math.round((n / 1024 / 1024) * 10) / 10;
  console.log(
    `[worker][mem] ${tag} rss=${toMB(m.rss)}MB heapUsed=${toMB(m.heapUsed)}MB heapTotal=${toMB(m.heapTotal)}MB external=${toMB(m.external)}MB`,
  );
}

export async function processVideo(asset) {
  const origKey = String(asset?.original?.key || "");
  if (!origKey) throw new Error("asset.original.key missing");

  const ext = (origKey.split(".").pop() || "mp4").replace(/[^a-z0-9]/gi, "");
  const input = path.join(TMP, `${asset._id}-original.${ext || "mp4"}`);
  const outputDir = path.join(TMP, `${asset._id}-hls`);
  const thumbFile = path.join(TMP, `${asset._id}-thumb.jpg`);

  fs.mkdirSync(outputDir, { recursive: true });
  ["v0", "v1"].forEach((d) =>
    fs.mkdirSync(path.join(outputDir, d), { recursive: true }),
  );

  try {
    logMemory(`before download ${asset._id}`);

    await downloadToFile(asset.original.key, input);

    logMemory(`after download ${asset._id}`);

    const probe = await ffprobe(input);
    const vStream =
      (probe.streams || []).find((s) => s.codec_type === "video") || null;
    const hasAudio = (probe.streams || []).some((s) => s.codec_type === "audio");

    const width = Number(vStream?.width || 0);
    const height = Number(vStream?.height || 0);
    const durationSec = Number(probe.format?.duration || 0);

    const seek =
      durationSec && Number.isFinite(durationSec) && durationSec > 1 ? 0.5 : 0;

    try {
      await runCommand("ffmpeg", [
        "-y",
        "-ss",
        String(seek),
        "-i",
        input,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        thumbFile,
      ]);
    } catch (e) {
      console.warn(
        "[worker][ffmpeg] thumbnail generation failed:",
        e?.message || e,
      );
    }

    logMemory(`before transcode ${asset._id}`);

    const filter = [
      `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v720]`,
      `[0:v]scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2[v480]`,
    ].join(";");

    const args = [
      "-y",
      "-i",
      input,
      "-filter_complex",
      filter,

      "-map",
      "[v720]",
      "-c:v:0",
      "libx264",
      "-preset",
      "veryfast",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-b:v:0",
      "2800k",
      "-maxrate:v:0",
      "2996k",
      "-bufsize:v:0",
      "4200k",

      "-map",
      "[v480]",
      "-c:v:1",
      "libx264",
      "-preset",
      "veryfast",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-b:v:1",
      "1400k",
      "-maxrate:v:1",
      "1498k",
      "-bufsize:v:1",
      "2100k",
    ];

    if (hasAudio) {
      args.push(
        "-map",
        "0:a:0",
        "-c:a:0",
        "aac",
        "-b:a:0",
        "128k",
        "-ac:a:0",
        "2",
        "-map",
        "0:a:0",
        "-c:a:1",
        "aac",
        "-b:a:1",
        "128k",
        "-ac:a:1",
        "2",
      );
    }

    args.push(
      "-g",
      "48",
      "-keyint_min",
      "48",
      "-sc_threshold",
      "0",
      "-f",
      "hls",
      "-hls_time",
      "4",
      "-hls_playlist_type",
      "vod",
      "-hls_flags",
      "independent_segments",
      "-hls_segment_filename",
      `${outputDir}/v%v/segment_%03d.ts`,
      "-master_pl_name",
      "master.m3u8",
      "-var_stream_map",
      hasAudio ? "v:0,a:0 v:1,a:1" : "v:0 v:1",
      `${outputDir}/v%v/index.m3u8`,
    );

    await runCommand("ffmpeg", args);

    logMemory(`after transcode ${asset._id}`);

    const thumbKey = `media/${asset.ownerUid}/${asset._id}/thumb.jpg`;
    if (fs.existsSync(thumbFile)) {
      await uploadFile(thumbKey, thumbFile, "image/jpeg");
    }

    const files = getAllFiles(outputDir);
    for (const file of files) {
      const relative = path.relative(outputDir, file).replaceAll("\\", "/");
      const key = `media/${asset.ownerUid}/${asset._id}/hls/${relative}`;
      await uploadFile(key, file, guessContentType(file));
    }

    asset.original = {
      ...(asset.original || {}),
      width,
      height,
      durationSec,
    };

    asset.thumbnail = fs.existsSync(thumbFile)
      ? {
          key: thumbKey,
          width: 0,
          height: 0,
        }
      : null;

    asset.hls = {
      masterPlaylistKey: `media/${asset.ownerUid}/${asset._id}/hls/master.m3u8`,
    };

    asset.renditions = [
      {
        name: "720p",
        playlistKey: `media/${asset.ownerUid}/${asset._id}/hls/v0/index.m3u8`,
        bandwidth: 2800000,
        width: 1280,
        height: 720,
      },
      {
        name: "480p",
        playlistKey: `media/${asset.ownerUid}/${asset._id}/hls/v1/index.m3u8`,
        bandwidth: 1400000,
        width: 854,
        height: 480,
      },
    ];

    await asset.save();

    logMemory(`done ${asset._id}`);
  } finally {
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
}

async function ffprobe(filePath) {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    filePath,
  ]);

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
