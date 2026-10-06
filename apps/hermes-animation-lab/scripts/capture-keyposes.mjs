import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, "../../../artifacts/hermes-animation-review");
const BASE_URL = process.argv[2] ?? "http://127.0.0.1:4178";

const { chromium } = await import("playwright");

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(BASE_URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.hermesLab);

await page.click('[data-size="500"]');
await page.click('[data-bg="white"]');

const presets = await page.evaluate(() => window.hermesLab.presets);
const stageWrap = page.locator(".stage-wrap");

for (const preset of presets) {
  await page.evaluate((p) => window.hermesLab.setStagePreset(p), preset);
  const keyposes = await page.evaluate((p) => window.hermesLab.keyposes[p], preset);
  for (const kp of keyposes) {
    await page.evaluate((t) => window.hermesLab.seekStage(t), kp.time);
    await page.waitForTimeout(80);
    const file = resolve(OUT_DIR, `${preset}-${kp.label}.png`);
    await stageWrap.screenshot({ path: file });
    console.log("captured", file);
  }
}

await browser.close();
console.log("done ->", OUT_DIR);
