// IEL-B10/IEX-A11: `allowlist-uebernehmen [--ausfuehren]`, `schalter --an|--aus [--ausfuehren]` (Spec E16) und
// `scope --registrierte-dids|--allowlist [--ausfuehren]` (Spec IEX-A E14).
//
// allowlist-uebernehmen: liest OWNER_SELF_CALL_TENANT_IDS am gepinnten Dienst, verlangt GENAU einen
// Eintrag (dieselbe Zerlegung wie am Server, csvEnv) und schreibt ihn als ELEVENLABS_INBOUND_TENANT_IDS.
// Ausgabe nur Anzahl und "gleich ja/nein" - nie eine Tenant-ID.
//
// schalter --an (Runde 5, K2, IM CODE erzwungen): im selben Lauf Inventar, beleg-init, stimmen-beleg und
// die Mindestlaengen der drei Geheimnisse in Render. Nur wenn ALLE vier GRUEN sind, folgt genau EIN PUT
// auf ELEVENLABS_INBOUND_ENABLED - und zwar als letzter Aufruf, allein. schalter --aus schreibt
// bedingungslos: der Rueckweg haengt an nichts.
//
// scope --registrierte-dids|--allowlist [--ausfuehren] (IEX-A11, Spec E14): EIN Einzel-PUT auf
// ELEVENLABS_INBOUND_SCOPE. --registrierte-dids nur, wenn Inventar und beleg-init im selben Lauf GRUEN
// sind; --allowlist schreibt bedingungslos (Rueckweg). Die Beleg-Zahlen je DID kennt das Werkzeug nicht
// (kein Store, keine Logs): die E11-Ergebniszeile bleibt Pflicht-Lesebeleg im Runbook (b4/b5).
import { csvEnv } from "../src/config.js";
import { inboundElAccessDefects } from "../src/elevenlabs/inbound-path-decision.js";
import { INBOUND_EL_SCOPE } from "../src/elevenlabs/inbound-scope.js";
import { holeRegistrierungen, inventarUrteil } from "../src/elevenlabs/nummern-registrierung.js";
import { EXIT, exitVon, jaNein, meldeBefunde, meldeNachUrteil, urteilText } from "./iel-geheimnisse-ausgabe.mjs";
import { belegInit, stimmenBeleg } from "./iel-geheimnisse-belege.mjs";
import {
  HTTP,
  RENDER_GEHEIMNISSE,
  RENDER_SCHLUESSEL,
  leseDienstEnv,
  schreibeDienstEnv,
} from "./iel-geheimnisse-render.mjs";

const SCHALTER_WERT = Object.freeze({ AN: "true", AUS: "false" });
// EIN Ablauf fuer beide Konfigurationsschalter (G5): Ausgabe-Kopf + Render-Schluessel.
const SCHALTER_ZIEL = Object.freeze({ kopf: "SCHALTER", schluessel: RENDER_SCHLUESSEL.ENABLED });
const SCOPE_ZIEL = Object.freeze({ kopf: "SCOPE", schluessel: RENDER_SCHLUESSEL.SCOPE });
const ERWARTETE_TENANTS = 1;

// ---- allowlist-uebernehmen ---------------------------------------------------------------------

export async function laufeAllowlistUebernehmen({ argumente, abh }) {
  const { waechter } = abh;
  const quelle = await leseDienstEnv(abh, RENDER_SCHLUESSEL.OWNER_TENANT_IDS);
  const eintraege = csvEnv(quelle.wert);
  eintraege.forEach((eintrag) => waechter.verbiete(eintrag));
  const eindeutig = quelle.status === HTTP.OK && eintraege.length === ERWARTETE_TENANTS;
  meldeNachUrteil(waechter, {
    gruen: eindeutig,
    zeile: `ALLOWLIST ${RENDER_SCHLUESSEL.OWNER_TENANT_IDS}: Status ${quelle.status}, Anzahl ${eintraege.length} (erwartet ${ERWARTETE_TENANTS})`,
  });
  if (!eindeutig) {
    waechter.fehler("ALLOWLIST ROT - nichts geschrieben.");
    return EXIT.ROT;
  }
  if (!argumente.ausfuehren) {
    waechter.info(`TROCKENLAUF - wuerde den Eintrag als ${RENDER_SCHLUESSEL.TENANT_IDS} schreiben; nichts geschrieben.`);
    return EXIT.GRUEN;
  }
  return await uebernimmTenant({ abh, tenantId: eintraege[0] });
}

