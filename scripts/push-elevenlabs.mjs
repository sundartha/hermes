#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { config } from "../src/config.js";
import { fetchConvaiSettings, patchConvaiSettings } from "../src/elevenlabs/convai.js";
import {
  HERMES_RENDER_SERVICE_ID,
  ZIEL_URTEIL,
  initWebhookUrl,
  renderDienstZiel,
  zielUrteil,
} from "../src/elevenlabs/init-webhook-ziel.js";
import { INIT_TOKEN_HEADER } from "../src/routes/webhooks-elevenlabs-init.js";

import {
  AGENTEN_PFAD_PREFIX,
  FEHLER_VORSCHAU_ZEICHEN,
  LIVE_AGENT_ID,
  holeLiveAgenten,
  ladeVorlage,
  ohneSchluessel,
  schluesselFehlt,
} from "./lib/elevenlabs-agent-lesen.mjs";
import {
  ART_WERT,
  PFAD_TRENNER,
  PFAD_VERBINDER,
  SCHREIBWEG_JE_SCHLUESSEL,
  besesseneFeldNamen,
  eintraegeAus,
  livePfadeVon,
  setzeAnPfad,
  vergleicheBesitz,
  wertAnPfad,
} from "./lib/elevenlabs-besitz.mjs";

const LOG_PREFIX = "[push-elevenlabs]";
const BESTAETIGUNGS_FLAG = "--ausfuehren";
const FELDER_FLAG = "--felder";
const FLAG_PRAEFIX = "--";
const WERT_TRENNER = "=";
const FELDER_TRENNER = ",";
const ARG_START = 2;
const LISTEN_TRENNER = ", ";
const SCHREIB_TIMEOUT_MS = 30000;
const WORKSPACE_INIT_WEBHOOK_FLAG = "--workspace-init-webhook";
const SECRET_ID_FLAG = "--secret-id";
const ENTFERNEN_FLAG = "--entfernen";
const INIT_WEBHOOK_SCHALTER_FELD = "init_webhook_schalter";
const FREIGABEN_FELD = "conversation_config_override_erlaubnisse";
const AGENT_PROMPT_FREIGABEN = "agent.prompt";
export const INIT_WEBHOOK_SETTINGS_SCHLUESSEL = "conversation_initiation_client_data_webhook";
const OHNE_WERT_MARKE = "-";

const { apiKey, apiBase } = config.voice.elevenLabsPlayTts;

function zerlegeSchalter(token) {
  const stelle = token.indexOf(WERT_TRENNER);
  if (stelle < 0) return { name: token, wert: null };
  return { name: token.slice(0, stelle), wert: token.slice(stelle + 1) };
}

