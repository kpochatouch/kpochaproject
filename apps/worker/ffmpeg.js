// apps/worker/ffmpeg.js
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { downloadToFile, uploadFile } from "./r2.js";

const TMP = process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp";

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";
    let lastProgressLogAt = 0;

    console.log(
      `[worker][proc] spawn command=${command} pid=${child.pid || "unknown"}`,
    );

    child.stdout?.on("data", (chunk) => {
      const text = String(chunk || "");
      stdout += text;
      if (stdout.length > 20000) stdout = stdout.slice(-20000);
    });

    child.stderr?.on("data", (chunk) => {
      const text = String(chunk || "");
      stderr += text;
      if (stderr.length > 40000) stderr = stderr.slice(-40000);

      const now = Date.now();
      if (now - lastProgressLogAt > 5000) {
        lastProgressLogAt = now;
        const tail = stderr.slice(-500).replace(/\s+/g, " ").trim();
        console.log(
          `[worker][proc] ${command} pid=${
            child.pid || "unknown"
          } running ${Math.round((now - startedAt) / 1000)}s tail=${tail}`,
        );
      }
    });

    child.on("error", (err) => {
      console.error(
        `[worker][proc] error command=${command} pid=${child.pid || "unknown"}`,
        err,
      );
      reject(err);
    });

    child.on("close", (code, signal) => {
      const durationSec = Math.round((Date.now() - startedAt) / 1000);
      console.log(
        `[worker][proc] close command=${command} pid=${
          child.pid || "unknown"
        } code=${code} signal=${signal || "none"} duration=${durationSec}s`,
      );

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const err = new Error(
        `${command} exited with code ${code}${
          signal ? ` signal ${signal}` : ""
        }${stderr ? `: ${stderr.slice(-1000)}` : ""}`,
      );
      err.code = code;
      err.signal = signal;
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
    `[worker][mem] ${tag} rss=${toMB(m.rss)}MB heapUsed=${toMB(
      m.heapUsed,
    )}MB heapTotal=${toMB(m.heapTotal)}MB external=${toMB(m.external)}MB`,
  );
}

export async function processVideo(asset) {
  const origKey = String(asset?.original?.key || "");
  if (!origKey) throw new Error("asset.original.key missing");

  const ext = (origKey.split(".").pop() || "mp4").replace(/[^a-z0-9]/gi, "");
  const input = path.join(TMP, `${asset._id}-original.${ext || "mp4"}`);
  const trimmedInput = path.join(TMP, `${asset._id}-trimmed.mp4`);
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

    const trimStart = Number(asset?.trim?.startSec || 0);
    const trimEnd = Number(asset?.trim?.endSec || 0);
    const hasTrim =
      Number.isFinite(trimStart) &&
      Number.isFinite(trimEnd) &&
      trimEnd > trimStart;

    let processingInput = input;
    const isStory = asset?.purpose === "story";

    if (hasTrim) {
      console.log(
        `[worker][ffmpeg] trim start asset=${asset._id} start=${trimStart} end=${trimEnd}`,
      );

      await runCommand("ffmpeg", [
        "-y",
        "-ss",
        String(trimStart),
        "-to",
        String(trimEnd),
        "-i",
        processingInput,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        trimmedInput,
      ]);

      console.log(`[worker][ffmpeg] trim finished asset=${asset._id}`);
      processingInput = trimmedInput;
    }

    const probe = await ffprobe(processingInput);
    const vStream =
      (probe.streams || []).find((s) => s.codec_type === "video") || null;
    const hasAudio = (probe.streams || []).some(
      (s) => s.codec_type === "audio",
    );

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
        processingInput,
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

    const filter = isStory
      ? [
          `[0:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2[v360]`,
        ].join(";")
      : [
          `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v720]`,
          `[0:v]scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2[v480]`,
        ].join(";");

    const args = isStory
      ? [
          "-y",
          "-i",
          processingInput,
          "-filter_complex",
          filter,

          "-map",
          "[v360]",
          "-c:v:0",
          "libx264",
          "-preset",
          "veryfast",
          "-threads",
          "1",
          "-pix_fmt",
          "yuv420p",
          "-b:v:0",
          "700k",
          "-maxrate:v:0",
          "800k",
          "-bufsize:v:0",
          "1200k",
        ]
      : [
          "-y",
          "-i",
          processingInput,
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
      if (isStory) {
        args.push(
          "-map",
          "0:a:0",
          "-c:a:0",
          "aac",
          "-b:a:0",
          "96k",
          "-ac:a:0",
          "2",
        );
      } else {
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
      isStory
        ? hasAudio
          ? "v:0,a:0"
          : "v:0"
        : hasAudio
        ? "v:0,a:0 v:1,a:1"
        : "v:0 v:1",
      `${outputDir}/v%v/index.m3u8`,
    );

    console.log(`[worker][ffmpeg] transcode start asset=${asset._id}`);
    await runCommand("ffmpeg", args);
    console.log(`[worker][ffmpeg] transcode finished asset=${asset._id}`);

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

    asset.renditions = isStory
      ? [
          {
            name: "360p",
            playlistKey: `media/${asset.ownerUid}/${asset._id}/hls/v0/index.m3u8`,
            bandwidth: 700000,
            width: 640,
            height: 360,
          },
        ]
      : [
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

    if (asset.trim) {
      asset.trim.applied = hasTrim;
    }

    await asset.save();

    logMemory(`done ${asset._id}`);
  } finally {
    try {
      fs.unlinkSync(trimmedInput);
    } catch {}
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
