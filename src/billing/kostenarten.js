// KV2-2 (tasks/PLAN-KOSTEN-V2.md Abschnitt 3, tasks/kostenv2/spec-kv2-2.md): der
// Kostenarten-KATALOG (welche Anbieter-Ausgabe existiert) und die Kostenprofil-REGISTRY
// (welches Profil welchen Traeger mit welchem Einsammler fuehrt). Muster woertlich
// src/billing/cost-ledger-map.js: Pflichtfelder OHNE Default, Validierung beim
// MODUL-IMPORT (nicht erst im Testlauf), Object.freeze auf jeder Ebene.
//
// IMPORT-FREI VON src/-FACHMODULEN MIT EIGENEM ZYKLUS-RISIKO: diese Datei wird von
// src/store/state-ops.js gelesen (recordCostProfile) - ein Import aus dem Telnyx-Adapter
// oder aus store/defaults.js waere ein Zyklus in den Store-Graph. Die record_type-Menge
// von Katalogzeile #3 wird deshalb explizit gefuehrt statt importiert; Kriterium (g)
// (test/kv2-2-kostenarten-katalog.test.js) pinnt sie GEGEN den Export aus
// telephony/adapters/telnyx/voice.js, damit sie keine unbeobachtete Kopie werden kann.
//
// VERHAELTNIS ZU cost-ledger-map.js (Kopfkommentar-Pflicht dieser Phase): cost-ledger-map
// ist die IST-BUCHUNGSLANDKARTE ("welcher Weg ist heute verdrahtet" - ledger/gate als
// Booleans je Kostenart, sieben Zeilen). DIESE Datei ist der Kostenarten-KATALOG ("welche
// Anbieter-Ausgabe existiert ueberhaupt" - 17 Zeilen, inklusive Arten ohne jeden
// Buchungsweg) plus die Profil-Registry der Engine-Weiche. Ueberlappende IDs zwischen
// beiden Tabellen: ai_token, research_fee, sms (identischer Name, gleiche Kostenart,
// zwei verschiedene Fragen); play_tts_characters (cost-ledger-map) entspricht
// eigen_tts_zeichen (hier); number_month (cost-ledger-map) entspricht did_miete (hier).
// Ein Zusammenlegen beider Tabellen ist eine eigene Entscheidung, kein Nebeneffekt dieser
// Phase (Abschnitt 6 der Spec, "Was diese Phase NICHT tut").
//
// KERNREGEL (Pflicht fuer jede folgende Bau-Phase, Abschnitt 6.4 des Plans): jede
// Anbieter-Ausgabe bekommt eine Katalogzeile, BEVOR sie live geht - das ist der einzige
// wirksame Schutz gegen eine still unvollstaendige Kostenlandkarte. Die Zeilenmenge (d)
// ist ein Loeschschutz, KEIN Vollstaendigkeitsbeweis: sie friert die heute bekannte Menge
// ein, findet aber keine kuenftig vergessene Zeile.

// Waehrungen, die das Settlement (4.5) verarbeitet, OHNE die Zeile fail-closed zu
// verwerfen (3.4: EIN Kurs-Pfad, Provider-Mikro-Cent USD -> Bucket-Cent EUR). Nur Zeilen
// mit pflicht:true muessen eine dieser beiden tragen (s. pruefeKostenart).
export const WAEHRUNG_HART = Object.freeze(["USD", "EUR"]);

// Die 17 Kostenarten-IDs (Abschnitt 3.2/3.3). Numerische Reihenfolge der Kommentare
// spiegelt die Katalog-# aus dem Plan (IDs, keine Sortierung - s. Zeilen #14/#16/#17).
export const KOSTENART = Object.freeze({
  ELEVENLABS_CONVAI: "elevenlabs_convai", // #1
  TELNYX_SIP: "telnyx_sip", // #2
  TELNYX_CALL_RECORDS: "telnyx_call_records", // #3
  AI_TOKEN: "ai_token", // #4
  RESEARCH_FEE: "research_fee", // #5
  SMS: "sms", // #6
  EIGEN_TTS_ZEICHEN: "eigen_tts_zeichen", // #7
  EL_GRUNDGEBUEHR: "el_grundgebuehr", // #8
  EL_CREDIT_KONTINGENT: "el_credit_kontingent", // #9
  DID_MIETE: "did_miete", // #10
  NUMMERN_EINKAUF: "nummern_einkauf", // #11
  STRIPE_GEBUEHR: "stripe_gebuehr", // #12
  INFRASTRUKTUR: "infrastruktur", // #13
  OPENAI_REALTIME: "openai_realtime", // #14
  TELNYX_INFERENCE: "telnyx_inference", // #15
  MAIL_ZUSAMMENFASSUNG: "mail_zusammenfassung", // #16
  WORKOS_AUTH: "workos_auth", // #17
});