function feldNamenAus(wert) {
  return (wert ?? "")
    .split(FELDER_TRENNER)
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

function mitFehler(stand, fehler) {
  return { ...stand, fehler: [...stand.fehler, fehler] };
}

const SCHALTER_OHNE_WERT = Object.freeze({
  [BESTAETIGUNGS_FLAG]: "ausfuehren",
  [WORKSPACE_INIT_WEBHOOK_FLAG]: "workspaceInitWebhook",
  [ENTFERNEN_FLAG]: "entfernen",
});

function mitFeldauswahl({ stand, token, wert }) {
  const namen = feldNamenAus(wert);
  if (namen.length === 0) {
    return mitFehler(
      stand,
      `${token} - ${FELDER_FLAG} braucht mindestens einen Feldnamen, z.B. ${FELDER_FLAG}=prompt${FELDER_TRENNER}language`,
    );
  }
  return { ...stand, auswahl: [...(stand.auswahl ?? []), ...namen] };
}

function mitSecretId({ stand, token, wert }) {
  if (wert === null || wert.trim() === "") {
    return mitFehler(stand, `${token} - ${SECRET_ID_FLAG} braucht einen Wert, z.B. ${SECRET_ID_FLAG}=<secret_id>`);
  }
  return { ...stand, secretId: wert };
}

function wendeSchalterAn(stand, token) {
  const { name, wert } = zerlegeSchalter(token);
  if (Object.hasOwn(SCHALTER_OHNE_WERT, name)) {
    if (wert !== null) return mitFehler(stand, `${token} - ${name} nimmt keinen Wert`);
    return { ...stand, [SCHALTER_OHNE_WERT[name]]: true };
  }
  if (name === FELDER_FLAG) return mitFeldauswahl({ stand, token, wert });
  if (name === SECRET_ID_FLAG) return mitSecretId({ stand, token, wert });
  return mitFehler(
    stand,
    `${token} - unbekannter Schalter (bekannt: ${BESTAETIGUNGS_FLAG}, ${FELDER_FLAG}=<feld${FELDER_TRENNER}feld>, ${WORKSPACE_INIT_WEBHOOK_FLAG}, ${SECRET_ID_FLAG}=<secret_id>, ${ENTFERNEN_FLAG})`,
  );
}

function modusFehler(stand, frei) {
  const hatAbsicht = stand.secretId !== null || stand.entfernen;
  if (!stand.workspaceInitWebhook) {
    return hatAbsicht ? [`${SECRET_ID_FLAG} und ${ENTFERNEN_FLAG} gelten nur mit ${WORKSPACE_INIT_WEBHOOK_FLAG}`] : [];
  }
  const fehler = [];
  if (stand.auswahl !== null || frei.length > 0) {
    fehler.push(
      `${WORKSPACE_INIT_WEBHOOK_FLAG} schreibt Workspace-Settings und keinen Agenten - weder ${FELDER_FLAG} noch eine Agenten-Kennung`,
    );
  }
  if ((stand.secretId !== null) === stand.entfernen) {
    fehler.push(`${WORKSPACE_INIT_WEBHOOK_FLAG} verlangt genau eins: ${SECRET_ID_FLAG}=<secret_id> oder ${ENTFERNEN_FLAG}`);
  }
  return fehler;
}

function leseArgumente(argv) {
  const argumente = argv.slice(ARG_START);
  const frei = argumente.filter((wert) => !wert.startsWith(FLAG_PRAEFIX));
  const schalter = argumente.filter((wert) => wert.startsWith(FLAG_PRAEFIX));
  const start = {
    ausfuehren: false,
    auswahl: null,
    workspaceInitWebhook: false,
    secretId: null,
    entfernen: false,
    fehler: [],
  };
  const stand = schalter.reduce(wendeSchalterAn, start);
  return {
    ...stand,
    fehler: [...stand.fehler, ...modusFehler(stand, frei)],
    agentId: frei[0] || LIVE_AGENT_ID,
  };
}

function unbekannteFelder(auswahl, vorlage) {
  if (auswahl === null) return [];
  const bekannt = new Set(besesseneFeldNamen(vorlage));
  return auswahl.filter((feld) => !bekannt.has(feld));
}

function istGewaehlt(auswahl, abweichung) {
  if (auswahl !== null) return auswahl.includes(abweichung.feld);
  return !abweichung.ausgenommen;
}

function istSchreibbar(abweichung) {
  const einPfad = abweichung.livePfade.length === 1;
  if (!einPfad || !abweichung.soll.vorhanden) return false;
  if (abweichung.schreibweg !== null) return abweichung.vorlagePfade.length === 1;
  return abweichung.art === ART_WERT;
}

function zielPfad(abweichung) {
  return abweichung.livePfade[0];
}

export function teileAbweichungen({ abweichungen, auswahl }) {
  const kandidaten = abweichungen.filter(istSchreibbar);
  const uebergangen = kandidaten.filter((abweichung) => !istGewaehlt(auswahl, abweichung));
  return {
    schreibbar: kandidaten.filter((abweichung) => istGewaehlt(auswahl, abweichung)),
    ausgenommen: uebergangen.filter((abweichung) => abweichung.ausgenommen),
    ausgelassen: uebergangen.filter((abweichung) => !abweichung.ausgenommen),
    rest: abweichungen.filter((abweichung) => !istSchreibbar(abweichung)),
  };
}

function zusammengefuehrterWert({ abweichung, vorlage, live }) {
  const soll = wertAnPfad(vorlage, abweichung.vorlagePfade[0]);
  if (!soll.gefunden) {
    return {
      fehler: `${abweichung.feld}: die Vorlage fuehrt ${abweichung.vorlagePfade[0]} nicht - ohne Quelle wird nichts zusammengefuehrt`,
    };
  }
  const ist = wertAnPfad(live, zielPfad(abweichung));
  const sollEintraege = new Map(eintraegeAus(soll.wert));
  const istEintraege = new Map(ist.gefunden ? eintraegeAus(ist.wert) : []);
  const nurLive = [...istEintraege.keys()].filter((name) => !sollEintraege.has(name));
  if (nurLive.length > 0) {
    return {
      fehler: `${abweichung.feld}: der Live-Agent fuehrt Schluessel, die die Vorlage nicht kennt: ${nurLive.join(LISTEN_TRENNER)}. Der Schreibweg "${SCHREIBWEG_JE_SCHLUESSEL}" loescht nichts - was hier verschwaende, hat jemand angelegt. Erst in die Vorlage aufnehmen oder im Dashboard entfernen.`,
    };
  }
  const zusammen = {};
  for (const [name, sollEintrag] of sollEintraege) {
    const istEintrag = istEintraege.get(name);
    zusammen[name] =
      istEintrag === undefined
        ? sollEintrag
        : mitBesessenenBlaettern({
            istEintrag,
            sollEintrag,
            blaetter: abweichung.schreibwegBesitz,
          });
  }
  return { wert: zusammen };
}

function mitBesessenenBlaettern({ istEintrag, sollEintrag, blaetter }) {
  const zusammen = structuredClone(istEintrag);
  for (const blatt of blaetter) {
    const wert = wertAnPfad(sollEintrag, blatt);
    if (wert.gefunden) setzeAnPfad(zusammen, blatt, wert.wert);
  }
  return zusammen;
}

export function mitSchreibwerten({ schreibbar, vorlage, live }) {
  const fehler = [];
  const werte = schreibbar.map((abweichung) => {
    if (abweichung.schreibweg === null) {
      return { ...abweichung, schreibWert: abweichung.soll.wert };
    }
    const ergebnis = zusammengefuehrterWert({ abweichung, vorlage, live });
    if (ergebnis.fehler) fehler.push(ergebnis.fehler);
    return { ...abweichung, schreibWert: ergebnis.wert };
  });
  return { schreibbar: fehler.length > 0 ? [] : werte, fehler };
}

export function bauePatchKoerper(schreibbar) {
  const koerper = {};
  for (const abweichung of schreibbar) {
    setzeAnPfad(koerper, zielPfad(abweichung), abweichung.schreibWert);
  }
  return koerper;
}

function simuliereSchreiben({ live, schreibbar }) {
  const kopie = structuredClone(live);
  for (const abweichung of schreibbar) {
    setzeAnPfad(kopie, zielPfad(abweichung), abweichung.schreibWert);
  }
  return kopie;
}

const GESPERRTE_FELDER = ["retention_days"];

const RECORD_VOICE_ERLAUBT = Object.freeze({
  feld: "record_voice",
  wert: false,
  seit: "2026-09-15",
  grund: "Owner-Entscheidung O2 - Audio-Mitschnitt am Agenten aus, das Wieder-Einschalten bleibt gesperrt",
});

function istZweig(wert) {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert);
}

