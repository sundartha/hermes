// IEL-B10/IEX-A11: Unterbefehl `setzen --nummer=<E.164>... --registrierung=<phnum_...>... [--ausfuehren]`
// (Spec IEL E16 a-f, IEX-A E14). Beide Auswahlwege duerfen gemischt werden.
//
// ABLAUF, bindend:
//   1. Vorab-Riegel (nur GET): Inventar hart; jede --nummer hat GENAU eine Registrierung, jede
//      --registrierung steht im Inventar; dieselbe Registrierung ueber beide Wege zaehlt einmal; jedes
//      Ziel ist ein zulaessiges Schreibziel (EINE Definition mit der Sweep-Reparatur E16:
//      inbound-trunk-beleg.js#reparaturHindernis); keine Registrierung mit Inbound-Zugangsdaten steht
//      ausserhalb der Ziele (halbe Rotation liesse sie mit altem Zugang zurueck); Workspace-Secret
//      eindeutig. KEIN Render-Aufruf. Die Nummer einer Registrierung bleibt im Speicher, ausgegeben
//      werden nur Kennung und Endung.
//   2. Erzeugen im Speicher (CSPRNG), jeder Wert sofort in die Verbotsmenge des Ausgabe-Waechters,
//      Laengen gegen die Mindestlaengen aus inbound-path-decision.js (eine Quelle mit Praedikat,
//      Boot-Riegel und Init-Route).
//   3. Trockenlauf (Default): nur Ziele und Reihenfolge, 0 schreibende Aufrufe.
//   4. Verteilen mit --ausfuehren: Render-Env (wirkt erst nach Deploy, deshalb zuerst) ->
//      Workspace-Secret (aktualisieren, sonst anlegen) -> inbound_trunk_config der Registrierungen.
//      Abbruch beim ERSTEN Fehlschlag; die Ziel-Tabelle zeigt gesetzt ja/nein je Ziel. Rueckweg ist
//      ein erneuter Lauf mit frischen Werten - die Werte eines abgebrochenen Laufs sind nach
//      Prozessende unwiederbringlich, gewollt.
//   5. Lesebelege (nur GET), ALS LETZTES das Inventar. Danach folgt kein Schreibaufruf mehr.
//
// Kein Wert erreicht eine Ausgabe: Anbieter-Fehlerkoerper werden nie gelesen (nur err.providerStatus),
// und jede Zeile laeuft durch den Ausgabe-Waechter.
import { isDeepStrictEqual } from "node:util";

import {
  createConvaiSecret,
  fetchConvaiSettings,
  fetchPhoneNumber,
  listConvaiSecrets,
  patchPhoneNumber,
  updateConvaiSecret,
} from "../src/elevenlabs/convai.js";
import { e164Endung, inboundElAccessDefects } from "../src/elevenlabs/inbound-path-decision.js";
import { TRUNK_BELEG, reparaturHindernis } from "../src/elevenlabs/inbound-trunk-beleg.js";
import {
  holeRegistrierungen,
  inboundTrunkKoerper,
  inventarUrteil,
  registrierungenMitNummer,
} from "../src/elevenlabs/nummern-registrierung.js";
import { INIT_TOKEN_HEADER } from "../src/routes/webhooks-elevenlabs-init.js";
import {
  EXIT,
  exitVon,
  jaNein,
  meldeBefunde,
  meldeNachUrteil,
  meldeZielTabelle,
  urteilText,
} from "./iel-geheimnisse-ausgabe.mjs";
import { HTTP, RENDER_GEHEIMNISSE, leseDienstEnv, schreibeDienstEnv } from "./iel-geheimnisse-render.mjs";
import { INIT_WEBHOOK_SETTINGS_SCHLUESSEL } from "./push-elevenlabs.mjs";

export const GEHEIMNIS_ZUFALLS_BYTES = 32;
export const SIP_USER_ZUFALLS_BYTES = 16;
export const WORKSPACE_SECRET_NAME = "hermes_init_webhook_token";
// Doku: page_size hoechstens 100. Eine Liste mit next_cursor ist kein eindeutiger Beleg.
const SECRET_SEITE = 100;
const HEX = "hex";
const OHNE_WERT = "-";

