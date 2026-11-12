import { legeDatenbankAn, lokaleDatenbank } from "../datenbank.mjs";
import {
  legeDatenVerzeichnisAn,
  messeHealthz,
  raeumeDatenVerzeichnisAuf,
  starteKind,
  stoppeKind,
  warteBereit,
} from "../hermes-kind.mjs";
import { starteAnbieterWeiche, starteDatenbankWeiche, starteMessweiche } from "../weiche.mjs";

const HTTP_OK = 200;
const warte = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function rot(schwelle, grund, extra = {}) {
  return { ergebnis: "rot", schwelle: schwelle.wiederBereitMs, gemessen: null, grund, ...extra };
}

export async function warteAufWiederkehr(kind, url, optionen) {
  const {
    schwelle,
    messe = messeHealthz,
    jetzt = () => performance.now(),
    pause = warte,
  } = optionen;
  const start = jetzt();
  while (jetzt() - start < schwelle.wiederBereitMs) {
    if (kind.prozess.exitCode !== null) return null;
    if ((await messe(url)).status === HTTP_OK) {
      const gemessen = Math.round(jetzt() - start);
      return gemessen <= schwelle.wiederBereitMs ? gemessen : null;
    }
    await pause(schwelle.messTaktMs);
  }
  return null;
}

async function baueAuf(kontext, url) {
  const datenbank = await legeDatenbankAn(url);
  kontext.aufraeumer.push(() => datenbank.loesche());
  const weiche = await starteDatenbankWeiche({
    zielHost: datenbank.host,
    zielPort: datenbank.port,
  });
  kontext.aufraeumer.push(() => weiche.beende());
  const anbieter = await starteAnbieterWeiche();
  kontext.aufraeumer.push(() => anbieter.beende());
  const datenVerzeichnis = legeDatenVerzeichnisAn();
  kontext.aufraeumer.push(() => raeumeDatenVerzeichnisAuf(datenVerzeichnis));
  const kind = await starteKind({
    weicheUrl: anbieter.url,
    datenVerzeichnis,
    datenbankUrl: datenbank.adresseUeber(weiche.port),
  });
  kontext.aufraeumer.push(() => stoppeKind(kind));
  return { kind, weiche };
}

export async function postgresNeustart(kontext, SCHWELLE) {
  if (!kontext.postgresUrl) return rot(SCHWELLE, "HERMES_TEST_POSTGRES_URL fehlt");
  const url = lokaleDatenbank(kontext.postgresUrl);
  if (!url) return rot(SCHWELLE, "Postgres ist nicht lokal (nur 127.0.0.1 oder localhost)");
  const { kind, weiche } = await baueAuf(kontext, url);
  if (!(await warteBereit(kind))) return rot(SCHWELLE, "Hermes wurde nicht bereit");
  if (weiche.zaehler.angenommen === 0)
    return rot(SCHWELLE, "Die Weiche sah keine Datenbankverbindung");
  const messweiche = await starteMessweiche({
    zielPort: kind.port,
    verzugMs: kontext.messVerzugMs,
  });
  kontext.aufraeumer.push(() => messweiche.beende());
  await weiche.stoere(SCHWELLE.abweisenMs);
  const beleg = { beleg: { ...weiche.zaehler, abweisenMs: SCHWELLE.abweisenMs } };
  if (weiche.zaehler.gekappt === 0)
    return rot(SCHWELLE, "Die Weiche kappte keine Verbindung", beleg);
  const gemessen = await warteAufWiederkehr(kind, messweiche.url, { schwelle: SCHWELLE });
  if (kind.prozess.exitCode !== null) return rot(SCHWELLE, "Hermes beendete sich", beleg);
  if (gemessen === null)
    return rot(SCHWELLE, "/healthz kam nach dem Neustart nicht zurueck", beleg);
  return {
    ergebnis: "gruen",
    schwelle: SCHWELLE.wiederBereitMs,
    gemessen,
    grund: "/healthz war nach dem Postgres-Neustart wieder 200",
    ...beleg,
  };
}