function blattPfade(wert, praefix) {
  if (!istZweig(wert)) return [praefix];
  return Object.entries(wert).flatMap(([schluessel, kind]) => {
    const pfad = praefix === "" ? schluessel : `${praefix}${PFAD_TRENNER}${schluessel}`;
    return blattPfade(kind, pfad);
  });
}

function gesperrteInAuswahl(auswahl) {
  if (auswahl === null) return [];
  return auswahl.filter((feld) => GESPERRTE_FELDER.includes(feld));
}

function stellenMitSchluessel(wert, praefix, trifft) {
  if (wert === null || typeof wert !== "object") return [];
  const eintraege = Array.isArray(wert)
    ? wert.map((kind, i) => [String(i), kind])
    : Object.entries(wert);
  return eintraege.flatMap(([schluessel, kind]) => {
    const pfad = praefix === "" ? schluessel : `${praefix}${PFAD_TRENNER}${schluessel}`;
    const treffer = trifft(schluessel, kind) ? [pfad] : [];
    return [...treffer, ...stellenMitSchluessel(kind, pfad, trifft)];
  });
}

function gesperrteStellen(koerper) {
  return stellenMitSchluessel(koerper, "", (schluessel) => GESPERRTE_FELDER.includes(schluessel));
}

function falscheRichtungStellen(koerper) {
  return stellenMitSchluessel(
    koerper,
    "",
    (schluessel, wert) => schluessel === RECORD_VOICE_ERLAUBT.feld && wert !== RECORD_VOICE_ERLAUBT.wert,
  );
}

const DOKU_PRAEFIX = "_";

function dokuStellen(koerper) {
  return stellenMitSchluessel(koerper, "", (schluessel) => schluessel.startsWith(DOKU_PRAEFIX));
}

function erlaubtePfade({ abweichungen, auswahl }) {
  return abweichungen
    .filter((abweichung) => istGewaehlt(auswahl, abweichung))
    .flatMap((abweichung) => abweichung.livePfade);
}

function liegtUnter(pfad, erlaubt) {
  return pfad === erlaubt || pfad.startsWith(`${erlaubt}${PFAD_TRENNER}`);
}

function blindePassagiere({ koerper, erlaubt }) {
  const gedeckt = (pfad) => erlaubt.some((pfadDerAuswahl) => liegtUnter(pfad, pfadDerAuswahl));
  return blattPfade(koerper, "").filter((pfad) => !gedeckt(pfad));
}

export function koerperVerstoesse({ koerper, abweichungen, auswahl }) {
  const befunde = [];
  const gesperrt = gesperrteStellen(koerper);
  if (gesperrt.length > 0) {
    befunde.push(
      `GESPERRT - der Patch-Koerper traegt gesperrte Felder an: ${gesperrt.join(LISTEN_TRENNER)}. Gesperrt sind ${GESPERRTE_FELDER.join(LISTEN_TRENNER)}; sie werden nie geschrieben, in keine Richtung.`,
    );
  }
  const doku = dokuStellen(koerper);
  if (doku.length > 0) {
    befunde.push(
      `ENTWICKLER-DOKU IM KOERPER - diese Schluessel erklaeren die Vorlage und gehoeren nicht zum Anbieter-Schema: ${doku.join(LISTEN_TRENNER)}. Der Hinweis gehoert eine Ebene hoeher, wo der Vergleich ihn ohnehin auslaesst.`,
    );
  }
  const falscheRichtung = falscheRichtungStellen(koerper);
  if (falscheRichtung.length > 0) {
    const { feld, wert, seit, grund } = RECORD_VOICE_ERLAUBT;
    befunde.push(
      `RICHTUNG GESPERRT - ${feld} wird nur als ${wert} geschrieben (seit ${seit}: ${grund}); der Patch-Koerper traegt dort einen anderen Wert an: ${falscheRichtung.join(LISTEN_TRENNER)}.`,
    );
  }
  const fremd = blindePassagiere({ koerper, erlaubt: erlaubtePfade({ abweichungen, auswahl }) });
  if (fremd.length > 0) {
    befunde.push(
      `BLINDER PASSAGIER - der Patch-Koerper traegt Pfade, die kein gewaehltes Feld verlangt hat: ${fremd.join(LISTEN_TRENNER)}.`,
    );
  }
  return befunde;
}