export async function laufeSetzen({ argumente, abh }) {
  const { waechter } = abh;
  const auswahl = { nummern: argumente.nummern, kennungen: argumente.registrierungsKennungen };
  const vorab = await vorabRiegel({ abh, auswahl });
  const erzeugt = erzeugeGeheimnisse(abh);
  const befunde = [...vorab.befunde, ...erzeugt.befunde];
  if (befunde.length > 0) {
    meldeBefunde(waechter, befunde);
    waechter.fehler("SETZEN ROT - Vorab-Riegel, 0 schreibende Aufrufe, NICHTS geschrieben.");
    return EXIT.ROT;
  }
  const schritte = verteilSchritte({ abh, geheimnisse: erzeugt.geheimnisse, vorher: vorab.vorher });
  schritte.forEach((schritt, index) => waechter.info(`REIHENFOLGE ${index + 1}: ${schritt.ziel}`));
  if (!argumente.ausfuehren) {
    waechter.info("TROCKENLAUF - nichts geschrieben; die erzeugten Werte verfallen mit dem Prozess.");
    return EXIT.GRUEN;
  }
  return await verteileUndBelege({ abh, schritte, geheimnisse: erzeugt.geheimnisse, vorher: vorab.vorher });
}

async function verteileUndBelege({ abh, schritte, geheimnisse, vorher }) {
  const { waechter } = abh;
  const verteilt = await fuehreSchritteAus(schritte);
  meldeZielTabelle(waechter, verteilt.ziele);
  if (!verteilt.ok) {
    waechter.fehler("SETZEN ROT - Abbruch beim ersten Fehlschlag. Rueckweg: erneuter Lauf (frische Werte, alle Ziele).");
    return EXIT.ROT;
  }
  const secretId = verteilt.ziele.find((ziel) => ziel.secretId)?.secretId ?? null;
  waechter.info(`secret_id ${secretId ?? OHNE_WERT}`);
  const gruen = await lesebelege({ abh, geheimnisse, secretId, vorher });
  meldeNachUrteil(waechter, { gruen, zeile: `SETZEN ${urteilText(gruen)} - Lesebelege abgeschlossen.` });
  return exitVon(gruen);
}

// ---- 1. Vorab-Riegel (nur GET) ------------------------------------------------------------

// Liefert {befunde[], vorher:{registrierungen, ziele: Map(phone_number_id -> Registrierung), secret|null}}.
export async function vorabRiegel({ abh, auswahl }) {
  const registrierungen = await holeRegistrierungen({ fetchImpl: abh.fetchImpl, account: abh.elKonto });
  const inventar = inventarUrteil(registrierungen);
  const { ziele, befunde: zielBefunde } = ordneZieleZu({ registrierungen, auswahl, agentId: abh.elKonto.agentId });
  const secretSuche = await sucheWorkspaceSecret(abh);
  const befunde = [
    ...inventar.offen.map((registrierung) => `INVENTAR ROT - Registrierung ${registrierung.phone_number_id} traegt einen Inbound-Trunk ohne Zugangsdaten`),
    ...zielBefunde,
    ...fremdeZugaenge({ inventar, ziele }),
    ...secretSuche.befunde,
  ];
  return { befunde, vorher: { registrierungen, ziele, secret: secretSuche.secret } };
}

// Rein. Ziele je phone_number_id: dieselbe Registrierung ueber --nummer UND --registrierung zaehlt einmal.
function ordneZieleZu({ registrierungen, auswahl, agentId }) {
  const aufloesungen = [
    ...auswahl.nummern.map((nummer) => zielNachNummer(registrierungen, nummer)),
    ...auswahl.kennungen.map((kennung, index) => zielNachKennung({ registrierungen, kennung, position: index + 1 })),
  ];
  const ziele = new Map(
    aufloesungen
      .filter((aufloesung) => aufloesung.registrierung)
      .map(({ registrierung }) => [registrierung.phone_number_id, registrierung]),
  );
  const schreibzielBefunde = [...ziele.values()].map((registrierung) => schreibzielBefund({ registrierung, agentId }));
  const befunde = [...aufloesungen.map((aufloesung) => aufloesung.befund), ...schreibzielBefunde].filter(Boolean);
  return { ziele, befunde };
}

