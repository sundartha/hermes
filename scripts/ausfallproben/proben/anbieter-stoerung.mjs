import {
  legeDatenVerzeichnisAn,
  messeHealthz,
  raeumeDatenVerzeichnisAuf,
  saeNummer,
  starteKind,
  stoppeKind,
  warteBereit,
} from "../hermes-kind.mjs";
import { starteAnbieterWeiche, starteMessweiche } from "../weiche.mjs";

const HTTP_OK = 200;
const warte = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function rot(schwelle, grund, beleg = {}) {
  return { ergebnis: "rot", schwelle: schwelle.healthzMs, gemessen: null, grund, ...beleg };
}

async function warteAufAnbieterAufruf(weiche, SCHWELLE) {
  const frist = Date.now() + SCHWELLE.anbieterAufrufFristMs;
  while (Date.now() < frist && weiche.gesehen.length === 0) await warte(SCHWELLE.messTaktMs);
  return weiche.gesehen.length > 0;
}

async function messeWaehrendDerStoerung(url, SCHWELLE) {
  const messungen = [];
  for (let i = 0; i < SCHWELLE.messungen; i += 1) {
    const messung = await messeHealthz(url);
    messungen.push(messung);
    if (messung.status !== HTTP_OK || messung.ms > SCHWELLE.healthzMs) break;
    await warte(SCHWELLE.messTaktMs);
  }
  return messungen;
}

async function startePhaseEins({ weiche, datenVerzeichnis }) {
  const kind = await starteKind({ weicheUrl: weiche.url, datenVerzeichnis });
  const bereit = await warteBereit(kind);
  await stoppeKind(kind);
  return bereit;
}

export async function anbieterStoerung(kontext, SCHWELLE) {
  const weiche = await starteAnbieterWeiche({ verzugMs: SCHWELLE.antwortVerzugMs });
  kontext.aufraeumer.push(() => weiche.beende());
  const datenVerzeichnis = legeDatenVerzeichnisAn();
  kontext.aufraeumer.push(() => raeumeDatenVerzeichnisAuf(datenVerzeichnis));
  if (!(await startePhaseEins({ weiche, datenVerzeichnis })))
    return rot(SCHWELLE, "Hermes wurde nicht bereit");
  if (!kontext.ohneSaat) saeNummer(datenVerzeichnis);
  const kind = await starteKind({ weicheUrl: weiche.url, datenVerzeichnis });
  kontext.aufraeumer.push(() => stoppeKind(kind));
  if (!(await warteBereit(kind))) return rot(SCHWELLE, "Hermes wurde nicht bereit");
  const messweiche = await starteMessweiche({
    zielPort: kind.port,
    verzugMs: kontext.messVerzugMs,
  });
  kontext.aufraeumer.push(() => messweiche.beende());
  if (!(await warteAufAnbieterAufruf(weiche, SCHWELLE)))
    return rot(SCHWELLE, "Die Weiche sah keinen Anbieter-Aufruf");
  const messungen = await messeWaehrendDerStoerung(messweiche.url, SCHWELLE);
  const beleg = {
    beleg: {
      anbieterAufrufe: weiche.gesehen.length,
      antwortVerzugMs: SCHWELLE.antwortVerzugMs,
      langsamsteAntwortMs: Math.max(
        0,
        ...weiche.gesehen.map((aufruf) => aufruf.beantwortetNachMs ?? 0),
      ),
      umgebung: kind.umgebung,
      schluessel: weiche.gesehen[0].schluessel,
    },
  };
  const gemessen = Math.max(...messungen.map((messung) => messung.ms));
  if (messungen.some((messung) => messung.status === null))
    return rot(SCHWELLE, "Keine Antwort von /healthz", beleg);
  if (messungen.some((messung) => messung.status !== HTTP_OK))
    return rot(SCHWELLE, "/healthz war nicht 200", beleg);
  if (gemessen > SCHWELLE.healthzMs)
    return { ...rot(SCHWELLE, "/healthz zu langsam", beleg), gemessen };
  return {
    ergebnis: "gruen",
    schwelle: SCHWELLE.healthzMs,
    gemessen,
    grund: "/healthz blieb waehrend der Anbieter-Stoerung 200",
    ...beleg,
  };
}