function schalterNurAusdruecklich(auswahl) {
  if (auswahl !== null && auswahl.includes(INIT_WEBHOOK_SCHALTER_FELD)) return [];
  return [
    `SCHALTER NUR AUSDRUECKLICH - ${INIT_WEBHOOK_SCHALTER_FELD} wird nur mit ${FELDER_FLAG}=${INIT_WEBHOOK_SCHALTER_FELD} geschrieben, nie als Nebenwirkung eines anderen Laufs.`,
  ];
}

function karteNichtLesbar(vorher) {
  if (vorher.gefunden && istZweig(vorher.wert)) return [];
  return ["FREIGABEN-KARTE NICHT LESBAR - ohne Schnappschuss kein Beleg, dass der Schalter-PATCH sie unberuehrt laesst."];
}

function offenePromptFreigaben(karte) {
  if (!istZweig(karte)) return [];
  const promptZweig = wertAnPfad(karte, AGENT_PROMPT_FREIGABEN);
  if (!promptZweig.gefunden) return [];
  return blattPfade(promptZweig.wert, AGENT_PROMPT_FREIGABEN)
    .filter((pfad) => wertAnPfad(karte, pfad).wert === true)
    .map((pfad) => `FREIGABE SCHON OFFEN - ${pfad} = true. Erst ${FELDER_FLAG}=${FREIGABEN_FELD} ${BESTAETIGUNGS_FLAG}, dann der Schalter.`);
}

function geschwisterImKoerper(koerper, schalterPfad) {
  const eltern = schalterPfad.split(PFAD_TRENNER).slice(0, -1).join(PFAD_TRENNER);
  const geschwister = blattPfade(koerper, "").filter(
    (pfad) => pfad.startsWith(`${eltern}${PFAD_TRENNER}`) && pfad !== schalterPfad,
  );
  if (geschwister.length === 0) return [];
  return [`MEHR ALS DER SCHALTER unter ${eltern}: ${geschwister.join(LISTEN_TRENNER)} - der Schalter-PATCH traegt dort nur ihn.`];
}

function freigabenWache({ vorlage, live, koerper, auswahl }) {
  const [schalterPfad] = livePfadeVon(vorlage, INIT_WEBHOOK_SCHALTER_FELD);
  if (!schalterPfad || !wertAnPfad(koerper, schalterPfad).gefunden) return { aktiv: false, befunde: [] };
  const [freigabenPfad] = livePfadeVon(vorlage, FREIGABEN_FELD);
  const vorher = freigabenPfad ? wertAnPfad(live, freigabenPfad) : { gefunden: false };
  return {
    aktiv: true,
    freigabenPfad,
    vorher: vorher.wert,
    befunde: [
      ...schalterNurAusdruecklich(auswahl),
      ...karteNichtLesbar(vorher),
      ...offenePromptFreigaben(vorher.wert),
      ...geschwisterImKoerper(koerper, schalterPfad),
    ],
  };
}

function meldeFreigaben(wache) {
  if (!istZweig(wache.vorher)) return;
  for (const pfad of blattPfade(wache.vorher, "")) {
    console.log(`${LOG_PREFIX} FREIGABE ${pfad}=${JSON.stringify(wertAnPfad(wache.vorher, pfad).wert)}`);
  }
}