function zielNachNummer(registrierungen, nummer) {
  const treffer = registrierungenMitNummer(registrierungen, nummer);
  if (treffer.length === 1) return { registrierung: treffer[0] };
  return { befund: `Nummer ${e164Endung(nummer)}: ${treffer.length} Registrierungen (erwartet genau eine)` };
}

// Exakter Kennungs-Abgleich. Eine unbekannte Eingabe wird nie zurueckgegeben (sie koennte eine volle
// Nummer sein), nur ihre Position.
function zielNachKennung({ registrierungen, kennung, position }) {
  const registrierung = registrierungen.find((eintrag) => eintrag.phone_number_id === kennung);
  return registrierung ? { registrierung } : { befund: `--registrierung #${position}: nicht im Inventar` };
}

// E14 == E16: EINE Definition "diese Registrierung darf unseren Inbound-Trunk tragen" (eigener Agent,
// eigene phone_number, outbound_trunk vorhanden). Gegen den neu erzeugten Zugang ist jede bestehende
// Registrierung eine Abweichung, und gelesen ist sie (Inventar-GET) - also nie UNBEKANNT.
function schreibzielBefund({ registrierung, agentId }) {
  const hindernis = reparaturHindernis({
    abruf: { beleg: TRUNK_BELEG.ABWEICHUNG, registrierung },
    number: { e164: registrierung.phone_number },
    agentId,
  });
  return hindernis ? `Registrierung ${registrierung.phone_number_id}: kein Schreibziel (${hindernis})` : null;
}

// Eine Registrierung MIT Inbound-Zugangsdaten ausserhalb der Ziele behielte den alten Zugang. Abgleich ueber
// die Kennung: beide Auswahlwege muenden in dieselbe Ziel-Map.
function fremdeZugaenge({ inventar, ziele }) {
  return inventar.mitZugang
    .filter((registrierung) => !ziele.has(registrierung.phone_number_id))
    .map((registrierung) => `Registrierung ${registrierung.phone_number_id} traegt Inbound-Zugangsdaten und steht nicht in der Ziel-Liste (halbe Rotation)`);
}

// Die Liste traegt nie Secret-Werte, nur Kennung und Name.
function leseSecretListe(abh) {
  return listConvaiSecrets({
    fetchImpl: abh.fetchImpl,
    account: abh.elKonto,
    search: WORKSPACE_SECRET_NAME,
    pageSize: SECRET_SEITE,
  });
}

async function sucheWorkspaceSecret(abh) {
  const antwort = await leseSecretListe(abh);
  const treffer = (antwort?.secrets ?? []).filter((secret) => secret.name === WORKSPACE_SECRET_NAME);
  const befunde = [];
  if (antwort?.next_cursor) befunde.push("Secret-Liste unvollstaendig (next_cursor) - kein eindeutiger Beleg");
  if (treffer.length > 1) befunde.push(`${treffer.length} Workspace-Secrets heissen ${WORKSPACE_SECRET_NAME} (erwartet hoechstens eins)`);
  return { befunde, secret: treffer[0] ?? null };
}

// ---- 2. Erzeugen ------------------------------------------------------------------------------

// {geheimnisse:{sipUser, sipPassword, initWebhookToken}, befunde[]}. Befunde nennen nur Schluesselnamen.
export function erzeugeGeheimnisse(abh) {
  const zufallsHex = (bytes) => abh.zufall(bytes).toString(HEX);
  const geheimnisse = {
    sipUser: zufallsHex(SIP_USER_ZUFALLS_BYTES),
    sipPassword: zufallsHex(GEHEIMNIS_ZUFALLS_BYTES),
    initWebhookToken: zufallsHex(GEHEIMNIS_ZUFALLS_BYTES),
  };
  Object.values(geheimnisse).forEach((wert) => abh.waechter.verbiete(wert));
  const befunde = inboundElAccessDefects(geheimnisse).map((defekt) => `${defekt.envKey} erzeugt: ${defekt.mangel}`);
  return { geheimnisse, befunde };
}

// ---- 3./4. Verteilen --------------------------------------------------------------------------

// Adapter auf die EINE Koerperform (src/elevenlabs/nummern-registrierung.js#inboundTrunkKoerper, IEX-A10);
// der Lesebeleg zeigt media_encryption danach.
export function trunkKoerper({ geheimnisse, nummer }) {
  return inboundTrunkKoerper({ benutzer: geheimnisse.sipUser, passwort: geheimnisse.sipPassword, e164: nummer });
}