// SCHREIBZUGRIFF auf ELEVENLABS_INBOUND_TENANT_IDS, danach Lesebeleg.
async function uebernimmTenant({ abh, tenantId }) {
  const { status } = await schreibeDienstEnv(abh, { schluessel: RENDER_SCHLUESSEL.TENANT_IDS, wert: tenantId });
  const zurueck = await leseDienstEnv(abh, RENDER_SCHLUESSEL.TENANT_IDS);
  const gleich = status === HTTP.OK && zurueck.status === HTTP.OK && csvEnv(zurueck.wert).join() === tenantId;
  meldeNachUrteil(abh.waechter, {
    gruen: gleich,
    zeile: `ALLOWLIST ${urteilText(gleich)} - PUT Status ${status}, ${RENDER_SCHLUESSEL.TENANT_IDS} Anzahl ${csvEnv(zurueck.wert).length}, gleich ${RENDER_SCHLUESSEL.OWNER_TENANT_IDS}: ${jaNein(gleich)}`,
  });
  return exitVon(gleich);
}

// ---- schalter ----------------------------------------------------------------------------------

export async function laufeSchalter({ argumente, abh }) {
  const umschaltung = { abh, ziel: SCHALTER_ZIEL, ausfuehren: argumente.ausfuehren };
  if (argumente.aus) return schalteUm({ ...umschaltung, wert: SCHALTER_WERT.AUS });
  return schalteNachVorbedingungen({ ...umschaltung, wert: SCHALTER_WERT.AN, vorbedingungen: VORBEDINGUNGEN_AN });
}

// ---- scope -------------------------------------------------------------------------------------

export async function laufeScope({ argumente, abh }) {
  const umschaltung = { abh, ziel: SCOPE_ZIEL, ausfuehren: argumente.ausfuehren };
  if (argumente.allowlist) return schalteUm({ ...umschaltung, wert: INBOUND_EL_SCOPE.ALLOWLIST });
  return schalteNachVorbedingungen({
    ...umschaltung,
    wert: INBOUND_EL_SCOPE.REGISTRIERTE_DIDS,
    vorbedingungen: VORBEDINGUNGEN_REGISTRIERTE_DIDS,
  });
}

// ---- gemeinsamer Ablauf ------------------------------------------------------------------------

// Hinweg: nur nach GRUENEN Vorbedingungen, dann genau EIN PUT als letzter Konfigurations-Aufruf.
async function schalteNachVorbedingungen({ vorbedingungen, ...umschaltung }) {
  const { abh, ziel } = umschaltung;
  const ergebnis = await pruefeVorbedingungen(abh, vorbedingungen);
  if (!ergebnis.gruen) {
    meldeBefunde(abh.waechter, ergebnis.teile.filter((teil) => !teil.gruen).map((teil) => `${teil.name} ROT`));
    abh.waechter.fehler(`${ziel.kopf} ROT - ${ziel.schluessel} unveraendert, 0 Konfigurations-Schreibaufrufe.`);
    return EXIT.ROT;
  }
  return schalteUm(umschaltung);
}

