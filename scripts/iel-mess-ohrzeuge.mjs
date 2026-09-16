// Die Ohrzeugen-Naht (IEP-P1): Zielsperre, Vorlauf-Pruefung und die sieben Kennzahlen als
// REINE Funktionen. Kein fetch, kein config, keine Datei, keine echte Uhr - alles kommt als
// Argument herein. Nur so ist die Rotprobe der vier Riegel in-process fahrbar (Bestandslehre:
// ein Pruefkommando ohne Positiv-Kontrolle sieht aus wie ein sauberer Lauf).
//
// Die Riegel liefern den GRUND der Verweigerung oder null - der Aufrufer wirft. So bleibt
// dieses Modul frei von der Fehlerklasse des Skripts und in jedem Test direkt pruefbar.

import { deniedPrefix } from "../src/telephony/number-denylist.js";
import { WavFehler, bandAnteil, grundrauschen, huellkurve, leseWav, stilleSegmente, tonSchwelle, tonSegmente } from "./iel-mess-audio.mjs";

// Strenger als die Bestands-E.164-Form (`/^\+\d{8,15}$/`): keine fuehrende 0 nach dem Plus,
// kein Whitespace. Der Ohrzeuge waehlt eine ECHTE Nummer - hier wird nichts nachgesehen.
const E164_STRIKT = /^\+[1-9]\d{7,14}$/;
const STILLE_MIN_MS = 200;
export const KLANG_GRENZE_HZ = 3000;
const MS_JE_S = 1000;
const SEKUNDEN_JE_TAG = 86400;
export const VORLAUF_MAX_ALTER_MS = SEKUNDEN_JE_TAG * MS_JE_S;
export const KOPFRAUM_MIN_CENTS = 500;

// Ein 8-kHz-Schmalbandmitschnitt ist bereits bei ~3,4 kHz gefiltert: der Anteil oberhalb
// KLANG_GRENZE_HZ misst dort den Filterrand, nicht den Klang. Darunter gibt es keine Zahl.
const KLANG_MIN_ABTASTRATE_HZ = 16000;

// Telnyx-Mitschnitt mit channels="dual": Kanal 0 traegt unser Anrufer-Bein (und damit die
// Sprechspur), Kanal 1 die Gegenseite. Die Zuordnung ist im Vorher-Lauf selbst pruefbar -
// unsere Sprechspur MUSS auf KANAL_ANRUFER erscheinen, weil wir ihren Startzeitpunkt kennen.
const KANAL_ANRUFER = 0;
const KANAL_AGENT = 1;

const KONTO_NUMMER_AKTIV = "active";
const EREIGNIS_INITIIERT = "call.initiated";
const EREIGNIS_ANGENOMMEN = "call.answered";
// Namensteile der Telnyx-Ereignisse, die Ton auf die Leitung bringen.
const TON_EREIGNIS_TEILE = Object.freeze(["playback", "tone", "speak"]);
const SPRECHSPUR_KOMMANDO_ENDUNG = "-sprechspur";

// Felder, deren blosse Anwesenheit im Fall einen Anbieter-Schreibzugriff ausloesen wuerde
// (PATCH/POST/DELETE an einer Registrierung). Die Ohrzeugen-Gruppe hat keinen.
const SCHREIB_FELDER = Object.freeze(["digest", "el_registrierung_id", "braucht_setup", "inbound_patch", "registrierung_erwartet"]);

function nichtMessbar(grund) {
  return { messbar: false, grund };
}

// --- Riegel 1-4, fail-closed ---------------------------------------------------------------

// R2 Notaus: der Ohrzeuge waehlt eine echte Nummer, laeuft aber NICHT durch
// src/telephony/outbound-gates.js - ohne diesen Riegel haette der Kill-Switch hier eine
// Luecke (CLAUDE.md Regel 1).
function notausGrund(umgebung) {
  return umgebung?.outboundFrozen === true ? "OUTBOUND_FROZEN steht - Ohrzeuge verweigert vor dem Senden" : null;
}