async function patcheAgenten({ agentId, koerper }) {
  const pfad = `${AGENTEN_PFAD_PREFIX}${agentId}`;
  let antwort;
  try {
    antwort = await fetch(`${apiBase}${pfad}`, {
      method: "PATCH",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(koerper),
      signal: AbortSignal.timeout(SCHREIB_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `PATCH ${apiBase}${pfad} -> nicht erreichbar (Zeitlimit ${SCHREIB_TIMEOUT_MS} ms): ${ohneSchluessel(err.message)}`,
      { cause: err },
    );
  }
  if (!antwort.ok) {
    const text = await antwort.text();
    const anfang = ohneSchluessel(text.slice(0, FEHLER_VORSCHAU_ZEICHEN));
    throw new Error(`PATCH ${pfad} -> HTTP ${antwort.status}: ${anfang}`);
  }
}

function feldNamen(abweichungen) {
  return abweichungen.map((abweichung) => abweichung.feld).sort();
}

function feldZeile(marke, abweichung) {
  const pfade = abweichung.livePfade.join(PFAD_VERBINDER);
  return `${marke} ${abweichung.feld} (art "${abweichung.art}") | Live ${pfade} | IST ${abweichung.istAnzeige} -> SOLL ${abweichung.sollAnzeige}`;
}

function meldeZeilen(marke, abweichungen) {
  for (const abweichung of abweichungen) {
    console.log(`${LOG_PREFIX} ${feldZeile(marke, abweichung)}`);
  }
}

function meldeNichtSchreibbar(rest) {
  if (rest.length === 0) return;
  meldeZeilen("NICHT SCHREIBBAR", rest);
  console.log(
    `${LOG_PREFIX} NICHT SCHREIBBAR heisst: diese Vergleichs-Arten fassen mehrere Stellen zu einer Menge zusammen (Namen, Variablen, Texte). Aus einer Menge folgt kein einzelner Zielwert - ihn zu erraten waere genau der Fehler, den dieses Werkzeug verhindern soll. Diese Felder gehoeren ins Dashboard oder in die Vorlage.`,
  );
}

function meldeKoerper(koerper) {
  const pfade = blattPfade(koerper, "");
  if (pfade.length === 0) return;
  const groesse = JSON.stringify(koerper).length;
  console.log(
    `${LOG_PREFIX} PATCH-KOERPER - ${groesse} Zeichen, genau diese Blatt-Pfade und nichts sonst: ${pfade.join(LISTEN_TRENNER)}`,
  );
}

function meldeAusgelassen(ausgelassen) {
  if (ausgelassen.length === 0) return;
  meldeZeilen("AUSGELASSEN", ausgelassen);
  console.log(
    `${LOG_PREFIX} AUSGELASSEN heisst: dieses Feld weicht ab und waere schreibbar, steht aber nicht in ${FELDER_FLAG}. Es wird NICHT angefasst - "abweichend" ist keine Aufforderung, den Live-Wert umzudrehen.`,
  );
}

function meldeAusgenommen(ausgenommen) {
  if (ausgenommen.length === 0) return;
  for (const abweichung of ausgenommen) {
    const { grund, seit } = abweichung.ausgenommen;
    const zeile = `${feldZeile("AUSGENOMMEN", abweichung)} | ausgenommen seit ${seit}: ${grund}`;
    console.log(`${LOG_PREFIX} ${zeile}`);
  }
  console.log(
    `${LOG_PREFIX} AUSGENOMMEN heisst: die Vorlage nimmt dieses Feld ausdruecklich von Schreibvorgaengen aus (Feld "ausgenommen" am Besitz-Eintrag, mit Grund und Datum). Ohne Nennung in ${FELDER_FLAG} ist es NIE Schreib-Kandidat - ein unbedachter Lauf kann die festgehaltene Entscheidung nicht umdrehen. Wer sie umdrehen WILL, nennt das Feld ausdruecklich: ${FELDER_FLAG}=<feld>. NICHT so bei den gesperrten Feldern (${GESPERRTE_FELDER.join(LISTEN_TRENNER)}): die sind nicht nennbar, ihre Nennung bricht den Lauf ab.`,
  );
}

function meldeUebersteuerteAusnahmen(schreibbar) {
  const uebersteuert = schreibbar.filter((abweichung) => abweichung.ausgenommen);
  if (uebersteuert.length === 0) return;
  console.log(
    `${LOG_PREFIX} AUSNAHME UEBERSTIMMT - ${feldNamen(uebersteuert).join(LISTEN_TRENNER)}: in der Vorlage vorerst ausgenommen, aber in ${FELDER_FLAG} ausdruecklich genannt. Wird geschrieben; die Ausnahme ist ein Riegel gegen Unachtsamkeit, kein Verbot. Damit wird die festgehaltene Entscheidung umgedreht - die Vorlage sollte im selben Zug nachgezogen werden.`,
  );
}

function meldeAuswahl(auswahl) {
  if (auswahl === null) {
    console.log(
      `${LOG_PREFIX} FELDAUSWAHL - keine (${FELDER_FLAG} nicht gesetzt): jedes abweichende schreibbare Feld ist Kandidat, AUSSER den in der Vorlage ausgenommenen (s. AUSGENOMMEN).`,
    );
    return;
  }
  console.log(
    `${LOG_PREFIX} FELDAUSWAHL - nur ${auswahl.join(LISTEN_TRENNER)}. Jedes andere besessene Feld bleibt unberuehrt, auch wenn es abweicht.`,
  );
}

function meldePlan({ agentId, befund, auswahl, felder, danach }) {
  const { schreibbar, ausgenommen, ausgelassen, rest } = felder;
  console.log(
    `${LOG_PREFIX} Agent ${agentId}: ${befund.geprueft} besessene Felder verglichen, ${befund.abweichungen.length} weichen ab (${schreibbar.length} zum Schreiben gewaehlt, ${ausgenommen.length} von der Vorlage vorerst ausgenommen, ${ausgelassen.length} durch die Feldauswahl ausgelassen, ${rest.length} nicht schreibbar).`,
  );
  meldeAuswahl(auswahl);
  for (const verletzung of befund.verletzungen) {
    console.error(`${LOG_PREFIX} ${verletzung}`);
  }
  meldeZeilen("WUERDE SCHREIBEN", schreibbar);
  meldeUebersteuerteAusnahmen(schreibbar);
  meldeAusgenommen(ausgenommen);
  meldeAusgelassen(ausgelassen);
  meldeNichtSchreibbar(rest);
  const uebrig = feldNamen(danach.abweichungen);
  const namen = uebrig.length > 0 ? `: ${uebrig.join(LISTEN_TRENNER)}` : "";
  console.log(
    `${LOG_PREFIX} VORHERSAGE - danach waeren noch ${uebrig.length} besessene Felder abweichend${namen} (trocken am gelesenen Live-Stand gerechnet, nichts gesendet).`,
  );
}

function brichAb(befunde, schluss) {
  for (const zeile of befunde) console.error(`${LOG_PREFIX} ${zeile}`);
  console.error(`${LOG_PREFIX} Abbruch (fail-closed): ${schluss}`);
  return 1;
}

function freigabenVeraendert({ wache, nachher }) {
  if (!wache.aktiv) return false;
  return !isDeepStrictEqual(wertAnPfad(nachher, wache.freigabenPfad).wert, wache.vorher);
}

async function fuehreAus({ agentId, vorlage, befund, schreibbar, danach, koerper, wache }) {
  if (befund.verletzungen.length > 0) {
    console.error(
      `${LOG_PREFIX} Abbruch (fail-closed): ${befund.verletzungen.length} Verbote der Vorlage sind am Live-Agenten verletzt (oben genannt). In eine Konfiguration, von der bekannt ist, dass sie eine Regel bricht, wird nicht geschrieben - der Push wuerde einen Teil richtig stellen und den Bruch bestehen lassen. NICHTS gesendet.`,
    );
    return 1;
  }
  if (schreibbar.length === 0) {
    console.log(
      `${LOG_PREFIX} Nichts zu schreiben - kein gewaehltes schreibbares Feld weicht ab. NICHTS gesendet.`,
    );
    return 0;
  }

  const pfade = schreibbar.map(zielPfad);
  console.log(`${LOG_PREFIX} PATCH an ${pfade.length} Pfaden: ${pfade.join(LISTEN_TRENNER)}`);
  await patcheAgenten({ agentId, koerper });

  const nachher = await holeLiveAgenten(agentId);
  if (freigabenVeraendert({ wache, nachher })) {
    console.error(
      `${LOG_PREFIX} ROT nach dem Schreiben - die Freigaben-Karte ${wache.freigabenPfad} weicht vom Vorher-Schnappschuss ab. RUECKWEG SOFORT: npm run elevenlabs:push -- ${FELDER_FLAG}=${FREIGABEN_FELD} ${BESTAETIGUNGS_FLAG}, danach Schalter false (Vorlage lokal false + ${FELDER_FLAG}=${INIT_WEBHOOK_SCHALTER_FELD} ${BESTAETIGUNGS_FLAG}).`,
    );
    return 1;
  }
  const geprueft = vergleicheBesitz({ vorlage, live: nachher });
  const vorhergesagt = new Set(feldNamen(danach.abweichungen));
  const unerwartet = feldNamen(geprueft.abweichungen).filter((feld) => !vorhergesagt.has(feld));
  if (unerwartet.length > 0) {
    console.error(
      `${LOG_PREFIX} ROT nach dem Schreiben - unerwartet abweichend: ${unerwartet.join(LISTEN_TRENNER)}. Der Patch hat mehr veraendert als seine Pfade (PATCH ersetzt Dict- und Listenfelder). Live-Stand pruefen, bevor erneut geschrieben wird.`,
    );
    return 1;
  }
  console.log(
    `${LOG_PREFIX} OK - ${schreibbar.length} Felder geschrieben und zurueckgelesen, ${geprueft.abweichungen.length} besessene Felder weichen noch ab (wie vorhergesagt).`,
  );
  return 0;
}

export async function runCli(argv = process.argv) {
  const schluesselGrund = schluesselFehlt();
  if (schluesselGrund) {
    console.error(
      `${LOG_PREFIX} Abbruch (fail-closed): ${schluesselGrund} Ohne gelesenen Live-Stand wird nicht geschrieben.`,
    );
    return 1;
  }
  const { agentId, ausfuehren, auswahl, workspaceInitWebhook, secretId, entfernen, fehler } = leseArgumente(argv);
  if (fehler.length > 0) {
    return brichAb(fehler, `${fehler.length} Argumente nicht verstanden. NICHTS gesendet.`);
  }
  if (workspaceInitWebhook) return await laufeWorkspaceInitWebhook({ secretId, entfernen, ausfuehren });
  return await laufeAgentenPush({ agentId, ausfuehren, auswahl });
}

async function laufeAgentenPush({ agentId, ausfuehren, auswahl }) {
  const gesperrt = gesperrteInAuswahl(auswahl);
  if (gesperrt.length > 0) {
    return brichAb(
      [],
      `${FELDER_FLAG} nennt gesperrte Felder: ${gesperrt.join(LISTEN_TRENNER)}. Diese Felder schreibt dieses Werkzeug nie, in keine Richtung - die Aufbewahrung ist eine Datenschutz-Entscheidung und keine Konfiguration (s. GESPERRTE_FELDER). NICHTS gesendet.`,
    );
  }

  const vorlage = ladeVorlage();
  const unbekannt = unbekannteFelder(auswahl, vorlage);
  if (unbekannt.length > 0) {
    return brichAb(
      [],
      `${FELDER_FLAG} nennt Felder, die die Vorlage nicht besitzt: ${unbekannt.join(LISTEN_TRENNER)}. Besessen sind: ${besesseneFeldNamen(vorlage).join(LISTEN_TRENNER)}. NICHTS gesendet.`,
    );
  }

  const live = await holeLiveAgenten(agentId);
  const befund = vergleicheBesitz({ vorlage, live });
  if (befund.fehler.length > 0) {
    return brichAb(
      befund.fehler,
      `die Besitz-Erklaerung der Vorlage traegt nicht (${befund.fehler.length} Fehler). Was nicht verlaesslich verglichen werden kann, wird nicht geschrieben. NICHTS gesendet.`,
    );
  }

  const felder = teileAbweichungen({ abweichungen: befund.abweichungen, auswahl });
  const { schreibbar, fehler: schreibwegFehler } = mitSchreibwerten({
    schreibbar: felder.schreibbar,
    vorlage,
    live,
  });
  if (schreibwegFehler.length > 0) {
    return brichAb(
      schreibwegFehler,
      `${schreibwegFehler.length} erklaerte Schreibwege tragen nicht (oben genannt). NICHTS gesendet.`,
    );
  }
  const danach = vergleicheBesitz({ vorlage, live: simuliereSchreiben({ live, schreibbar }) });
  const koerper = bauePatchKoerper(schreibbar);
  meldePlan({ agentId, befund, auswahl, felder, danach });
  meldeKoerper(koerper);

  const verstoesse = koerperVerstoesse({ koerper, abweichungen: befund.abweichungen, auswahl });
  if (verstoesse.length > 0) {
    return brichAb(
      verstoesse,
      `der Patch-Koerper haelt der Pruefung nicht stand (${verstoesse.length} Befunde, oben genannt). Nicht gefiltert, nicht uebersprungen, nicht gewarnt - Halt. NICHTS gesendet.`,
    );
  }
  const wache = freigabenWache({ vorlage, live, koerper, auswahl });
  if (wache.aktiv) meldeFreigaben(wache);
  if (wache.befunde.length > 0) {
    return brichAb(wache.befunde, "Freigaben-Wache (IEL-B9) - ROT ohne PATCH. NICHTS gesendet.");
  }

  if (!ausfuehren) {
    console.log(
      `${LOG_PREFIX} TROCKENLAUF - nichts gesendet, der Live-Agent ist unveraendert. Zum wirklichen Schreiben: npm run elevenlabs:push -- ${FELDER_FLAG}=<feld> ${BESTAETIGUNGS_FLAG}`,
    );
    return 0;
  }
  return await fuehreAus({ agentId, vorlage, befund, schreibbar, danach, koerper, wache });
}

export function initWebhookKoerper({ secretId, entfernen }) {
  if (entfernen) return { [INIT_WEBHOOK_SETTINGS_SCHLUESSEL]: null };
  return {
    [INIT_WEBHOOK_SETTINGS_SCHLUESSEL]: {
      url: initWebhookUrl(),
      request_headers: { [INIT_TOKEN_HEADER]: { secret_id: secretId } },
    },
  };
}

function adressBefunde(webhook) {
  if (webhook?.url === initWebhookUrl()) return [];
  return [`ADRESSE WEICHT AB - ${INIT_WEBHOOK_SETTINGS_SCHLUESSEL}.url ist nicht ${initWebhookUrl()}.`];
}

function headerBefunde({ webhook, secretId }) {
  const kopf = istZweig(webhook?.request_headers) ? webhook.request_headers : {};
  const klartext = Object.keys(kopf).filter((name) => typeof kopf[name] === "string");
  const befunde = klartext.map((name) => `HEADER IST STRING (Klartext-Secret, E14) - request_headers.${name}`);
  const token = kopf[INIT_TOKEN_HEADER];
  if (typeof token !== "string" && !(istZweig(token) && token.secret_id === secretId)) {
    befunde.push(`SECRET-VERWEIS FEHLT - request_headers.${INIT_TOKEN_HEADER} traegt nicht secret_id ${secretId}.`);
  }
  return befunde;
}

export function initWebhookLesebeleg({ settings, secretId, entfernen }) {
  const webhook = settings?.[INIT_WEBHOOK_SETTINGS_SCHLUESSEL];
  if (entfernen) {
    const leer = webhook === null || webhook === undefined;
    return leer ? [] : [`INIT-WEBHOOK NOCH GESETZT - ${INIT_WEBHOOK_SETTINGS_SCHLUESSEL} ist nach dem Entfernen nicht leer.`];
  }
  return [...adressBefunde(webhook), ...headerBefunde({ webhook, secretId })];
}

export function uebrigeSettingsVeraendert(vorher, nachher) {
  const schluessel = new Set([...Object.keys(vorher ?? {}), ...Object.keys(nachher ?? {})]);
  schluessel.delete(INIT_WEBHOOK_SETTINGS_SCHLUESSEL);
  const veraendert = [...schluessel].filter((name) => !isDeepStrictEqual(vorher?.[name], nachher?.[name]));
  if (veraendert.length === 0) return [];
  return [`GEGENPROBE ROT - Workspace-Settings veraendert: ${veraendert.sort().join(LISTEN_TRENNER)}`];
}

async function zielUrteilVomDienst() {
  const dienst = await renderDienstZiel({
    fetchImpl: fetch,
    apiKey: config.werkzeug.renderApiKey,
    serviceId: HERMES_RENDER_SERVICE_ID,
  });
  return zielUrteil(dienst);
}

function meldeZielUrteil(urteil) {
  const gruen = urteil.urteil === ZIEL_URTEIL.GRUEN;
  const status = urteil.status === undefined ? "" : ` status=${urteil.status}`;
  const zeile = `${LOG_PREFIX} ZIEL-URTEIL ${gruen ? "GRUEN" : "ROT"} - wirksamer Origin ${urteil.wirksamerOrigin ?? "leer"}, Ziel ${initWebhookUrl()}, grund=${urteil.grund ?? OHNE_WERT_MARKE}${status}`;
  if (gruen) console.log(zeile);
  else console.error(zeile);
}

function meldeInitWebhookPlan({ vorher, secretId, entfernen }) {
  const gesetzt = vorher?.[INIT_WEBHOOK_SETTINGS_SCHLUESSEL] ? "ja" : "nein";
  console.log(`${LOG_PREFIX} Workspace-Init-Webhook vorher gesetzt: ${gesetzt}`);
  if (entfernen) {
    console.log(`${LOG_PREFIX} WUERDE ENTFERNEN - ${INIT_WEBHOOK_SETTINGS_SCHLUESSEL} = null`);
    return;
  }
  console.log(
    `${LOG_PREFIX} WUERDE SETZEN - url ${initWebhookUrl()}, Header ${INIT_TOKEN_HEADER} als secret_id ${secretId}`,
  );
}

async function laufeWorkspaceInitWebhook({ secretId, entfernen, ausfuehren }) {
  if (!entfernen) {
    const urteil = await zielUrteilVomDienst();
    meldeZielUrteil(urteil);
    if (urteil.urteil !== ZIEL_URTEIL.GRUEN) {
      return brichAb([], `Ziel-Urteil ROT (grund=${urteil.grund}) - 0 Aufrufe an ElevenLabs, NICHTS gesendet.`);
    }
  }
  const account = { apiKey, apiBase };
  const vorher = await fetchConvaiSettings({ fetchImpl: fetch, account });
  const koerper = initWebhookKoerper({ secretId, entfernen });
  meldeInitWebhookPlan({ vorher, secretId, entfernen });
  if (!ausfuehren) {
    console.log(
      `${LOG_PREFIX} TROCKENLAUF - nichts gesendet, die Workspace-Settings sind unveraendert. Zum wirklichen Schreiben: ${BESTAETIGUNGS_FLAG} anhaengen.`,
    );
    return 0;
  }
  await patchConvaiSettings({ fetchImpl: fetch, account, body: koerper });
  const nachher = await fetchConvaiSettings({ fetchImpl: fetch, account });
  const befunde = [
    ...initWebhookLesebeleg({ settings: nachher, secretId, entfernen }),
    ...uebrigeSettingsVeraendert(vorher, nachher),
  ];
  if (befunde.length > 0) return brichAb(befunde, "Lesebeleg ROT nach dem Schreiben.");
  console.log(
    `${LOG_PREFIX} OK - Init-Webhook ${entfernen ? "entfernt" : `gesetzt, secret_id ${secretId}`}, zurueckgelesen.`,
  );
  return 0;
}

const istHauptmodul = fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (istHauptmodul) {
  try {
    process.exit(await runCli(process.argv));
  } catch (err) {
    console.error(`${LOG_PREFIX} Abbruch (fail-closed): ${ohneSchluessel(err.message)}`);
    process.exit(1);
  }
}
