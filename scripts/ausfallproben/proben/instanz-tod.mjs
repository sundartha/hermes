import { lokaleDatenbank } from "../datenbank.mjs";
import { messeHealthz, warteBereit } from "../hermes-kind.mjs";
import { starteMessweiche } from "../weiche.mjs";
import { baueAuf } from "./postgres-neustart.mjs";

const HTTP_OK = 200;
const INSTANZEN = 2;
const warte = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function rot(schwelle, grund, extra = {}) {
  return { ergebnis: "rot", schwelle: schwelle.healthzMs, gemessen: null, grund, ...extra };
}

const tot = (kind) => kind.prozess.exitCode !== null || kind.prozess.signalCode !== null;

export async function pruefeBetrieb(kind, url, optionen) {
  const {
    schwelle,
    messe = messeHealthz,
    jetzt = () => performance.now(),
    pause = warte,
  } = optionen;
  const start = jetzt();
  let messungen = 0;
  let laengste = 0;
  while (jetzt() - start < schwelle.haltenMs) {
    if (tot(kind)) return { grund: "Hermes beendete sich", messungen, laengste };
    const messung = await messe(url);
    messungen += 1;
    laengste = Math.max(laengste, messung.ms);
    if (messung.status !== HTTP_OK)
      return { grund: "/healthz antwortete nicht mit 200", messungen, laengste };
    if (messung.ms > schwelle.healthzMs)
      return { grund: "/healthz antwortete zu langsam", messungen, laengste };
    await pause(schwelle.messTaktMs);
  }
  return { grund: null, messungen, laengste };
}

export async function instanzTod(kontext, SCHWELLE) {
  if (!kontext.postgresUrl) return rot(SCHWELLE, "HERMES_TEST_POSTGRES_URL fehlt");
  const url = lokaleDatenbank(kontext.postgresUrl);
  if (!url) return rot(SCHWELLE, "Postgres ist nicht lokal (nur 127.0.0.1 oder localhost)");
  const { kinder } = await baueAuf(kontext, url, INSTANZEN);
  const [erstes, zweites] = kinder;
  if (kinder.length < INSTANZEN || !(await warteBereit(zweites)))
    return rot(SCHWELLE, "Zwei Instanzen wurden nicht bereit");
  const messweiche = await starteMessweiche({
    zielPort: zweites.port,
    verzugMs: kontext.messVerzugMs,
  });
  kontext.aufraeumer.push(() => messweiche.beende());
  erstes.prozess.kill("SIGKILL");
  await erstes.beendet;
  if (erstes.prozess.signalCode !== "SIGKILL")
    return rot(SCHWELLE, "Die erste Instanz endete nicht durch SIGKILL");
  const ergebnis = await pruefeBetrieb(zweites, messweiche.url, { schwelle: SCHWELLE });
  const beleg = {
    beleg: { signal: "SIGKILL", messungen: ergebnis.messungen, haltenMs: SCHWELLE.haltenMs },
  };
  if (ergebnis.grund) return rot(SCHWELLE, ergebnis.grund, beleg);
  return {
    ergebnis: "gruen",
    schwelle: SCHWELLE.healthzMs,
    gemessen: ergebnis.laengste,
    grund: "/healthz der zweiten Instanz blieb nach dem Tod der ersten 10 s lang 200",
    ...beleg,
  };
}