// Die 5 Kostenprofile der Engine-Weiche (4.3, Tabelle in spec-kv2-2.md).
export const KOSTENPROFIL = Object.freeze({
  EL_CONVAI_SIP: "el_convai_sip",
  TELNYX_ASSISTANT: "telnyx_assistant",
  TELNYX_BUDGET: "telnyx_budget",
  TELNYX_INBOUND_BUDGET: "telnyx_inbound_budget",
  TELNYX_INBOUND_REALTIME: "telnyx_inbound_realtime",
});

// Phasenkennungen, die einen Beleg-Einsammler bauen bzw. der eine ausdrueckliche
// Nicht-Belegpflicht (Owner-Entscheidung 9, openai_realtime in telnyx_inbound_realtime).
export const EINSAMMLER = Object.freeze({
  KV2_4: "KV2-4",
  KV2_5: "KV2-5",
  KV2_5G: "KV2-5g",
  NICHT_BELEGPFLICHTIG: "nicht_belegpflichtig",
});

// Richtung eines Anrufs, wie call.direction sie fuehrt (metering.js nutzt denselben Wert).
const RICHTUNG_INBOUND = "inbound";

// Die Pflicht-Typmenge (das Vollstaendigkeits-Praedikat in classifyRecords) wird ab KV2-5
// JE PROFIL beantwortet statt global. ZWEI Auspraegungen, mehr gibt es nicht:
//
// AUS_ENV: die Menge kommt weiterhin aus COST_TRUING_REQUIRED_RECORD_TYPES. Fuer die vier
//   Telnyx-Profile ist das der HEUTIGE Live-Wert (sip-trunking,call-control) - die
//   Umstellung macht die Menge nur ADRESSIERBAR, sie verschiebt sie nicht (Spec (f)).
//   Deshalb steht hier ein Marker und KEIN Literal: ein Literal waere eine zweite,
//   still veraltende Wahrheit neben der Produktionsumgebung, und der Boot-Waechter gegen
//   die leere Menge (boot-guard.js) haengt an genau dieser Env-Variable.
//
// AUSDRUECKLICH VERBOTEN ist die Ableitung dieser Menge aus KOSTENARTEN[...].belegtypen
// (Katalogzeile #3). Jene Menge benennt die BETRAGSTRAGENDEN Records (alle sechs
// zuordenbaren Typen), nicht das Vollstaendigkeits-Praedikat. Eine Ableitung machte
// `complete` fuer JEDEN Bestandsanruf unwahr - refundProven erstattete nie mehr, die heute
// funktionierende Erstattung (56/56) waere still tot. Die Gegenrichtung (Verengung auf
// call-control) lockerte die Erstattungsbedingung. Beide widersprechen (b)/(f).
export const PFLICHTTYPEN_AUS_ENV = "aus_env_pflichtmenge";

// UNGEMESSEN: die Menge ist fuer dieses Profil noch nicht am Anbieter gemessen. Die LEERE
// Menge ist die fail-closed Antwort - classifyRecords liefert darueber niemals
// 'telnyx_detail_records' ("nichts bewiesen", nicht "alles erlaubt"). Kein geratener Wert,
// kein Uebernehmen des Env-Werts "weil er naheliegt" (Spec (d), Fehlschlag-Zweig).
export const PFLICHTTYPEN_UNGEMESSEN = Object.freeze([]);

// Je EIN Pflichtfeld-Check (G30/G34: eine Aufgabe pro Funktion, haelt
// pruefeKostenart unterhalb der Komplexitaets-Obergrenze). Nicht exportiert - reine
// Bausteine von pruefeKostenart, kein eigener Aufrufer.
function pruefeNichtLeererString(name, feld, wert) {
  if (typeof wert !== "string" || !wert.trim())
    throw new Error(`kostenarten: '${name}'.${feld} fehlt oder ist leer`);
}

function pruefeBelegtypen(name, belegtypen) {
  if (belegtypen === undefined) return; // optional (nur Katalogzeile #3 traegt es)
  const gueltig =
    Array.isArray(belegtypen) &&
    belegtypen.length > 0 &&
    belegtypen.every((belegtyp) => typeof belegtyp === "string" && belegtyp.trim());
  if (!gueltig) throw new Error(`kostenarten: '${name}'.belegtypen ist kein nicht-leeres String-Array`);
}

// Kriterium (a): die vier Pflichtfelder OHNE Default, plus zwei Formregeln. Wirft beim
// MODUL-IMPORT (s. Validierungsschleife unten), nie erst im Testlauf - Praefix
// "kostenarten:" wie cost-ledger-map.js "cost-ledger-map:".
export function pruefeKostenart(name, zeile) {
  pruefeNichtLeererString(name, "quelle", zeile.quelle);
  pruefeNichtLeererString(name, "waehrung", zeile.waehrung);
  pruefeNichtLeererString(name, "preisquelle", zeile.preisquelle);
  if (typeof zeile.pflicht !== "boolean")
    throw new Error(`kostenarten: '${name}'.pflicht fehlt oder ist kein Boolean`);
  if (zeile.pflicht === true && !WAEHRUNG_HART.includes(zeile.waehrung))
    throw new Error(
      `kostenarten: '${name}' ist belegpflichtig, traegt aber keine harte Waehrung (USD|EUR)`,
    );
  pruefeBelegtypen(name, zeile.belegtypen);
}