// R1 Ziel: EIN gepinnter Wert, strikte String-Gleichheit. Kein Praefix-Match, kein Fuzzy,
// keine Normalisierung - und der Mess-Tenant muss der EINZIGE Eintrag der Allowlist sein.
function zielGrund({ fall, pin, umgebung }) {
  if (!pin) return "Ziel-Pin nicht gesetzt - Ohrzeuge verweigert";
  if (!E164_STRIKT.test(fall.ziel_e164 ?? "")) return "ziel_e164 ist keine strikte E.164-Nummer - verweigert";
  if (fall.ziel_e164 !== pin) return "ziel_e164 weicht vom gepinnten Ziel ab - verweigert";
  if (umgebung.inboundScope !== "allowlist" || (umgebung.inboundTenantIds ?? []).length !== 1) {
    return "Mess-Tenant nicht eindeutig gepinnt (ELEVENLABS_INBOUND_SCOPE/-TENANT_IDS) - verweigert";
  }
  return null;
}

// R3 Denylist: DIESELBE Quelle wie die Gate-Kette (src/telephony/number-denylist.js), kein
// Nachbau. deniedPrefix statt isDenied, weil der Ablehnungsgrund den Treffer nennen muss.
function denylistGrund({ ziel, absender }) {
  for (const nummer of [ziel, absender]) {
    const praefix = nummer ? deniedPrefix(String(nummer)) : null;
    if (praefix) return `Denylist-Treffer (${praefix}) - verweigert`;
  }
  return null;
}

// R4 Absender: Pflichtfeld, strikt E.164, nie das Ziel selbst (Selbstanruf ist eine nie
// gemessene Sonderkonfiguration) - und der Fall darf kein Schreibzugriffs-Feld tragen.
function absenderGrund(fall) {
  const absender = fall.anrufer_kennung;
  if (!absender) return "anrufer_kennung fehlt - verweigert";
  if (!E164_STRIKT.test(absender)) return "anrufer_kennung ist keine strikte E.164-Nummer - verweigert";
  if (absender === fall.ziel_e164) return "Absender ist die Ziel-DID (Selbstanruf) - verweigert";
  const schreibFeld = SCHREIB_FELDER.find((feld) => Object.hasOwn(fall, feld));
  if (schreibFeld) return `Ohrzeugen-Gruppe erlaubt keinen Anbieter-Schreibzugriff (${schreibFeld}) - verweigert`;
  return null;
}

/** Die vier Riegel in der Reihenfolge der Kosten einer Verletzung. null = kein Grund zu sperren. */
export function ohrzeugeSperrenGrund({ fall, pin, umgebung }) {
  return (
    notausGrund(umgebung) ??
    zielGrund({ fall, pin, umgebung }) ??
    denylistGrund({ ziel: fall.ziel_e164, absender: fall.anrufer_kennung }) ??
    absenderGrund(fall)
  );
}

// --- Vorlauf-Beleg: die Haelfte, die eine Quelle ausserhalb des Skripts braucht -------------

function vorlaufAlterGrund({ vorlauf, jetztMs }) {
  const belegtMs = Date.parse(vorlauf.belegt_am ?? "");
  if (!Number.isFinite(belegtMs)) return "Vorlauf-Beleg ohne lesbares belegt_am - verweigert";
  const alterMs = jetztMs - belegtMs;
  if (alterMs < 0 || alterMs > VORLAUF_MAX_ALTER_MS) return "Vorlauf-Beleg ist aelter als 24 h oder datiert in der Zukunft - verweigert";
  return null;
}

