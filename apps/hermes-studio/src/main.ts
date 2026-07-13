import "./studio.css";
import { BRAND } from "./brand/bibel.js";
import { FORMATS, getFormat, type FormatInput, type StudioFormat } from "./generate/formats.js";
import { buildJob, toCliCommand, submitJob, checkStatus } from "./generate/higgsfield.js";
import { buildRenderPlan, planToJson } from "./compose/renderPlan.js";
import { StudioStage } from "./overlay/StudioStage.js";

function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`Element fehlt: ${sel}`);
  return el;
}

async function copy(text: string, target: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    target.textContent = "kopiert ✓";
  } catch {
    target.textContent = "Kopieren fehlgeschlagen";
  }
  window.setTimeout(() => (target.textContent = ""), 1500);
}

async function boot(): Promise<void> {
  let activeFormat: StudioFormat = FORMATS[0];

  const reelFrame = $("#reel-frame");
  reelFrame.style.backgroundColor = BRAND.deepBlue;

  const stage = await StudioStage.create({ host: $("#wing-overlay"), size: 360 });

  const input = (): FormatInput => ({
    hook: ($("#in-hook") as HTMLInputElement).value || "Dein Agent ruft für dich an.",
    message: ($("#in-message") as HTMLInputElement).value || undefined,
    cta: ($("#in-cta") as HTMLInputElement).value || undefined,
  });

  const planReadout = $("#plan-readout");
  const statusLabel = $("#status-label");
  const video = $("#clip-video") as HTMLVideoElement;
  const clipInput = $("#in-clip") as HTMLInputElement;

  function updatePlan(): void {
    const clip = clipInput.value || undefined;
    const plan = buildRenderPlan(activeFormat, input(), { clipUrl: clip });
    planReadout.textContent = planToJson(plan);
  }

  function loadClip(url: string): void {
    if (url) {
      video.src = url;
      video.play().catch(() => void 0);
    } else {
      video.removeAttribute("src");
    }
    updatePlan();
  }

  // --- Higgsfield-Login-Status (Bridge) ------------------------------------
  const statusBar = $("#status-bar");
  async function refreshStatus(): Promise<boolean> {
    const s = await checkStatus();
    if (!s.reachable) {
      statusBar.dataset.state = "off";
      statusBar.textContent = "Bridge-Server nicht erreichbar — starte das Studio mit „npm start“.";
      return false;
    }
    if (!s.authed) {
      statusBar.dataset.state = "warn";
      statusBar.textContent = "Higgsfield nicht eingeloggt — im Terminal: higgsfield auth login";
      return false;
    }
    if (s.needsWorkspace) {
      statusBar.dataset.state = "warn";
      statusBar.textContent = "Eingeloggt, aber kein Workspace gewählt — higgsfield workspace list / set <id>";
      return false;
    }
    statusBar.dataset.state = "ok";
    statusBar.textContent = "Higgsfield verbunden ✓ — bereit zum Generieren.";
    return true;
  }

  // --- Format-Buttons -------------------------------------------------------
  const formatGroup = $("#format-group");
  const formatDesc = $("#format-desc");
  for (const f of FORMATS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = f.label;
    btn.dataset.id = f.id;
    if (f.id === activeFormat.id) btn.classList.add("is-active");
    formatGroup.appendChild(btn);
  }
  function selectFormat(id: StudioFormat["id"]): void {
    activeFormat = getFormat(id);
    formatDesc.textContent = activeFormat.description;
    for (const b of formatGroup.querySelectorAll("button"))
      b.classList.toggle("is-active", (b as HTMLElement).dataset.id === id);
    updatePlan();
  }
  formatGroup.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest("button")?.dataset.id as StudioFormat["id"] | undefined;
    if (id) selectFormat(id);
  });
  formatDesc.textContent = activeFormat.description;

  // --- Eingaben -------------------------------------------------------------
  for (const id of ["#in-hook", "#in-message", "#in-cta"])
    $(id).addEventListener("input", updatePlan);
  clipInput.addEventListener("input", () => loadClip(clipInput.value.trim()));

  // --- LIVE generieren ------------------------------------------------------
  const genFeedback = $("#gen-feedback");
  const genBtn = $("#btn-generate") as HTMLButtonElement;
  genBtn.addEventListener("click", async () => {
    const ready = await refreshStatus();
    if (!ready) {
      genFeedback.textContent = "Erst Higgsfield verbinden (siehe Statuszeile oben).";
      return;
    }
    genBtn.disabled = true;
    genFeedback.textContent = "Generiere … das dauert 1–5 Min.";
    stage.setStatus("working");
    try {
      const { clipUrl } = await submitJob(buildJob(activeFormat, input()));
      clipInput.value = clipUrl;
      loadClip(clipUrl);
      stage.setStatus("success");
      genFeedback.textContent = "Clip fertig ✓";
    } catch (err) {
      stage.setStatus("error");
      genFeedback.textContent = `Fehler: ${String((err as Error).message).slice(0, 160)}`;
    } finally {
      genBtn.disabled = false;
    }
  });

  // --- Story / Status-Buttons ----------------------------------------------
  const caption = $("#caption");
  let captionTimers: number[] = [];
  function setStatus(s: "idle" | "connecting" | "working" | "success" | "error"): void {
    stage.setStatus(s);
    statusLabel.textContent = `(${s})`;
  }
  function playArc(): void {
    for (const t of captionTimers) window.clearTimeout(t);
    captionTimers = [];
    const plan = buildRenderPlan(activeFormat, input());
    stage.runArc(plan.statusArc);
    for (const b of plan.statusArc)
      captionTimers.push(window.setTimeout(() => (statusLabel.textContent = `(${b.status})`), b.at * 1000));
    for (const c of plan.captions) {
      captionTimers.push(window.setTimeout(() => (caption.textContent = c.text), c.at * 1000));
      captionTimers.push(window.setTimeout(() => (caption.textContent = ""), c.until * 1000));
    }
  }
  $("#arc-group").addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest("button")?.dataset.act;
    if (!act) return;
    if (act === "play-arc") playArc();
    else setStatus(act as "idle");
  });

  // --- Kopier-Buttons -------------------------------------------------------
  $("#btn-cli").addEventListener("click", () =>
    copy(toCliCommand(buildJob(activeFormat, input())), $("#cli-feedback")),
  );
  $("#btn-plan").addEventListener("click", () =>
    copy(planReadout.textContent ?? "", $("#plan-feedback")),
  );

  // --- Fertiges Reel rendern (Phase 3: Flügel + Untertitel + Schnitt) -------
  const renderFeedback = $("#render-feedback");
  const renderBtn = $("#btn-render") as HTMLButtonElement;
  const dlLink = $("#reel-download") as HTMLAnchorElement;
  renderBtn.addEventListener("click", async () => {
    const clip = clipInput.value.trim();
    if (!clip) {
      renderFeedback.textContent = "Erst einen Clip erzeugen (oder Clip-URL eintragen).";
      return;
    }
    renderBtn.disabled = true;
    dlLink.hidden = true;
    renderFeedback.textContent = "Rendere fertiges Reel … ~1–3 Min.";
    stage.setStatus("working");
    try {
      const plan = buildRenderPlan(activeFormat, input(), { clipUrl: clip });
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: planToJson(plan),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(e.detail || e.error || `Render-Fehler (${res.status})`);
      }
      const { mp4Url } = (await res.json()) as { mp4Url: string };
      loadClip(mp4Url); // fertiges Reel in die Vorschau
      dlLink.href = mp4Url;
      dlLink.hidden = false;
      stage.setStatus("success");
      renderFeedback.textContent = "Fertiges Reel ✓";
    } catch (err) {
      stage.setStatus("error");
      renderFeedback.textContent = `Fehler: ${String((err as Error).message).slice(0, 200)}`;
    } finally {
      renderBtn.disabled = false;
    }
  });

  updatePlan();
  void refreshStatus();
}

boot().catch((err) => {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<pre class="boot-error">Studio konnte nicht starten:\n${String(err)}</pre>`,
  );
  console.error(err);
});
