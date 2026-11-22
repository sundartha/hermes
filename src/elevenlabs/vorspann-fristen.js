import { VORSPANN_WAHL_GRUND } from "./vorspann-pruefung.js";
import { NICHT_ABGESPIELT_URSACHE, meldeVorspannRueckfall } from "./vorspann-erzeugen.js";
import { STAND } from "./vorspann-bruecke.js";
import { NICHT_ERREICHT_FRIST_MS } from "./nicht-erreicht-frist.ts";

export const armiereKlingelfrist = ({ setTimer, beiFrist }) => setTimer(beiFrist, NICHT_ERREICHT_FRIST_MS);

export function armiereVorspannFristen({
  call,
  ladeStand,
  store,
  config,
  beineAuf,
  vermerkeElFrist,
  vermerkeNichtAbgespielt,
  setTimer,
}) {
  const { vorspannWiedergabeFristMs, bridgeStartDeadlineMs } = config.voice.elevenLabsOutbound;
  async function beiFrist(erledigt, melde) {
    if ((await store.leseCall(call.id)).status !== "active") return;
    const stand = await ladeStand();
    if (!stand || stand.has(erledigt) || stand.has(STAND.ABGEBROCHEN) || stand.has(STAND.BRUECKE)) return;
    await melde();
    await beineAuf();
  }
  const nichtAbgespielt = () => {
    meldeVorspannRueckfall({ callId: call.id, grund: VORSPANN_WAHL_GRUND.NICHT_ABGESPIELT, ursache: NICHT_ABGESPIELT_URSACHE.KEIN_ENDE_EREIGNIS });
    vermerkeNichtAbgespielt();
  };
  setTimer(() => beiFrist(STAND.WIEDERGABE, nichtAbgespielt), vorspannWiedergabeFristMs);
  setTimer(() => beiFrist(STAND.EL_BEIN, vermerkeElFrist), bridgeStartDeadlineMs);
}