// Die Reihenfolge ist die Reihenfolge dieser Liste: Render -> Secret -> Registrierungen.
function verteilSchritte({ abh, geheimnisse, vorher }) {
  return [
    ...RENDER_GEHEIMNISSE.map(({ schluessel, feld }) => ({
      ziel: `Render ${schluessel}`,
      laenge: geheimnisse[feld].length,
      ausfuehren: () => schreibeDienstEnv(abh, { schluessel, wert: geheimnisse[feld] }),
    })),
    secretSchritt({ abh, wert: geheimnisse.initWebhookToken, vorhanden: vorher.secret }),
    ...[...vorher.ziele.values()].map((registrierung) => registrierungsSchritt({ abh, geheimnisse, registrierung })),
  ];
}

function secretSchritt({ abh, wert, vorhanden }) {
  const zugriff = { fetchImpl: abh.fetchImpl, account: abh.elKonto, name: WORKSPACE_SECRET_NAME, value: wert };
  return {
    ziel: `Workspace-Secret ${WORKSPACE_SECRET_NAME} (${vorhanden ? "aktualisieren" : "anlegen"})`,
    laenge: wert.length,
    ausfuehren: async () => {
      const antwort = vorhanden
        ? await updateConvaiSecret({ ...zugriff, secretId: vorhanden.secret_id })
        : await createConvaiSecret(zugriff);
      const secretId = antwort?.secret_id ?? null;
      return { status: secretId ? HTTP.OK : null, secretId };
    },
  };
}

function registrierungsSchritt({ abh, geheimnisse, registrierung }) {
  const nummer = registrierung.phone_number;
  return {
    ziel: `Registrierung ${registrierung.phone_number_id} (${e164Endung(nummer)})`,
    laenge: geheimnisse.sipPassword.length,
    ausfuehren: async () => {
      await patchPhoneNumber({
        fetchImpl: abh.fetchImpl,
        account: abh.elKonto,
        phoneNumberId: registrierung.phone_number_id,
        body: trunkKoerper({ geheimnisse, nummer }),
      });
      return { status: HTTP.OK };
    },
  };
}

// Seriell, Abbruch beim ersten Fehlschlag; die uebrigen Ziele bleiben "gesetzt: nein".
async function fuehreSchritteAus(schritte) {
  const ziele = schritte.map(({ ziel, laenge }) => ({ ziel, laenge, gesetzt: false, status: null }));
  for (const [index, schritt] of schritte.entries()) {
    const ergebnis = await ergebnisOhneWurf(schritt.ausfuehren);
    Object.assign(ziele[index], ergebnis, { gesetzt: ergebnis.status === HTTP.OK });
    if (!ziele[index].gesetzt) return { ziele, ok: false };
  }
  return { ziele, ok: true };
}

// Ein Wurf wird zum Status - nur err.providerStatus, nie err.message (kann Koerper-Schnipsel tragen).
async function ergebnisOhneWurf(aktion) {
  try {
    return await aktion();
  } catch (err) {
    return { status: err?.providerStatus ?? null };
  }
}

// ---- 5. Lesebelege (nur GET) ------------------------------------------------------------------

async function lesebelege({ abh, geheimnisse, secretId, vorher }) {
  const teile = [
    await renderBelegGruen({ abh, geheimnisse }),
    await secretBelegGruen({ abh, secretId }),
    await webhookBelegGruen({ abh, secretId }),
    await registrierungsBelegeGruen({ abh, geheimnisse, ziele: vorher.ziele }),
  ];
  // ALS LETZTES (E16 c, Runde 5 B1): nach dieser Pruefung folgt kein Schreibaufruf mehr.
  const inventarGruen = await abschliessendesInventarGruen(abh);
  return teile.every(Boolean) && inventarGruen;
}

async function renderBelegGruen({ abh, geheimnisse }) {
  let gruen = true;
  for (const { schluessel, feld } of RENDER_GEHEIMNISSE) {
    const { status, wert } = await leseDienstEnv(abh, schluessel);
    abh.waechter.verbiete(wert);
    const gleich = status === HTTP.OK && wert === geheimnisse[feld];
    meldeNachUrteil(abh.waechter, {
      gruen: gleich,
      zeile: `BELEG Render ${schluessel}: vorhanden ${jaNein(wert !== null)}, Laenge ${wert?.length ?? 0}, gleich ${jaNein(gleich)}, Status ${status}`,
    });
    gruen = gruen && gleich;
  }
  return gruen;
}