// Ein einzelnes Traeger-Paar innerhalb eines Profils (Baustein von pruefeProfil,
// nicht exportiert - haelt pruefeProfil unterhalb der Komplexitaets-Obergrenze).
function pruefeTraegerEinsammler(profilName, traeger, eintrag) {
  if (!Object.hasOwn(KOSTENARTEN, traeger))
    throw new Error(`kostenarten: Profil '${profilName}' fuehrt Traeger '${traeger}' ohne Katalogzeile`);
  const einsammler = eintrag?.einsammler;
  if (typeof einsammler !== "string" || !Object.values(EINSAMMLER).includes(einsammler))
    throw new Error(
      `kostenarten: Profil '${profilName}', Traeger '${traeger}' - einsammler fehlt, ist leer oder ` +
        "ein freier dritter Wert (erlaubt: eine Phasenkennung dieser Kette oder 'nicht_belegpflichtig')",
    );
}

// KV2-5: die Pflicht-Typmenge EINES Profils darf nur drei Formen annehmen - der Env-
// Marker, der UNGEMESSEN-Marker oder ein eingefrorenes, nicht-leeres String-Array. Eine
// LEERE Menge ist damit nur ueber die benannte Konstante erreichbar, niemand kann sie
// versehentlich hinschreiben.
function pruefePflichttypen(name, pflichttypen) {
  if (pflichttypen === PFLICHTTYPEN_AUS_ENV) return;
  if (pflichttypen === PFLICHTTYPEN_UNGEMESSEN) return;
  const gueltig =
    Array.isArray(pflichttypen) &&
    Object.isFrozen(pflichttypen) &&
    pflichttypen.length > 0 &&
    pflichttypen.every((typ) => typeof typ === "string" && typ.trim());
  if (!gueltig)
    throw new Error(
      `kostenarten: Profil '${name}'.pflichttypen ist weder der Env-Marker noch die ` +
        "ausdrueckliche UNGEMESSEN-Menge noch ein eingefrorenes, nicht-leeres String-Array",
    );
}

// Kriterium (i): jedes Profil-Traeger-Paar traegt einen benannten Einsammler oder
// ausdruecklich "nicht_belegpflichtig" - ein fehlender, leerer oder freier dritter Wert
// reisst den Import ab, wie (a) es fuer die Katalogzeilen tut.
export function pruefeProfil(name, profil) {
  if (typeof profil?.traeger !== "object" || profil.traeger === null || Array.isArray(profil.traeger))
    throw new Error(`kostenarten: Profil '${name}'.traeger ist kein Objekt`);
  const traegerNamen = Object.keys(profil.traeger);
  if (traegerNamen.length === 0) throw new Error(`kostenarten: Profil '${name}'.traeger ist leer`);
  for (const traeger of traegerNamen) pruefeTraegerEinsammler(name, traeger, profil.traeger[traeger]);
  pruefePflichttypen(name, profil.pflichttypen);
}

// Die record_type-Menge des Telnyx-Adapters (Katalogzeile #3), EXPLIZIT gefuehrt statt
// importiert (Kopfkommentar: Import-Freiheit von src/telephony/*). Kriterium (g) pinnt
// diese Menge in test/kv2-2-kostenarten-katalog.test.js GEGEN den echten Export
// ASSIGNABLE_COST_RECORD_TYPES (src/telephony/adapters/telnyx/voice.js) auf
// Mengengleichheit - eine Abweichung reisst dort den Test, nicht diesen Import.
// KV2-9: der EINE Belegtyp, den ein EL-Anruf bei Telnyx erzeugt (M-1,
// tasks/kostenv2/befunde-kette.md). Explizit gefuehrt statt aus
// sweep-kostenbeleg.js#SIP_TRUNKING_RECORD_TYPE importiert: diese Datei ist bewusst
// import-frei von src/-Fachmodulen mit Zyklus-Risiko (s. Kopfkommentar); die Gleichheit
// beider Werte pinnt test/kv2-9-el-reifung.test.js gegen den echten Export.
const SIP_TRUNKING_BELEGTYP = "sip-trunking";

const TELNYX_CALL_RECORDS_BELEGTYPEN = Object.freeze([
  "sip-trunking",
  "call-control",
  "speech-to-text",
  "text-to-speech",
  "recording",
  "ai-voice-assistant",
]);