// Laeuft ALLE Vorbedingungen seriell, auch nach einem ROT - der Lauf zeigt jeden offenen Punkt auf einmal.
async function pruefeVorbedingungen(abh, vorbedingungen) {
  const teile = [];
  for (const { name, pruefe } of vorbedingungen) teile.push({ name, gruen: await pruefe(abh) });
  return { gruen: teile.every((teil) => teil.gruen), teile };
}

async function schalteUm({ abh, ziel, wert, ausfuehren }) {
  const { waechter } = abh;
  if (!ausfuehren) {
    waechter.info(`TROCKENLAUF - wuerde ${ziel.schluessel}=${wert} setzen; nichts geschrieben.`);
    return EXIT.GRUEN;
  }
  const { status } = await schreibeDienstEnv(abh, { schluessel: ziel.schluessel, wert });
  const zurueck = await leseDienstEnv(abh, ziel.schluessel);
  const gesetzt = status === HTTP.OK && zurueck.wert === wert;
  meldeNachUrteil(waechter, {
    gruen: gesetzt,
    zeile: `${ziel.kopf} ${urteilText(gesetzt)} - ${ziel.schluessel}=${wert} PUT Status ${status}, gesetzt: ${jaNein(gesetzt)} (wirkt erst nach Deploy)`,
  });
  return exitVon(gesetzt);
}

// ---- Vorbedingungen ----------------------------------------------------------------------------

async function inventarGruen(abh) {
  const urteil = inventarUrteil(await holeRegistrierungen({ fetchImpl: abh.fetchImpl, account: abh.elKonto }));
  meldeNachUrteil(abh.waechter, {
    gruen: urteil.gruen,
    zeile: `INVENTAR ${urteilText(urteil.gruen)} - ${urteil.offen.length} offen, ${urteil.mitZugang.length} mit Zugangsdaten`,
  });
  return urteil.gruen;
}

// Die Werte werden gelesen, sofort verboten und nur ueber inboundElAccessDefects (eine Quelle der
// Mindestlaengen) beurteilt; ausgegeben werden Schluesselnamen und Mangel-Art.
async function geheimnisLaengenGruen(abh) {
  const werte = {};
  for (const { schluessel, feld } of RENDER_GEHEIMNISSE) {
    const { wert } = await leseDienstEnv(abh, schluessel);
    abh.waechter.verbiete(wert);
    werte[feld] = wert;
  }
  const maengel = inboundElAccessDefects(werte);
  meldeNachUrteil(abh.waechter, {
    gruen: maengel.length === 0,
    zeile: `GEHEIMNIS-LAENGEN ${urteilText(maengel.length === 0)}${maengel.map((mangel) => ` - ${mangel.envKey}: ${mangel.mangel}`).join("")}`,
  });
  return maengel.length === 0;
}

// Jede Vorbedingung meldet ihr eigenes Urteil und liefert gruen; Reihenfolge = Reihenfolge der Liste.
const VORBEDINGUNG = Object.freeze({
  INVENTAR: Object.freeze({ name: "Inventar", pruefe: inventarGruen }),
  BELEG_INIT: Object.freeze({ name: "beleg-init", pruefe: async (abh) => (await belegInit(abh)).gruen }),
  STIMMEN: Object.freeze({ name: "stimmen-beleg", pruefe: async (abh) => (await stimmenBeleg(abh)).gruen }),
  LAENGEN: Object.freeze({ name: "Geheimnis-Laengen", pruefe: geheimnisLaengenGruen }),
});
const VORBEDINGUNGEN_AN = Object.freeze([VORBEDINGUNG.INVENTAR, VORBEDINGUNG.BELEG_INIT, VORBEDINGUNG.STIMMEN, VORBEDINGUNG.LAENGEN]);
// Spec E14: der Scope-Flip braucht Inventar und beleg-init; Stimmen und Laengen belegt bereits schalter --an.
const VORBEDINGUNGEN_REGISTRIERTE_DIDS = Object.freeze([VORBEDINGUNG.INVENTAR, VORBEDINGUNG.BELEG_INIT]);