function vorlaufInhaltGrund({ fall, vorlauf, umgebung }) {
  if (vorlauf.ziel_did !== fall.ziel_e164) return "Vorlauf-Beleg nennt eine andere ziel_did als der Fall - verweigert";
  if (!(umgebung.inboundTenantIds ?? []).includes(vorlauf.tenant_id)) return "Vorlauf-Tenant ist nicht der gepinnte Mess-Tenant - verweigert";
  if (vorlauf.sms_summary_opt_in !== false) return "sms_summary_opt_in ist im Messfenster nicht nachweislich false - verweigert";
  if (vorlauf.private_number_treffer !== false) return "Absender steht womoeglich als private_number - das verfaelscht die Owner-Erkennung - verweigert";
  if (!Number.isInteger(vorlauf.kostendecke_rest_cents) || vorlauf.kostendecke_rest_cents < KOPFRAUM_MIN_CENTS) {
    return `Kopfraum der pro-Tenant-Kostendecke unter ${KOPFRAUM_MIN_CENTS} Cent - verweigert`;
  }
  return null;
}

// Telnyx' filter[phone_number] matcht TEILWEISE - der exakte Vergleich passiert hier.
function kontoTrefferGrund({ kontoNummern, e164, rolle }) {
  const treffer = (kontoNummern?.[e164] ?? []).filter((eintrag) => eintrag?.phone_number === e164 && eintrag?.status === KONTO_NUMMER_AKTIV);
  return treffer.length === 1 ? null : `${rolle} ist keine eindeutig aktive Nummer dieses Kontos (${treffer.length} Treffer) - verweigert`;
}

/** Vorlauf-Beleg und Telnyx-Eigentumsbeleg. null = kein Grund zu sperren. */
export function ohrzeugeVorlaufGrund({ fall, vorlauf, kontoNummern, umgebung, jetztMs }) {
  if (!vorlauf) return "Vorlauf-Beleg fehlt oder ist unlesbar - verweigert";
  return (
    vorlaufAlterGrund({ vorlauf, jetztMs }) ??
    vorlaufInhaltGrund({ fall, vorlauf, umgebung }) ??
    kontoTrefferGrund({ kontoNummern, e164: fall.ziel_e164, rolle: "Ziel" }) ??
    kontoTrefferGrund({ kontoNummern, e164: fall.anrufer_kennung, rolle: "Absender" })
  );
}

// --- Audio-Sicht: die Bruecke von den Roh-Bytes zu den Kennzahlen ---------------------------

function kanalSicht({ proben, abtastrate }) {
  const kurve = huellkurve({ proben, abtastrate });
  const schwelle = tonSchwelle(kurve);
  return {
    ton_segmente: tonSegmente({ huellkurve: kurve, schwelle }),
    stille_segmente: stilleSegmente({ huellkurve: kurve, schwelle, minMs: STILLE_MIN_MS }),
    grundrauschen_dbfs: grundrauschen(kurve),
  };
}

/** Dual-kanaliges WAV in die Segment-Sicht, aus der die Kennzahlen rechnen. Wirft WavFehler. */
export function ohrzeugeAudioSicht(bytes) {
  const { abtastrate, kanaele } = leseWav(bytes);
  if (kanaele.length <= KANAL_AGENT) {
    throw new WavFehler(`Mitschnitt hat ${kanaele.length} Kanal/Kanaele - die Ohrzeugen-Kennzahlen brauchen dual`);
  }
  return {
    abtastrate,
    dauer_ms: Math.round((kanaele[KANAL_ANRUFER].length / abtastrate) * MS_JE_S),
    anrufer: kanalSicht({ proben: kanaele[KANAL_ANRUFER], abtastrate }),
    agent: {
      ...kanalSicht({ proben: kanaele[KANAL_AGENT], abtastrate }),
      band_anteil_oben: bandAnteil({ proben: kanaele[KANAL_AGENT], abtastrate, grenzHz: KLANG_GRENZE_HZ }),
    },
  };
}

// --- Telnyx-Ereignisse ----------------------------------------------------------------------

function nutzlastVon(ereignis) {
  return ereignis.payload?.payload ?? ereignis.payload ?? {};
}

function nameVon(ereignis) {
  return ereignis.name ?? ereignis.type ?? null;
}

function zeitMsVon(ereignis, nutzlast) {
  return Date.parse(ereignis.occurred_at ?? ereignis.event_timestamp ?? nutzlast.occurred_at ?? "");
}