// Der Kostenarten-KATALOG - 17 Zeilen (Kriterium (d): Loeschschutz, kein
// Vollstaendigkeitsbeweis, s. Kopfkommentar KERNREGEL). Jede Zeile entspricht der
// gleichnamigen Nummer in tasks/PLAN-KOSTEN-V2.md Abschnitt 3.2/3.3.
export const KOSTENARTEN = Object.freeze({
  [KOSTENART.ELEVENLABS_CONVAI]: {
    quelle: "ElevenLabs, GET /v1/convai/conversations/{conversation_id}, metadata.cost_fiat",
    waehrung: "USD",
    pflicht: true,
    preisquelle:
      "Anbieter-Ist, synchron am Gespraechsende (persistProviderResult, " +
      "elevenlabs/outbound.js). Waehrung BELEGT: GET /v1/user/subscription -> " +
      "currency:\"usd\" (befund-elevenlabs.md 3). Gemessen ueber 8 Anrufe: " +
      "0,0099-0,1333 USD je Anruf, 11,81 US-ct/min im Schnitt (AUFTRAG B2).",
  },
  [KOSTENART.TELNYX_SIP]: {
    quelle:
      "Telnyx, GET /v2/detail_records?filter[record_type]=sip-trunking, Betrag cost, " +
      "Join raw.sip_call_id === call.sipCallId",
    waehrung: "USD",
    pflicht: true,
    preisquelle:
      "Anbieter-Ist, verzoegert (COST_TRUING_DELAY_MINUTES). Waehrung BELEGT: " +
      "currency=\"USD\" auf allen 13 gemessenen Records (befund-telnyx.md O2). " +
      "Gemessen: 4,01 US-ct/min DE-Mobilfunk, 2,31 US-ct/min DE-Festnetz, immer auf " +
      "volle Minute aufgerundet.",
  },
  [KOSTENART.TELNYX_CALL_RECORDS]: {
    quelle:
      "Telnyx, detail_records, Summe aller zuordenbaren record_type-Werte je Anruf " +
      "(ASSIGNABLE_COST_RECORD_TYPES, telephony/adapters/telnyx/voice.js)",
    waehrung: "USD",
    pflicht: true,
    belegtypen: TELNYX_CALL_RECORDS_BELEGTYPEN,
    preisquelle:
      "Anbieter-Ist, Bestand: 56 von 56 Anrufen im Telnyx-Zeitraum abgeglichen " +
      "(AUFTRAG B1). belegtypen ist die TRAEGER-ZUORDNUNG (welche Records den Betrag " +
      "tragen), NICHT die Pflicht-Typmenge aus COST_TRUING_REQUIRED_RECORD_TYPES (die " +
      "steht separat, config.billing.costTruingRequiredRecordTypes) - beide zu " +
      "verwechseln setzt die Erstattungsbedingung falsch (in beide Richtungen, s. " +
      "Kommentar an der Konstante).",
  },
  [KOSTENART.AI_TOKEN]: {
    quelle: "eigen, meterAiTokens (llm-usage.js) -> trackUsage -> bookCents (state-ops.js)",
    waehrung: "Bucket (EUR-Cent)",
    pflicht: false,
    preisquelle:
      "Konfigurierte Modellpreise (config.llm.modelPricesUsd), KEIN Anbieter-Ist - " +
      "eine Preisdrift beim LLM-Anbieter ist auf dieser Achse unbeobachtet (offener " +
      "Punkt, Abschnitt 9). Faellt AUCH auf dem EL-Weg an: Precall-Briefing, " +
      "Eroeffnungssatz und der summarizeCall-Rueckfall buchen alle drei ausserhalb der " +
      "Turn-Schleife auf dieselbe Gate-Achse (bookTokenUsage/bookEstimatedTokenUsage).",
  },
  [KOSTENART.RESEARCH_FEE]: {
    quelle: "eigen, addResearchFeeCostCents (state-ops.js), Aufrufer llm-usage.js",
    waehrung: "Bucket (EUR-Cent)",
    pflicht: false,
    preisquelle:
      "Konfigurationswert (Exa-Suchgebuehr), kein Anbieter-Beleg noetig. Faellt AUCH " +
      "auf dem EL-Weg an (routes/webhooks-elevenlabs.js bucht live waehrend eines " +
      "EL-Gespraechs).",
  },
  [KOSTENART.SMS]: {
    quelle: "eigen, config.billing.smsCostCents (Default 0), Versand vor Buchung (call-finish.js)",
    waehrung: "Bucket (EUR-Cent)",
    pflicht: false,
    preisquelle:
      "Konfigurationswert ohne Anbieterbeleg, Default 0 - kein Fail-closed, ein " +
      "fehlender Preis ist hier lautlos 0.",
  },
  [KOSTENART.EIGEN_TTS_ZEICHEN]: {
    quelle: "eigen, recordTtsCharacters (state-ops.js), zaehlt Zeichen je Tenant",
    waehrung: "USD",
    pflicht: false,
    preisquelle:
      "GEMESSEN 2026-08-31, GET /v1/user/subscription (ElevenLabs, Konto der Phase " +
      "KV2-2): EIN gemeinsamer Kontingent-Zaehler auf Kontoebene " +
      "(character_count/character_limit, zum Messzeitpunkt 34530/63996, tier " +
      "\"starter\"), currency:\"usd\". Der Endpunkt fuehrt KEINE getrennte " +
      "ConvAI-Groesse - <Play>-Zeichen (dieser Pfad) und ConvAI-Verbrauch ziehen also " +
      "aus DEMSELBEN Kontingent, kein zweiter Zaehler existiert. Der " +
      "Ueberschreitungspreis je Zeichen ist am Endpunkt NICHT ausgewiesen " +
      "(current_overage.amount war zum Messzeitpunkt \"0\") - offener Punkt " +
      "Abschnitt 9, wenn ein Beleg-Einsammler je gebaut wird.",
  },
  [KOSTENART.EL_GRUNDGEBUEHR]: {
    quelle: "ElevenLabs, GET /v1/user/subscription, next_invoice.subtotal_cents",
    waehrung: "USD",
    pflicht: false,
    preisquelle:
      "Anbieter-Ist, monatlich: 600 US-Cent (befund-elevenlabs.md 3), Plan " +
      "\"starter\". Reine Anzeige (PLATFORM_FIXED_COST_CENTS_PER_MONTH), kein " +
      "Tenant-Gate. Nebenbefund: der Live-Wert wird in api-billing.js als EUR-Cent " +
      "angezeigt, obwohl die ElevenLabs-Rechnung auf US-Cent lautet - zu bereinigen " +
      "in KV2-10.",
  },
  [KOSTENART.EL_CREDIT_KONTINGENT]: {
    quelle:
      "ElevenLabs, charging.free_minutes_consumed / free_llm_dollars_consumed (Detailfeld " +
      "an Belegzeile elevenlabs_convai)",
    waehrung: "Credits",
    pflicht: false,
    preisquelle:
      "Listenpreis vs. Zahlungsstrom: in allen 8 gemessenen Anrufen 0 verbrauchte " +
      "Freikredits (AUFTRAG B2). Kein eigener Gate-/Buch-Weg, nur Detailfeld.",
  },
  [KOSTENART.DID_MIETE]: {
    quelle: "Telnyx-Nummernpreis am Nummern-Datensatz (number.monthlyCostCents)",
    waehrung: "USD",
    pflicht: false,
    preisquelle:
      "Anbieter-gelernter Preis beim Kauf (Owner-Entscheidung 2026-07-27, KEIN " +
      "Fallback). Erloes-Buch ja (kind NUMBER_MONTH), Gate nein. Heute traegt keine " +
      "reale Nummer einen gelernten Preis.",
  },
  [KOSTENART.NUMMERN_EINKAUF]: {
    quelle: "heute nirgends erfasst",
    waehrung: "keine - heute nirgends erfasst",
    pflicht: false,
    preisquelle:
      "Luecke, benannt statt gebaut: numberSetupFeeCents ist der Preis, den WIR " +
      "nehmen, nicht der, den wir zahlen. Bleibt ausserhalb dieser Kette.",
  },
  [KOSTENART.STRIPE_GEBUEHR]: {
    quelle: "Stripe, Gebuehrenzeile je Zahlung (Balance-Transaction)",
    waehrung: "Waehrung der jeweiligen Zahlung",
    pflicht: false,
    preisquelle:
      "Heute in keinem Code gelesen. Real, eindeutig einem Tenant zuzuordnen, " +
      "anbieterbelegt - waechst mit dem Produkterfolg, gehoert aber nicht auf die " +
      "Gespraechs-Gate-Achse (entsteht nicht im Anruf). Preisherleitung waere eine " +
      "eigene Kette.",
  },
  [KOSTENART.INFRASTRUKTUR]: {
    quelle: "Render, Postgres, Domains - keine API-Quelle im System",
    waehrung: "keine - Gemeinkosten ohne Verursacher je Anruf",
    pflicht: false,
    preisquelle: "Preisbildungs-Eingabe (was muss ein Abo kosten), keine Verbrauchskosten.",
  },
  [KOSTENART.OPENAI_REALTIME]: {
    quelle:
      "OpenAI Realtime API, WebSocket wss://api.openai.com/v1/realtime, Modell " +
      "config.voice.realtimeModel (Default gpt-realtime)",
    waehrung: "USD",
    pflicht: false,
    preisquelle:
      "GEMESSEN 2026-08-31, OpenAI-Modellpreisliste (developers.openai.com, Modell " +
      "gpt-realtime): Text-Input 4 USD/1M Token, Text-Output 16 USD/1M Token, " +
      "Audio-Input 32 USD/1M Token, Audio-Output 64 USD/1M Token. Owner-Entscheidung 9 " +
      "(2026-08-30): NICHT verwendet, nur katalogisiert - kein Einsammler, kein " +
      "Buchungsweg (Riegel KV2-2(h) sichert genau diese Luecke ab). Ob und in welchem " +
      "Ereignis die Sitzung einen VERBRAUCHS-Betrag liefert (response.done, " +
      "bridge.js:383 liest heute keinen), bleibt offener Punkt Abschnitt 9 - nur fuer " +
      "einen kuenftigen Einsammler relevant.",
  },
  [KOSTENART.TELNYX_INFERENCE]: {
    quelle: "Telnyx, detail_records, record_type=inference, Betrag cost",
    waehrung: "USD",
    pflicht: false,
    preisquelle:
      "Anbieter-Ist waere abrufbar, aber STRUKTURELL nicht zuordenbar - der Typ " +
      "traegt weder call_control_id noch ein Session-Feld, nur conversation_id " +
      "(UNASSIGNABLE_COST_RECORD_TYPES, voice.js). Ob dieser Typ auf dem Konto " +
      "ueberhaupt Betraege traegt, ist ungemessen (offener Punkt Abschnitt 9, zu " +
      "klaeren in KV2-5(d)).",
  },
  [KOSTENART.MAIL_ZUSAMMENFASSUNG]: {
    quelle:
      "Anbieterdienst, ZWEI moegliche Kanaele (Brevo HTTP vor SMTP, selectMailer, " +
      "wiring/web-login.js), Ausloeser call-finish.js je beendetem Anruf",
    waehrung: "USD",
    pflicht: false,
    preisquelle:
      "GEMESSEN 2026-08-31, oeffentliche Brevo-Preisliste: Transactional-Einstieg " +
      "\"Starter\" 9 USD/Monat fuer 5.000 E-Mails. Welcher Kanal in PRODUKTION aktiv " +
      "ist, konnte diese Session NICHT bestaetigen - der Render-Log-Abruf " +
      "(mail-boot-probe.js-Boot-Zeile) braucht eine Workspace-Bestaetigung, die eine " +
      "nicht-interaktive Session nicht einholen kann; benannter offener Punkt " +
      "Abschnitt 9, kein leeres Feld. Indiz aus dem Repo (.env.example: Render sperrt " +
      "SMTP auf dem kostenlosen Plan): Brevo ist der wahrscheinliche Live-Kanal. " +
      "Owner-Entscheidung 15 (2026-08-30 nicht ausdruecklich entschieden, Default " +
      "\"nur katalogisieren\"): kein Einsammler in dieser Phase.",
  },
  [KOSTENART.WORKOS_AUTH]: {
    quelle:
      "WorkOS (User-Management/AuthKit), Konto-Rechnung des Identitaets-Anbieters - kein " +
      "Betrags-Endpunkt im Repo",
    waehrung: "USD",
    pflicht: false,
    preisquelle:
      "GEMESSEN 2026-08-31, oeffentliche WorkOS-Preisliste (workos.com/pricing): " +
      "erste 1 Mio. monatlich aktive Nutzer (MAU) kostenlos, danach 2.500 USD je " +
      "weiterer 1 Mio. MAU. Kein Traeger irgendeines Profils (Abschnitt 8, Punkt 16) - " +
      "die Gebuehr entsteht an der Nutzeridentitaet, nicht im Anruf.",
  },
});

