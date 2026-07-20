import { Assets, type Texture } from "pixi.js";
import "./lab/lab.css";
import type { HermesStatus, PresetId } from "./types.js";
import { WingApp } from "./wing/WingApp.js";
import { PRESET_KEYPOSES } from "./wing/presets.js";
import { LabControls } from "./lab/controls.js";

// Oeffentliche Status-API (vorbereitet; noch nicht an MCP verdrahtet) + ein
// Test-Hook fuer die deterministische Keypose-Erfassung.
declare global {
  interface Window {
    setHermesStatus: (status: HermesStatus) => void;
    hermesLab: {
      ready: Promise<void>;
      presets: PresetId[];
      keyposes: typeof PRESET_KEYPOSES;
      setStagePreset: (preset: PresetId) => void;
      seekStage: (time: number) => void;
    };
  }
}

const WING_URL = `${import.meta.env.BASE_URL}hermes-wing.png`;
const TILE_CANVAS = 180;
const TILE_DISPLAY = 150;
const STAGE_CANVAS = 540;
const DEFAULT_STAGE_SIZE = 240;
const PRESET_IDS: PresetId[] = ["classic", "rapid", "premium", "olympian"];

// Default: weisser Fluegel wie zuvor (Gold aus). Der Gold-Look bleibt als
// optionaler Regler erhalten, ist aber standardmaessig deaktiviert.
const DEFAULT_GOLD = 0;
const DEFAULT_SHIMMER = 0.7;

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

function $(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Element fehlt: ${selector}`);
  return el;
}

function activate(group: HTMLElement, match: (btn: HTMLElement) => boolean): void {
  for (const btn of group.querySelectorAll<HTMLElement>("button")) {
    btn.classList.toggle("is-active", match(btn));
  }
}

async function boot(): Promise<void> {
  if (prefersReducedMotion) $("#reduced-motion-note").hidden = false;
  const animate = !prefersReducedMotion;

  const texture: Texture = await Assets.load(WING_URL);
  const allApps: WingApp[] = [];

  // --- Drei Preset-Kacheln (je eine eigenstaendige Einzel-Instanz) ----------
  for (const preset of PRESET_IDS) {
    const host = document.querySelector<HTMLElement>(`[data-role="tile-${preset}"]`)!;
    const tile = await WingApp.create({
      host,
      texture,
      canvasSize: TILE_CANVAS,
      displaySize: TILE_DISPLAY,
      preset,
      animate,
    });
    tile.setGold(DEFAULT_GOLD);
    tile.setShimmer(DEFAULT_SHIMMER);
    tile.setAmbient(animate);
    allApps.push(tile);
  }

  // --- Stage ----------------------------------------------------------------
  const stage = await WingApp.create({
    host: $("#stage-host"),
    texture,
    canvasSize: STAGE_CANVAS,
    displaySize: DEFAULT_STAGE_SIZE,
    preset: "olympian",
    animate,
  });
  stage.setAmbient(animate); // Gold/Lichtpuls setzen die Regler-Defaults.
  allApps.push(stage);

  let activePreset: PresetId = "olympian";
  const readout = $("#json-readout");
  const controls = new LabControls($("#sliders"), stage, () => updateReadout());

  function updateReadout(): void {
    const params = { preset: activePreset, status: stage.currentStatus, ...controls.snapshot() };
    readout.textContent = JSON.stringify(params, null, 2);
  }

  // Status-Buttons (steuern die Stage)
  const statusGroup = $("#status-group");
  function applyStatus(status: HermesStatus): void {
    stage.setStatus(status);
    activate(statusGroup, (b) => b.dataset.status === status);
    updateReadout();
  }
  statusGroup.addEventListener("click", (e) => {
    const status = (e.target as HTMLElement).closest("button")?.dataset.status as
      | HermesStatus
      | undefined;
    if (status) applyStatus(status);
  });

  // Transport
  $("#transport-group").addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest("button")?.dataset.action;
    if (action === "play") stage.play();
    else if (action === "pause") stage.pause();
    else if (action === "restart") stage.restart();
  });

  // Tempo (Zeitlupe)
  const rateGroup = $("#rate-group");
  rateGroup.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    const rate = btn?.dataset.rate;
    if (!rate) return;
    stage.setRate(Number(rate));
    activate(rateGroup, (b) => b === btn);
  });

  // Hintergrund
  const bgGroup = $("#bg-group");
  const stageWrap = $(".stage-wrap");
  bgGroup.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    const bg = btn?.dataset.bg;
    if (!bg) return;
    stageWrap.dataset.bg = bg;
    activate(bgGroup, (b) => b === btn);
  });

  // Groesse
  const sizeGroup = $("#size-group");
  sizeGroup.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    const size = btn?.dataset.size;
    if (!size) return;
    stage.setDisplaySize(Number(size));
    activate(sizeGroup, (b) => b === btn);
  });

  // Ambient-Schweben (Default an; bleibt bei reduced-motion ohne Wirkung,
  // weil die Stage dann ohnehin statisch bootet)
  const ambientToggle = $("#ambient") as HTMLInputElement;
  stage.setAmbient(animate && ambientToggle.checked);
  ambientToggle.addEventListener("change", () => {
    stage.setAmbient(ambientToggle.checked);
  });

  // Root-Marker
  ($("#root-marker") as HTMLInputElement).addEventListener("change", (e) => {
    stage.setRootMarkerVisible((e.target as HTMLInputElement).checked);
  });

  // Preset in die Stage laden
  const presetLabel = $("#active-preset-label");
  $("#preset-gallery").addEventListener("click", (e) => {
    const preset = (e.target as HTMLElement).closest("button")?.dataset.load as
      | PresetId
      | undefined;
    if (!preset) return;
    activePreset = preset;
    stage.setPreset(preset);
    presetLabel.textContent = `(${preset})`;
    updateReadout();
  });

  // Reset + JSON kopieren
  $("#btn-reset").addEventListener("click", () => controls.reset());
  const feedback = $("#copy-feedback");
  $("#btn-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(readout.textContent ?? "");
      feedback.textContent = "kopiert ✓";
    } catch {
      feedback.textContent = "Kopieren fehlgeschlagen";
    }
    window.setTimeout(() => (feedback.textContent = ""), 1500);
  });

  // Globale Tab-Sichtbarkeit -> alle Instanzen
  document.addEventListener("visibilitychange", () => {
    const visible = document.visibilityState === "visible";
    for (const app of allApps) app.setPageVisible(visible);
  });

  updateReadout();

  // Oeffentliche API + Test-Hook
  window.setHermesStatus = applyStatus;
  window.hermesLab = {
    ready: Promise.resolve(),
    presets: PRESET_IDS,
    keyposes: PRESET_KEYPOSES,
    setStagePreset: (preset) => {
      activePreset = preset;
      stage.setPreset(preset);
      presetLabel.textContent = `(${preset})`;
      updateReadout();
    },
    seekStage: (time) => stage.seek(time),
  };
}

boot().catch((err) => {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<pre class="boot-error">Animation Lab konnte nicht starten:\n${String(err)}</pre>`,
  );
  console.error(err);
});
