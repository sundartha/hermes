import { appendFileSync } from "node:fs";
import { basename } from "node:path";
const echt = globalThis.fetch;
const ziel = process.env.MESS_DATEI;
globalThis.fetch = async (url, opts) => {
  const u = String(url instanceof Request ? url.url : url);
  if (!u.includes("/v1/messages") || !u.startsWith("http://127.0.0.1")) return echt(url, opts);
  const t0 = performance.now();
  let ergebnis = "ok";
  try { return await echt(url, opts); }
  catch (e) { ergebnis = e?.name ?? "fehler"; throw e; }
  finally { appendFileSync(ziel, `${basename(process.argv.at(-1) ?? "")}\t${(performance.now() - t0).toFixed(1)}\t${ergebnis}\n`); }
};