// Die 5 Kostenprofile der Engine-Weiche (4.3). traeger je Profil traegt den
// Pflicht-Einsammler (Kriterium (i)).
export const KOSTENPROFILE = Object.freeze({
  [KOSTENPROFIL.EL_CONVAI_SIP]: {
    // KV2-5(d), GEMESSEN am 2026-08-31 gegen die Prod-DB und die echte Telnyx-API
    // (tasks/kostenv2/befunde-kette.md, M-1): GET /v2/detail_records, last_7_days liefert
    // sip-trunking 7 Belege, call-control/inference/amd/conference/media_storage je 0 -
    // und die 7 sip_call_id-Werte sind exakt die sieben juengsten Prod-DB-Anrufe. Dass
    // dieselbe Abfrage fuer einen Typ Treffer und fuer alle anderen Null liefert, IST die
    // Positiv-Kontrolle: die Nullen sind echte Nullen, keine leere Suche. Ein EL-Anruf
    // erzeugt keinen call-control-Beleg - ElevenLabs fuehrt die Medien, nicht Telnyx.
    // Der frueher hier notierte Grund fuer PFLICHTTYPEN_UNGEMESSEN ("Praefixe aus dem
    // Anbieter-Fenster gealtert") war falsch: die betroffenen Anrufe tragen ueberhaupt
    // keine call_control_id, die Kontrolle ueber dieses Feld war strukturell unmoeglich.
    pflichttypen: Object.freeze([SIP_TRUNKING_BELEGTYP]),
    traeger: {
      [KOSTENART.ELEVENLABS_CONVAI]: { einsammler: EINSAMMLER.KV2_4 },
      [KOSTENART.TELNYX_SIP]: { einsammler: EINSAMMLER.KV2_5 },
    },
  },
  [KOSTENPROFIL.TELNYX_ASSISTANT]: {
    pflichttypen: PFLICHTTYPEN_AUS_ENV,
    traeger: { [KOSTENART.TELNYX_CALL_RECORDS]: { einsammler: EINSAMMLER.KV2_5G } },
  },
  // Owner-Entscheidung 10 (Default, nicht ausdruecklich entschieden): api-calls.js
  // verzweigt im TeXML-Zweig NICHT auf die Engine (die Weiche faellt erst im Webhook,
  // voice.js:476) - dieses Profil deckt deshalb heute BEIDE Outbound-Engines ab.
  [KOSTENPROFIL.TELNYX_BUDGET]: {
    pflichttypen: PFLICHTTYPEN_AUS_ENV,
    traeger: { [KOSTENART.TELNYX_CALL_RECORDS]: { einsammler: EINSAMMLER.KV2_5G } },
  },
  [KOSTENPROFIL.TELNYX_INBOUND_BUDGET]: {
    pflichttypen: PFLICHTTYPEN_AUS_ENV,
    traeger: { [KOSTENART.TELNYX_CALL_RECORDS]: { einsammler: EINSAMMLER.KV2_5G } },
  },
  // telnyx_inbound_realtime bekommt KEIN Literal: sein zusaetzlicher Traeger
  // openai_realtime ist nicht_belegpflichtig (Owner-Entscheidung 9) und geht gar nicht in
  // eine Pflichtmenge ein; fuer den Telnyx-Anteil gilt derselbe Env-Wert (Spec (f)).
  [KOSTENPROFIL.TELNYX_INBOUND_REALTIME]: {
    pflichttypen: PFLICHTTYPEN_AUS_ENV,
    traeger: {
      [KOSTENART.TELNYX_CALL_RECORDS]: { einsammler: EINSAMMLER.KV2_5G },
      // Owner-Entscheidung 9 (2026-08-30): katalogisiert, kein Einsammler - der einzige
      // heute vergebene nicht_belegpflichtig-Wert. Riegel KV2-2(h) sichert ab, dass der
      // Schalter ohne diese Zeile nicht startet.
      [KOSTENART.OPENAI_REALTIME]: { einsammler: EINSAMMLER.NICHT_BELEGPFLICHTIG },
    },
  },
});

