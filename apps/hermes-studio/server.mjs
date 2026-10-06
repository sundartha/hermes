import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 5181;
const HF = "higgsfield";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "out");
const REMOTION_BIN = path.join(__dirname, "node_modules", ".bin", "remotion");

function run(args, timeoutMs = 15 * 60 * 1000) {
  return new Promise((resolve) => {
    execFile(HF, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

function runCmd(cmd, args, timeoutMs = 20 * 60 * 1000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: __dirname, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

function findResultUrl(node) {
  if (!node || typeof node !== "object") return null;
  for (const key of ["result_url", "resultUrl", "url", "video_url", "output_url"]) {
    if (typeof node[key] === "string" && node[key].startsWith("http")) return node[key];
  }
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const found = findResultUrl(v);
    if (found) return found;
  }
  return null;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function send(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(obj));
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  if (req.method === "GET" && req.url === "/api/status") {
    const auth = await run(["auth", "token"], 20000);
    const authed = !/Not authenticated/i.test(auth.stderr + auth.stdout);
    let needsWorkspace = false;
    if (authed) {
      const acc = await run(["account", "status"], 20000);
      needsWorkspace = /No workspace selected/i.test(acc.stderr + acc.stdout);
    }
    return send(res, 200, { authed, needsWorkspace });
  }

  if (req.method === "POST" && req.url === "/api/generate") {
    const job = await readBody(req);
    const args = [
      "generate", "create", "marketing_studio_video",
      "--prompt", String(job.prompt ?? ""),
      "--mode", String(job.mode ?? "ugc"),
      "--duration", String(job.duration ?? 15),
      "--aspect_ratio", String(job.aspect_ratio ?? "9:16"),
      "--resolution", String(job.resolution ?? "720p"),
      "--generate-audio", "true",
      "--wait", "--json",
    ];
    const r = await run(args);
    if (r.err && !r.stdout) {
      return send(res, 502, { error: "cli_failed", detail: (r.stderr || String(r.err)).slice(0, 1200) });
    }
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { }
    const clipUrl = parsed ? findResultUrl(parsed) : null;
    if (!clipUrl) {
      return send(res, 502, { error: "no_url", detail: (r.stdout || r.stderr).slice(0, 1200) });
    }
    return send(res, 200, { clipUrl });
  }

  if (req.method === "POST" && req.url === "/api/render") {
    const plan = await readBody(req);
    if (!plan || !plan.clipUrl) {
      return send(res, 400, { error: "no_clip", detail: "Render-Plan ohne clipUrl — erst einen Clip erzeugen/eintragen." });
    }
    await mkdir(OUT_DIR, { recursive: true });
    const id = Date.now().toString(36);
    const planPath = path.join(OUT_DIR, `plan-${id}.json`);
    const outFile = path.join(OUT_DIR, `reel-${id}.mp4`);
    await writeFile(planPath, JSON.stringify(plan), "utf8");
    const r = await runCmd(REMOTION_BIN, [
      "render", "remotion/index.ts", "HermesReel", outFile,
      `--props=${planPath}`, "--log=error",
    ]);
    let ok = false;
    try { ok = (await stat(outFile)).size > 0; } catch { ok = false; }
    if (!ok) {
      return send(res, 502, { error: "render_failed", detail: (r.stderr || r.stdout || String(r.err)).slice(0, 1500) });
    }
    return send(res, 200, { mp4Url: `/out/reel-${id}.mp4`, file: outFile });
  }

  if (req.method === "GET" && req.url.startsWith("/out/")) {
    const name = path.basename(decodeURIComponent(req.url.split("?")[0].slice(5)));
    const filePath = path.join(OUT_DIR, name);
    let size;
    try { size = (await stat(filePath)).size; } catch { return send(res, 404, { error: "not_found" }); }
    const range = req.headers.range;
    const baseHead = { "Content-Type": "video/mp4", "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes" };
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
      res.writeHead(206, { ...baseHead, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      return createReadStream(filePath, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...baseHead, "Content-Length": size });
    return createReadStream(filePath).pipe(res);
  }

  send(res, 404, { error: "not_found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Hermes Studio Bridge → http://127.0.0.1:${PORT}  (Higgsfield-CLI: ${HF})`);
});
