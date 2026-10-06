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

function zielNachKennung({ registrierungen, kennung, position }) {
  const registrierung = registrierungen.find((eintrag) => eintrag.phone_number_id === kennung);
  return registrierung ? { registrierung } : { befund: `--registrierung #${position}: nicht im Inventar` };
}

function schreibzielBefund({ registrierung, agentId }) {
  const hindernis = reparaturHindernis({
    abruf: { beleg: TRUNK_BELEG.ABWEICHUNG, registrierung },
    number: { e164: registrierung.phone_number },
    agentId,
  });
  return hindernis ? `Registrierung ${registrierung.phone_number_id}: kein Schreibziel (${hindernis})` : null;
}

function fremdeZugaenge({ inventar, ziele }) {
  return inventar.mitZugang
    .filter((registrierung) => !ziele.has(registrierung.phone_number_id))
    .map((registrierung) => `Registrierung ${registrierung.phone_number_id} traegt Inbound-Zugangsdaten und steht nicht in der Ziel-Liste (halbe Rotation)`);
}

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

export function trunkKoerper({ geheimnisse, nummer }) {
  return inboundTrunkKoerper({ benutzer: geheimnisse.sipUser, passwort: geheimnisse.sipPassword, e164: nummer });
}

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

async function fuehreSchritteAus(schritte) {
  const ziele = schritte.map(({ ziel, laenge }) => ({ ziel, laenge, gesetzt: false, status: null }));
  for (const [index, schritt] of schritte.entries()) {
    const ergebnis = await ergebnisOhneWurf(schritt.ausfuehren);
    Object.assign(ziele[index], ergebnis, { gesetzt: ergebnis.status === HTTP.OK });
    if (!ziele[index].gesetzt) return { ziele, ok: false };
  }
  return { ziele, ok: true };
}

async function ergebnisOhneWurf(aktion) {
  try {
    return await aktion();
  } catch (err) {
    return { status: err?.providerStatus ?? null };
  }
}

async function lesebelege({ abh, geheimnisse, secretId, vorher }) {
  const teile = [
    await renderBelegGruen({ abh, geheimnisse }),
    await secretBelegGruen({ abh, secretId }),
    await webhookBelegGruen({ abh, secretId }),
    await registrierungsBelegeGruen({ abh, geheimnisse, ziele: vorher.ziele }),
  ];
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