// Kriterium (c)/istBekanntesKostenprofil: reines Praedikat (N7, keine Nebeneffekte) -
// der Mutator recordCostProfile (state-ops.js) prueft einen gesetzten Wert dagegen.
export function istBekanntesKostenprofil(wert) {
  return Object.hasOwn(KOSTENPROFILE, wert);
}

// Die Pflicht-Typmenge EINES Profils. envPflichttypen ist config.billing.
// costTruingRequiredRecordTypes - der Aufrufer reicht sie herein, weil diese Datei
// KEINE Config importiert (Zyklus-Freiheit, s. Kopfkommentar). Unbekanntes Profil ->
// LEERE Menge (fail-closed: "nichts bewiesen"), nie der Env-Wert als Trostpreis.
export function pflichttypenFuerProfil(profil, envPflichttypen) {
  const eintrag = KOSTENPROFILE[profil]?.pflichttypen;
  if (eintrag === PFLICHTTYPEN_AUS_ENV) return envPflichttypen;
  return Array.isArray(eintrag) ? eintrag : PFLICHTTYPEN_UNGEMESSEN;
}

// Das Kostenprofil eines Anrufs OHNE gesetztes costProfile (Altzeile von VOR dieser
// Kette). sipCallId entscheidet, und diese Fallunterscheidung ist NICHT kosmetisch: sie
// ist der Riegel gegen eine ungewollte Erstattung an den 12 EL-Altanrufen. Der
// sipCallId-Join aus KV2-5 macht sie erstmals abrufbar (12/12 ohne call_control_id, ohne
// cost_trued_at, 0 Versuche, Summe estimated_cost_cents 270 - lesend an der Produktions-DB
// gemessen 2026-08-30). Fielen sie auf telnyx_budget, griffe der EL-Schutz nicht und ihre
// 30-ct-Schaetzung wuerde auf den reinen SIP-Anteil heruntergesetzt: die B6-Falle.
// Owner-Entscheidung 14, DEFAULT (a) uebernommen - nicht ausdruecklich entschieden.
export function legacyKostenprofil({ sipCallId, direction }) {
  if (sipCallId) return KOSTENPROFIL.EL_CONVAI_SIP;
  return direction === RICHTUNG_INBOUND ? KOSTENPROFIL.TELNYX_INBOUND_BUDGET : KOSTENPROFIL.TELNYX_BUDGET;
}