function ereignisSicht(ereignis) {
  const nutzlast = nutzlastVon(ereignis);
  return {
    name: nameVon(ereignis),
    bein: nutzlast.call_leg_id ?? null,
    kommandoId: nutzlast.command_id ?? null,
    zeitMs: zeitMsVon(ereignis, nutzlast),
  };
}

/** Eindampfen auf die vier Angaben, aus denen die Kennzahlen rechnen. */
function ereignisSichten(ereignisse) {
  return (ereignisse ?? []).filter(Boolean).map(ereignisSicht);
}

/** Die EINE Stelle, die die command_id unserer Sprechspur bildet (Skript wie Kennzahl). */
export function sprechspurKommandoId(laufId) {
  return `${laufId}${SPRECHSPUR_KOMMANDO_ENDUNG}`;
}

function istTonEreignis(name) {
  return TON_EREIGNIS_TEILE.some((teil) => String(name ?? "").includes(teil));
}

/** Ton-Ereignisse OHNE unsere eigene Sprechspur - sonst misst Kennzahl (iii) uns selbst. */
export function fremdeTonEreignisse({ ereignisse, laufId }) {
  const eigene = sprechspurKommandoId(laufId);
  return ereignisSichten(ereignisse).filter((sicht) => istTonEreignis(sicht.name) && sicht.kommandoId !== eigene);
}

function zeitVon(sichten, bein, name) {
  const treffer = sichten.find((sicht) => sicht.bein === bein && sicht.name === name && Number.isFinite(sicht.zeitMs));
  return treffer ? treffer.zeitMs : null;
}

// Das GEWAEHLTE Bein ist jedes Bein der Sitzung, das nicht unseres ist.
function gewaehltesBein({ sichten, unserBein }) {
  const beine = [...new Set(sichten.map((sicht) => sicht.bein).filter((bein) => bein && bein !== unserBein))];
  for (const bein of beine) {
    const initiiert = zeitVon(sichten, bein, EREIGNIS_INITIIERT);
    const angenommen = zeitVon(sichten, bein, EREIGNIS_ANGENOMMEN);
    if (initiiert != null && angenommen != null) return { angenommenMs: angenommen, dauerMs: angenommen - initiiert };
  }
  const grund = beine.length === 0 ? "kein gewaehltes Bein in den Sitzungs-Ereignissen" : "gewaehltes Bein ohne call.initiated/call.answered";
  return { angenommenMs: null, dauerMs: null, grund };
}

// --- Die sieben Kennzahlen ------------------------------------------------------------------

// Die Zeitachse: alles im Mitschnitt VOR diesem Versatz lag vor der Annahme des gewaehlten
// Beins - dort kann der Agent noch gar nicht gesprochen haben. Genau das trennt (ii) von (iv).
function annahmeVersatz({ bein, mitschnitt }) {
  if (!mitschnitt.audio) return { grund: mitschnitt.grund ?? "kein auswertbarer Mitschnitt" };
  if (bein.angenommenMs == null) return { grund: bein.grund };
  if (!Number.isFinite(mitschnitt.gestartetMs)) return { grund: "Aufnahme ohne recording_started_at - Zeitachse unbekannt" };
  const ms = bein.angenommenMs - mitschnitt.gestartetMs;
  return ms < 0 ? { grund: "Mitschnitt begann nach der Annahme des gewaehlten Beins" } : { ms };
}

function fremdtonKennzahl({ mitschnitt, versatz }) {
  if (versatz.grund) return nichtMessbar(versatz.grund);
  const { agent } = mitschnitt.audio;
  const vorher = agent.ton_segmente.filter((segment) => segment.startMs < versatz.ms);
  return {
    ja: vorher.length > 0,
    erster_ton_ms: vorher[0]?.startMs ?? null,
    dauer_ms: vorher.reduce((summe, segment) => summe + segment.dauerMs, 0),
    fenster_ms: versatz.ms,
  };
}