async function secretBelegGruen({ abh, secretId }) {
  const antwort = await leseSecretListe(abh);
  const enthalten = (antwort?.secrets ?? []).some((secret) => secret.secret_id === secretId);
  meldeNachUrteil(abh.waechter, {
    gruen: enthalten,
    zeile: `BELEG Workspace-Secret: Liste enthaelt secret_id ${secretId ?? OHNE_WERT}: ${jaNein(enthalten)}`,
  });
  return enthalten;
}

async function webhookBelegGruen({ abh, secretId }) {
  const settings = await fetchConvaiSettings({ fetchImpl: abh.fetchImpl, account: abh.elKonto });
  const befunde = webhookSecretKonflikt({ settings, secretId });
  meldeNachUrteil(abh.waechter, {
    gruen: befunde.length === 0,
    zeile: `BELEG Workspace-Init-Webhook: ${befunde.length === 0 ? "kein widersprechender Secret-Verweis" : befunde.join("; ")}`,
  });
  return befunde.length === 0;
}

// Rein. Nicht gesetzt -> kein Befund (den Webhook setzt B9); String -> Klartext-Secret (E14);
// Verweis auf eine andere secret_id -> Befund. Gemeldet werden nie Werte oder fremde Kennungen.
export function webhookSecretKonflikt({ settings, secretId }) {
  const kopf = settings?.[INIT_WEBHOOK_SETTINGS_SCHLUESSEL]?.request_headers?.[INIT_TOKEN_HEADER];
  if (kopf === undefined || kopf === null) return [];
  if (typeof kopf === "string") return [`Header ${INIT_TOKEN_HEADER} ist ein String (Klartext-Secret, E14)`];
  if (kopf.secret_id !== secretId) return [`Header ${INIT_TOKEN_HEADER} verweist auf eine andere secret_id`];
  return [];
}

async function registrierungsBelegeGruen({ abh, geheimnisse, ziele }) {
  let gruen = true;
  for (const vorher of ziele.values()) {
    const nachher = await fetchPhoneNumber({ fetchImpl: abh.fetchImpl, account: abh.elKonto, phoneNumberId: vorher.phone_number_id });
    gruen = meldeRegistrierungsBeleg({ abh, geheimnisse, vorher, nachher }) && gruen;
  }
  return gruen;
}

function meldeRegistrierungsBeleg({ abh, geheimnisse, vorher, nachher }) {
  const nummer = vorher.phone_number;
  const trunk = nachher?.inbound_trunk ?? {};
  abh.waechter.verbiete(trunk.username);
  const pruefung = {
    zugangsdaten: trunk.has_auth_credentials === true,
    usernameGleich: trunk.username === geheimnisse.sipUser,
    allowedNumbers: isDeepStrictEqual(trunk.allowed_numbers, [nummer]),
    outboundUnveraendert: isDeepStrictEqual(nachher?.outbound_trunk, vorher.outbound_trunk),
  };
  const gruen = Object.values(pruefung).every(Boolean);
  meldeNachUrteil(abh.waechter, {
    gruen,
    zeile:
      `BELEG Registrierung ${vorher.phone_number_id} (${e164Endung(nummer)}): has_auth_credentials ${jaNein(pruefung.zugangsdaten)}, ` +
      `username gleich ${jaNein(pruefung.usernameGleich)}, allowed_numbers [DID] ${jaNein(pruefung.allowedNumbers)}, ` +
      `outbound_trunk unveraendert ${jaNein(pruefung.outboundUnveraendert)}, media_encryption=${trunk.media_encryption ?? OHNE_WERT}`,
  });
  return gruen;
}

async function abschliessendesInventarGruen(abh) {
  const urteil = inventarUrteil(await holeRegistrierungen({ fetchImpl: abh.fetchImpl, account: abh.elKonto }));
  meldeNachUrteil(abh.waechter, {
    gruen: urteil.gruen,
    zeile: `BELEG Inventar (abschliessend): ${urteilText(urteil.gruen)} - ${urteil.offen.length} offen`,
  });
  return urteil.gruen;
}
