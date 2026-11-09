import { defaultSetTimer } from "../utils/timer.js";
import { VORSPANN_WAHL_GRUND } from "./vorspann-pruefung.js";
import { meldeVorspannRueckfall } from "./vorspann-erzeugen.js";
import { STAND } from "./vorspann-bruecke.js";

export function armiereVorspannFristen({
  call,
  zustand,
  store,
  config,
  beineAuf,
  vermerkeElFrist,
}) {
  const { vorspannWiedergabeFristMs, bridgeStartDeadlineMs } = config.voice.elevenLabsOutbound;
  const { stand } = zustand;
  async function beiFrist(erledigt, melde) {
    if (store.getCall(call.id).status !== "active") return;
    if (stand.has(erledigt) || stand.has(STAND.ABGEBROCHEN) || stand.has(STAND.BRUECKE)) return;
    melde();
    await beineAuf();
  }
  const nichtAbgespielt = () =>
    meldeVorspannRueckfall({ callId: call.id, grund: VORSPANN_WAHL_GRUND.NICHT_ABGESPIELT });
  defaultSetTimer(() => beiFrist(STAND.WIEDERGABE, nichtAbgespielt), vorspannWiedergabeFristMs);
  defaultSetTimer(() => beiFrist(STAND.EL_BEIN, vermerkeElFrist), bridgeStartDeadlineMs);
}
