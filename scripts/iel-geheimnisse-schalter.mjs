// IEL-B10: `allowlist-uebernehmen [--ausfuehren]` und `schalter --an|--aus [--ausfuehren]` (Spec E16).
//
// allowlist-uebernehmen: liest OWNER_SELF_CALL_TENANT_IDS am gepinnten Dienst, verlangt GENAU einen
// Eintrag (dieselbe Zerlegung wie am Server, csvEnv) und schreibt ihn als ELEVENLABS_INBOUND_TENANT_IDS.
// Ausgabe nur Anzahl und "gleich ja/nein" - nie eine Tenant-ID.
//
// schalter --an (Runde 5, K2, IM CODE erzwungen): im selben Lauf Inventar, beleg-init, stimmen-beleg und
// die Mindestlaengen der drei Geheimnisse in Render. Nur wenn ALLE vier GRUEN sind, folgt genau EIN PUT
// auf ELEVENLABS_INBOUND_ENABLED - und zwar als letzter Aufruf, allein. schalter --aus schreibt
// bedingungslos: der Rueckweg haengt an nichts.
import { csvEnv } from "../src/config.js";
import { inboundElAccessDefects } from "../src/elevenlabs/inbound-path-decision.js";
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
  if (argumente.aus) return schalteUm({ abh, wert: SCHALTER_WERT.AUS, ausfuehren: argumente.ausfuehren });
  const vorbedingungen = await vorbedingungenAn(abh);
  if (!vorbedingungen.gruen) {
    meldeBefunde(abh.waechter, vorbedingungen.teile.filter((teil) => !teil.gruen).map((teil) => `${teil.name} ROT`));
    abh.waechter.fehler(`SCHALTER ROT - ${RENDER_SCHLUESSEL.ENABLED} unveraendert, 0 Konfigurations-Schreibaufrufe.`);
    return EXIT.ROT;
  }
  return schalteUm({ abh, wert: SCHALTER_WERT.AN, ausfuehren: argumente.ausfuehren });
}

// Laeuft ALLE vier Vorbedingungen, auch nach einem ROT - der Lauf zeigt jeden offenen Punkt auf einmal.
export async function vorbedingungenAn(abh) {
  const teile = [
    { name: "Inventar", gruen: await inventarGruen(abh) },
    { name: "beleg-init", gruen: (await belegInit(abh)).gruen },
    { name: "stimmen-beleg", gruen: (await stimmenBeleg(abh)).gruen },
    { name: "Geheimnis-Laengen", gruen: await geheimnisLaengenGruen(abh) },
  ];
  return { gruen: teile.every((teil) => teil.gruen), teile };
}

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

async function schalteUm({ abh, wert, ausfuehren }) {
  const { waechter } = abh;
  if (!ausfuehren) {
    waechter.info(`TROCKENLAUF - wuerde ${RENDER_SCHLUESSEL.ENABLED}=${wert} setzen; nichts geschrieben.`);
    return EXIT.GRUEN;
  }
  const { status } = await schreibeDienstEnv(abh, { schluessel: RENDER_SCHLUESSEL.ENABLED, wert });
  const zurueck = await leseDienstEnv(abh, RENDER_SCHLUESSEL.ENABLED);
  const gesetzt = status === HTTP.OK && zurueck.wert === wert;
  meldeNachUrteil(waechter, {
    gruen: gesetzt,
    zeile: `SCHALTER ${urteilText(gesetzt)} - ${RENDER_SCHLUESSEL.ENABLED}=${wert} PUT Status ${status}, gesetzt: ${jaNein(gesetzt)} (wirkt erst nach Deploy)`,
  });
  return exitVon(gesetzt);
}