// DAS Profil eines Anrufs, fuer jeden Leser dieselbe Antwort (G5). Gesetztes und bekanntes
// costProfile gewinnt; sonst die Legacy-Zuordnung oben - ABER NUR fuer ein FEHLENDES
// (null/undefined) costProfile, also eine Altzeile von VOR der Kette (4.6). Ein GESETZTER,
// aber unbekannter Wert (Matrix 4.6, "Profil unbekannt (Anruf NACH der Kette entstanden)")
// ist KEINE Altzeile - er kann nur entstanden sein, NACHDEM der Schreibweg
// (recordCostProfile, state-ops.js) schon existierte, also nachdem die Legacy-Zuordnung
// bereits ueberholt war (z.B. ein spaeter entferntes/umbenanntes Profil). Ihn trotzdem auf
// die Legacy-Zuordnung umzulenken waere eine erfundene Vollstaendigkeit (KV2-8 Abnahme
// (a)/(b)) - er bleibt deshalb UNAUFGELOEST. Jeder Leser (pflichtTraegerFuerProfil,
// pflichttypenFuerProfil, sweepTraegerFuerProfil) behandelt einen unbekannten Wert
// bereits fail-closed als leer/null, kein weiterer Riegel noetig.
export function kostenprofilFuerAnruf(call) {
  if (istBekanntesKostenprofil(call?.costProfile)) return call.costProfile;
  return call?.costProfile == null ? legacyKostenprofil(call ?? {}) : call.costProfile;
}