function tonereignisKennzahl({ ereignisse, laufId }) {
  const fremde = fremdeTonEreignisse({ ereignisse, laufId });
  return { ja: fremde.length > 0, anzahl: fremde.length, namen: [...new Set(fremde.map((sicht) => sicht.name))] };
}

// M-S2: vom 200 OK des gewaehlten Beins bis zur ersten Silbe, die dahinter zu hoeren ist.
function ersteAgentenSilbeKennzahl({ mitschnitt, versatz }) {
  if (versatz.grund) return nichtMessbar(versatz.grund);
  const { agent } = mitschnitt.audio;
  const erste = agent.ton_segmente.find((segment) => segment.startMs >= versatz.ms);
  return erste ? erste.startMs - versatz.ms : nichtMessbar("keine Agenten-Silbe nach der Annahme im Mitschnitt");
}

function stilleKennzahl({ mitschnitt, versatz }) {
  if (versatz.grund) return nichtMessbar(versatz.grund);
  const { agent } = mitschnitt.audio;
  return agent.stille_segmente
    .filter((segment) => segment.startMs >= versatz.ms)
    .reduce((laengste, segment) => Math.max(laengste, segment.dauerMs), 0);
}

function turnLueckenKennzahl(mitschnitt) {
  if (!mitschnitt.audio) return nichtMessbar(mitschnitt.grund ?? "kein auswertbarer Mitschnitt");
  const { anrufer, agent } = mitschnitt.audio;
  const luecken = [];
  for (const spur of anrufer.ton_segmente) {
    const antwort = agent.ton_segmente.find((segment) => segment.startMs >= spur.endeMs);
    if (antwort) luecken.push(antwort.startMs - spur.endeMs);
  }
  return luecken.length > 0 ? luecken : nichtMessbar("weniger als zwei Turns im Mitschnitt");
}

function klangKennzahl(mitschnitt) {
  if (!mitschnitt.audio) return nichtMessbar(mitschnitt.grund ?? "kein auswertbarer Mitschnitt");
  const { abtastrate, agent } = mitschnitt.audio;
  if (abtastrate < KLANG_MIN_ABTASTRATE_HZ) {
    return nichtMessbar(`Abtastrate ${abtastrate} Hz - oberhalb ${KLANG_GRENZE_HZ} Hz liegt nur der Filterrand`);
  }
  if (agent.band_anteil_oben == null) return nichtMessbar("zu wenig Audio fuer die Bandanalyse");
  return { band_anteil_oben: agent.band_anteil_oben, grundrauschen_dbfs: agent.grundrauschen_dbfs, abtastrate };
}

/**
 * Die sieben Kennzahlen je Lauf. Jede ist entweder beziffert oder traegt ihren Grund -
 * "nicht messbar" wird NIE als 0 ausgegeben.
 * @param {{audio: object|null, grund?: string, gestartetMs: number}} mitschnitt
 * @param {{ereignisse: object[], laufId: string, unserBein: string|null}} lauf
 */
export function ohrzeugeKennzahlen({ mitschnitt, lauf }) {
  const sichten = ereignisSichten(lauf.ereignisse);
  const bein = gewaehltesBein({ sichten, unserBein: lauf.unserBein });
  const versatz = annahmeVersatz({ bein, mitschnitt });
  return {
    annahme_ms: bein.dauerMs ?? nichtMessbar(bein.grund),
    fremdton_vor_hermes: fremdtonKennzahl({ mitschnitt, versatz }),
    tonereignisse: tonereignisKennzahl({ ereignisse: lauf.ereignisse, laufId: lauf.laufId }),
    erste_agenten_silbe_ms: ersteAgentenSilbeKennzahl({ mitschnitt, versatz }),
    laengste_stille_ms: stilleKennzahl({ mitschnitt, versatz }),
    turn_luecken_ms: turnLueckenKennzahl(mitschnitt),
    klang: klangKennzahl(mitschnitt),
  };
}
