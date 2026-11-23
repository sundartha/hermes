import { STAND } from "./vorspann-bruecke.js";

const ERLEDIGT = Object.freeze({ wiedergabe: STAND.WIEDERGABE, elBein: STAND.EL_BEIN });

export function setzeKlingelfrist({ call, store, config, jetzt }) {
  const { vorspannKlingelFristMs } = config.voice.elevenLabsOutbound;
  return store.setzeVorspannFrist({
    tenantId: call.tenantId,
    callId: call.id,
    frist: "klingel",
    faelligAt: new Date(jetzt() + vorspannKlingelFristMs).toISOString(),
  });
}

export function setzeVorspannFristen({ call, store, config, jetzt }) {
  const { vorspannWiedergabeFristMs, bridgeStartDeadlineMs } = config.voice.elevenLabsOutbound;
  const ab = jetzt();
  const setze = (frist, ms) =>
    store.setzeVorspannFrist({ tenantId: call.tenantId, callId: call.id, frist, faelligAt: new Date(ab + ms).toISOString() });
  return Promise.all([setze("wiedergabe", vorspannWiedergabeFristMs), setze("elBein", bridgeStartDeadlineMs)]);
}

export async function beiVorspannFrist({ frist, call, ladeZustand, melde, beineAuf }) {
  if (call.status !== "active") return;
  const zustand = await ladeZustand(call);
  const stand = zustand?.stand;
  if (!stand || stand.has(ERLEDIGT[frist]) || stand.has(STAND.ABGEBROCHEN) || stand.has(STAND.BRUECKE)) return;
  await melde[frist]();
  await beineAuf(zustand);
}