// Kriterium (h)/hatEinsammler: true, wenn IRGENDEIN Profil diesen Traeger mit einem
// Einsammler != nicht_belegpflichtig fuehrt. Reines Praedikat, vom Boot-Riegel
// (boot-guard.js, latentCostPathFindings) gegen KOSTENART.OPENAI_REALTIME gefahren.
export function hatEinsammler(traeger) {
  return Object.values(KOSTENPROFILE).some((profil) => {
    const eintrag = profil.traeger[traeger];
    return eintrag !== undefined && eintrag.einsammler !== EINSAMMLER.NICHT_BELEGPFLICHTIG;
  });
}

// KV2-6: die Traeger EINES Profils, fuer die es einen Einsammler gibt. Gegenstueck zu
// hatEinsammler (dort: "fuehrt IRGENDEIN Profil diesen Traeger ein"), hier profil-lokal.
// Die nicht_belegpflichtig-Paare fallen heraus - openai_realtime (Owner-Entscheidung 9)
// hat keinen Einsammler und darf deshalb weder in eine Deckungsquote noch in einen
// Herzschlag eingehen: sonst waere der Alarm fuer telnyx_inbound_realtime per
// Konstruktion dauerhaft an, und ein Alarm, der immer an ist, ist keiner (4.4).
// Unbekanntes Profil -> LEERE Liste (fail-closed, nie ein Trostpreis-Traeger).
export function pflichtTraegerFuerProfil(profil) {
  // Drei eigene Anweisungen statt einer verketteten Pipeline (G36, Gesetz von Demeter) -
  // dieselbe Rechnung, aber ohne vier verschachtelte Zugriffe in EINEM Ausdruck.
  const traegerEintraege = Object.entries(KOSTENPROFILE[profil]?.traeger ?? {});
  const pflichtEintraege = traegerEintraege.filter(([, eintrag]) => eintrag.einsammler !== EINSAMMLER.NICHT_BELEGPFLICHTIG);
  return pflichtEintraege.map(([traeger]) => traeger);
}

// ---- Top-Level-Validierung: laeuft bei JEDEM Import dieses Moduls (Muster
// cost-ledger-map.js), nicht erst in einem Testlauf. Eine verstuemmelte Zeile reisst den
// Import ab, bevor irgendein Aufrufer die Tabellen je zu Gesicht bekommt. ----
for (const [name, zeile] of Object.entries(KOSTENARTEN)) pruefeKostenart(name, zeile);
for (const [name, profil] of Object.entries(KOSTENPROFILE)) pruefeProfil(name, profil);

// Schluesselmengen-Riegel: die Tabellen-Keys MUESSEN exakt die Enum-Werte sein, sonst ist
// der Enum eine Luege (jemand koennte einen Katalogeintrag ergaenzen, ohne den Enum
// nachzuziehen, oder umgekehrt).
function pruefeSchluesselmenge(bezeichner, tabelle, enumWerte) {
  const tabellenKeys = new Set(Object.keys(tabelle));
  const enumSet = new Set(enumWerte);
  if (tabellenKeys.size !== enumSet.size || [...enumSet].some((wert) => !tabellenKeys.has(wert)))
    throw new Error(`kostenarten: ${bezeichner}-Keys weichen von ihrem Enum ab`);
}
pruefeSchluesselmenge("KOSTENARTEN", KOSTENARTEN, Object.values(KOSTENART));
pruefeSchluesselmenge("KOSTENPROFILE", KOSTENPROFILE, Object.values(KOSTENPROFIL));
