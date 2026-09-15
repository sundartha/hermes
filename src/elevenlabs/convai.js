// ---- ElevenLabs Convai: der EINE HTTP-Zugang des Anrufstart-Zweigs -------------------
// Fuenfzehn Endpunkte: den Anrufstart (POST), den ziehenden Ergebnisabruf (GET), den
// Beende-Versuch (DELETE, Owner-Auftrag 15.08.2026), den Nummernabruf (GET, OUTBOUND-E4/
// Pruefung 1 des Drift-Waechters) - dazu die drei der Nummernregistrierung (Liste/Anlegen/
// Loeschen, OUTBOUND-E5), dazu Lesen/Schreiben der Workspace-Settings (IEL-B9,
// Init-Webhook), dazu die sechs des Geheimnis-Werkzeugs (IEL-B10: Secret-Liste/-Anlegen/
// -Aktualisieren, Registrierungs-PATCH, Conversation-Liste, Agent-Abruf). Rein IO-injiziert (fetchImpl kommt vom Aufrufer, DIP wie
// src/tts/synth.js) - der Zweig laesst sich damit gegen eine Attrappe fahren, ohne dass je
// ein echter Anruf oder eine echte Registrierung entsteht.
//
// KEIN RETRY, bewusst (Absolute Regel 1): ein wiederholter Anrufstart ist ein zweiter
// ECHTER Anruf beim selben Menschen. Der Fehlschlag gehoert deshalb dem Aufrufer, der
// den Call sauber beendet - nicht einer Schleife hier. Der Ergebnisabruf wiederholt sich
// sehr wohl, aber als Takt des Aufrufers (ELEVENLABS_RESULT_POLL_MS), nicht als
// verborgener Retry in diesem Modul. Der Beende-Versuch (endConversation) wiederholt sich
// NIE - er ist selbst schon fail-soft (s. dort) und braucht keinen zweiten Anlauf.
//
// TIMEOUT dagegen ist Pflicht: fetch kennt von sich aus keins. Ein stummer Anbieter
// hielte sonst den /api/calls-Request unbegrenzt offen - der Aufrufer bekaeme weder eine
// Antwort noch einen beendeten Call.
//
// Der Fehler-RUMPF des Anbieters wird NIE gelesen und NIE weitergereicht (Absolute Regel
// 4/5): er kann Nummern-/Auth-Fragmente tragen, und fuer die Kategorisierung reicht der
// Status. Weitergegeben wird ausschliesslich err.providerStatus.

import { disclosurePrefixFor } from "../i18n/locales.js";

const OUTBOUND_CALL_PATH = "/v1/convai/sip-trunk/outbound-call";
const CONVERSATION_PATH = "/v1/convai/conversations/";
const PHONE_NUMBER_PATH = "/v1/convai/phone-numbers/";
// OUTBOUND-E5: Liste/Anlegen adressieren die SAMMLUNG (kein trailing slash, kein
// Einzelpfad-Suffix) - anders als PHONE_NUMBER_PATH oben, das einen EINZELNEN
// Nummer-Datensatz adressiert (Loeschen bleibt auf PHONE_NUMBER_PATH + id).
const PHONE_NUMBERS_PATH = "/v1/convai/phone-numbers";
// IEL-B9: Workspace-Settings (conversation_initiation_client_data_webhook), [R1] GET-WS.
const CONVAI_SETTINGS_PATH = "/v1/convai/settings";
// IEL-B10, belegt aus elevenlabs.io/docs/api-reference (gelesen 2026-09-15):
//   GET   /v1/convai/secrets?search=&page_size=   -> {secrets:[{type,secret_id,name,used_by}], next_cursor}
//                                                    (page_size max 100, search = Namenspraefix)
//   POST  /v1/convai/secrets        {type:"new", name, value}    -> {type:"stored", secret_id, name}
//   PATCH /v1/convai/secrets/{id}   {type:"update", name, value} -> {type:"stored", secret_id, name}
//   GET   /v1/convai/conversations?agent_id=&call_start_after_unix=&page_size=
//         -> {conversations:[{conversation_id, direction, start_time_unix_secs, status, ...}], has_more,
//            next_cursor}; direction ist KEIN Filterparameter (page_size max 100)
//   GET   /v1/convai/agents/{id}    -> conversation_config.tts.{voice_id, model_id}
//   PATCH /v1/convai/phone-numbers/{id} inbound_trunk_config{credentials, allowed_numbers,
//         allowed_addresses, media_encryption (Doku-Default "allowed")}
const CONVAI_SECRETS_PATH = "/v1/convai/secrets";
const CONVERSATIONS_PATH = "/v1/convai/conversations";
const AGENT_PATH = "/v1/convai/agents/";
const SECRET_TYP_NEU = "new";
const SECRET_TYP_UPDATE = "update";
const API_KEY_HEADER = "xi-api-key";

// Interner Transport-Bound, kein Operator-Knopf (Praezedenz ERROR_DETAIL_MAX_LEN in
// telephony/adapters/telnyx/errors.js): grosszuegig genug fuer einen SIP-Anrufstart,
// klein genug, dass ein stummer Anbieter keinen Aufrufer haengen laesst.
//
// GEMESSEN am 15.08.2026, nicht geraten: der Anrufstart ist BLOCKIEREND ueber die ganze
// Klingelphase - er antwortet erst, wenn der SIP-INVITE seine endgueltige Antwort hat.
// Zwei Messungen:
//   - unerreichbares Ziel (+15550000000, SIP 404): Antwort nach 1,05 s;
//   - echter Anruf call_msu77zi51zxw: unser Request lief 09:53:50,7Z los, das Ziel hob
//     erst 09:54:31Z ab - 40,3 s blosses Klingeln. Bei 15 s hatte der Anbieter noch
//     nicht geantwortet, wir brachen WAEHREND des Klingelns ab, und das Gespraech kam
//     danach trotzdem zustande (conv_6801m02df3tfett9vv6jwn8fw8q0, 7 s). Der Abbruch
//     verhindert den Anruf also nicht, er kappt nur unsere Kennung: der Record wurde
//     failed und abgerechnet, ohne conversation_id und ohne je einen Ergebnisabruf.
// 15 s waren damit kuerzer als das blosse Klingeln. Der Wert muss die Klingelphase
// tragen (gemessen bis 40 s, s. o.), nicht die Gespraechsdauer. 120 s liegen mit Reserve
// darueber und weiterhin ein Vielfaches unter der Max-Gespraechsdauer (1800 s): ein
// stummer Anbieter kann einen Aufrufer damit nie ueber ein ganzes Gespraech haengen lassen.
//
// Bleibt der DEFAULT fuer jeden Aufruf, der keine eigene Frist mitbringt (Anrufstart, der
// regulaere Poll-Takt). Exportiert, damit ein kuerzerer Override (s. timeoutMs unten,
// gebraucht von elevenlabs/outbound.js#endActiveCall fuer BEIDE Anbieter-Aufrufe des
// Abbruch-Pfades - Ergebnisabruf UND Loeschversuch, S1-C) sich gegen DIESEN Wert bezeugen
// laesst, statt eine zweite Zahl zu raten.
export const REQUEST_TIMEOUT_MS = 120000;

// Wirft MIT Status: routes/api-calls.js unterscheidet daran die Anbieter-Ablehnung (502)
// vom Transportfehler (500) - genau wie beim Telnyx-Adapter (attachStatus).
function assertConvaiOk(res, op) {
  if (res.ok) return;
  const err = new Error(`ElevenLabs ${op} fehlgeschlagen: HTTP ${res.status}`);
  err.providerStatus = res.status;
  throw err;
}

// ---- Weisse Liste: conversation_config_override (Owner-Entscheidung 16.08.2026) -------
// Ersetzt den bisherigen Wortlaut "conversation_config_override wird nicht benutzt".
// PRO ANRUF duerfen an diesem Anbieter-Feld AUSSCHLIESSLICH zwei Dinge gesetzt werden -
// die Sprache (agent.language) und die Stimme (tts.voice_id). Jede andere Ueberschreibung
// ist verboten. Die geschuetzte EIGENSCHAFT ist nicht der Pfad, sondern: NIEMAND darf den
// Agenten pro Anruf unbemerkt umbauen (Systemprompt, Werkzeuge, ASR-Keywords,
// Text-only-Modus, ...) - dieselbe Eigenschaft wie bisher, nur genauer durchgesetzt.
// Pfadnamen aus dem Anbieter-Schema (ConversationConfigClientOverride, s.
// elevenlabs-openapi.json, 16.08.2026 gemessen), nicht geraten.
//
// NUR DER WAECHTER, NICHT DIE FUNKTION: dieses Modul WAEHLT keine Sprache/Stimme - kein
// Aufrufer setzt heute ein Override-Objekt (elevenlabs/outbound.js#dynamicVariables baut
// keins). Der Waechter sitzt trotzdem bereits hier, direkt vor dem einzigen Netzzugriff
// dieses Wegs, damit jeder KUENFTIGE Aufrufer ihn automatisch durchlaeuft - ein Waechter,
// der erst mit der Funktion zusammen entstuende, liesse genau das Zeitfenster offen, in
// dem hier schon zwei Defekte entstanden sind.
//
// FAIL-CLOSED, NICHT FILTERND: ein verbotener Pfad wird NICHT still entfernt und der Rest
// trotzdem gesendet (ein stiller Filter ist derselbe Fehler wie einst bei
// context.open_questions) - er bricht den GESAMTEN Anrufstart ab, bevor der Anbieter den
// Koerper sieht.
// EXPORTIERT (TEIL 3, Owner-Auftrag 16.08.2026): die EINE Quelle, gegen die
// test/elevenlabs-override-whitelist.test.js die Besitz-Karte des Anbieters
// (elevenlabs/agent_configs/outbound-agent.template.json,
// platform_settings.overrides.conversation_config_override) haelt - zwei getippte
// Kopien derselben zwei Pfade koennten sonst auseinanderlaufen, ohne dass irgendein Test
// es bemerkt (G5).
export const OVERRIDE_ALLOWED_LEAF_PATHS = Object.freeze(["agent.language", "tts.voice_id"]);
// OC-P2 (PLAN-OWNER-CALL): die ZWEITE, ausdruecklich benannte Menge - erlaubt NUR, wenn
// das Ziel dieses Anrufs die eigene hinterlegte Nummer des anrufenden Tenants ist
// (call.calleeIsOwner, src/callee-is-owner.js). Fuer jeden anderen Anruf bleibt
// agent.first_message verboten, und der Offenlegungssatz bleibt statischer Anbieter-Text:
// selbst ein Totalausfall unseres Codes kann ihn Dritten gegenueber nicht entfernen.
//
// WIR SIND HIER STRENGER ALS DER ANBIETER: der ignoriert eine nicht freigeschaltete
// Uebersteuerung STILL (kein Fehler, keine Warnung, s. Vorlage
// _besitz.felder[conversation_config_override_erlaubnisse]). Wir brechen den GESAMTEN
// Anrufstart ab. Ein stiller Filter waere derselbe Fehler wie einst bei
// context.open_questions.
// UMBENANNT (P4a): die Menge ist nicht mehr owner-only - seit F-2 darf agent.first_message
// auch dann reisen, wenn Gespraechs- und Offenlegungssprache auseinanderlaufen (s.
// assertDisclosureCarried). Der Name nennt jetzt das Feld statt einer von zwei Lagen.
export const OVERRIDE_FIRST_MESSAGE_LEAF_PATHS = Object.freeze(["agent.first_message"]);
const OVERRIDE_PATH_SEPARATOR = ".";

// EIN Zugriffspfad fuer beide Waechter (G5) - conversation_config_override liegt drei
// Ebenen tief, und ein zweiter, an derselben Stelle getippter Zugriff koennte abdriften.
function overrideOf(body) {
  return body?.conversation_initiation_client_data?.conversation_config_override;
}

function isPlainObject(wert) {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert);
}

// Alle BLATT-Pfade eines Override-Objekts, punktgetrennt. "Blatt" = kein weiteres
// Objekt darunter (ein Array-Wert wie asr.keywords zaehlt selbst als Blatt - kein
// Array-Pfad steht auf der Whitelist, ein Aufloesen der Eintraege braechte nichts). Ein
// leeres Objekt traegt keinen Blatt-Pfad: nichts gesetzt, nichts zu verbieten.
// IEL-B6: derselbe Pfad-Waechter fuer die Init-Antwort (G5) - deshalb exportiert.
export function overrideLeafPaths(wert, prefix) {
  if (!isPlainObject(wert)) return prefix.length ? [prefix.join(OVERRIDE_PATH_SEPARATOR)] : [];
  return Object.entries(wert).flatMap(([schluessel, kind]) =>
    overrideLeafPaths(kind, [...prefix, schluessel]),
  );
}

// Wirft, wenn der Anfragekoerper ETWAS AUSSER den zwei erlaubten Pfaden setzt -
// EINSCHLIESSLICH eines Override-Werts, der gar kein Objekt ist (eine kaputte Form ist
// selbst ein Verstoss, kein stilles "nichts zu pruefen"). callId dient NUR dem Log
// (Regel 4/5: keine Rufnummer, kein Schluessel, kein Anfragekoerper).
//
// calleeIsOwner ist KEIN Schalter des Aufrufers, sondern eine TATSACHE ueber diesen Anruf
// (serverseitig entschieden, am Datensatz persistiert). Deshalb ist es hier bewusst ein
// Parameter und keine zweite Funktion: zwei Einstiege in denselben Netzzugriff waeren zwei
// Wege, auf denen der Waechter umgangen werden kann (die uebliche Warnung vor
// Flag-Argumenten, F3/G15, zielt auf Verhaltens-Selektoren des Aufrufers - hier waere die
// Aufspaltung der gefaehrlichere Weg). FAIL-CLOSED per Default: ein kuenftiger Aufrufer,
// der den Wert vergisst, bekommt die strenge Menge.
//
// P4a: dieselbe Haltung gilt fuer die zweite Lage, in der agent.first_message erlaubt ist
// - Gespraechs-/Offenlegungssprache weichen ab (spracheWeichtAb weiter unten). Beide Lagen
// oeffnen dieselbe Menge OVERRIDE_FIRST_MESSAGE_LEAF_PATHS, weil der Anbieter nur EINEN
// first_message-Pfad kennt; welche Lage zutrifft, entscheidet danach assertDisclosureCarried.
// Die erlaubte Menge FUER DIESEN Anruf - EINE Entscheidung, aus der Waechter UND Log/
// Fehlertext lesen (G30: das Zusammensetzen ist keine eigene Aufgabe der Pruef-Funktion).
function erlaubtePfadeFuer(override, { calleeIsOwner, disclosureLanguage }) {
  const firstMessageErlaubt = calleeIsOwner === true || spracheWeichtAb(override, disclosureLanguage);
  return firstMessageErlaubt
    ? [...OVERRIDE_ALLOWED_LEAF_PATHS, ...OVERRIDE_FIRST_MESSAGE_LEAF_PATHS]
    : OVERRIDE_ALLOWED_LEAF_PATHS;
}

// Die verbotenen Pfade dieses Koerpers - ein Wert, der gar kein Objekt ist, zaehlt selbst
// als EIN Verstoss (kaputte Form ist keine Nicht-Pruefung).
function verboteneOverridePfade(override, erlaubt) {
  if (!isPlainObject(override)) return ["(conversation_config_override ist kein Objekt)"];
  return overrideLeafPaths(override, []).filter((pfad) => !erlaubt.includes(pfad));
}

function assertOverrideWhitelisted(body, callId, { calleeIsOwner = false, disclosureLanguage = null } = {}) {
  const override = overrideOf(body);
  if (override === undefined || override === null) return;
  const erlaubt = erlaubtePfadeFuer(override, { calleeIsOwner, disclosureLanguage });
  const verboten = verboteneOverridePfade(override, erlaubt);
  if (verboten.length === 0) return;
  console.error(
    `[el-outbound] conversation_config_override abgelehnt (call=${callId}): verbotene(r) Pfad(e) ${verboten.join(", ")} - erlaubt sind ausschliesslich ${erlaubt.join(", ")}`,
  );
  throw new Error(
    `ElevenLabs-Anrufstart abgebrochen: conversation_config_override enthaelt nicht erlaubte(n) Pfad(e) (${verboten.join(", ")})`,
  );
}

// P4a: laeuft die Gespraechssprache von der Offenlegungssprache weg? Der Vergleich liest
// die gesendete Sprache aus dem KOERPER und die Offenlegungssprache aus der AUFLOESUNG -
// zwei Quellen, sonst waere er tautologisch. disclosureLanguage === null heisst
// "unbekannt" (Bestandsaufrufer) und damit "keine Abweichung nachweisbar".
const spracheWeichtAb = (override, disclosureLanguage) =>
  disclosureLanguage !== null && override?.agent?.language !== disclosureLanguage;

// P4a (Artikel 50 EU AI Act, Absolute Regel 2, I-1): weicht die Gespraechssprache von der
// Offenlegungssprache ab, MUSS dieser Anruf seine Eroeffnung selbst mitbringen UND sie MUSS
// mit dem Pflichtsatz der OFFENLEGUNGSSPRACHE beginnen. Sonst spraeche der Anbieter den Satz
// seines language_presets - in der Sprache, die der Auftraggeber gewaehlt hat, nicht der
// Angerufene. Gemessen wird der namensunabhaengige Anfang (disclosurePrefixFor): den
// Auftraggeber-Namen kennt dieser Waechter nicht, den Pflichtsatz schon.
// EINZIGE AUSNAHME: das eigene Ziel (OC-P2) - dort ersetzt die Owner-Begruessung den Satz
// per Eigentuemer-Entscheidung; eine Eroeffnung braucht es auch dort.
// WIRFT VOR JEDEM NETZZUGRIFF - eine still ignorierte Uebersteuerung ist auf diesem Weg
// erprobt (der Anbieter meldet keinen Fehler), und eine still fehlende Offenlegung waere
// keine Offenlegung.
const fehlendeEroeffnung = (eroeffnung) => typeof eroeffnung !== "string" || !eroeffnung;

function fehlendeEroeffnungFehler(callId, override, disclosureLanguage) {
  return new Error(
    `Anrufstart abgebrochen (call=${callId}): agent.language=${override?.agent?.language} weicht von ` +
      `der Offenlegungssprache ${disclosureLanguage} ab, aber der Anruf bringt keine eigene ` +
      "agent.first_message mit - der Anbieter spraeche den Pflichtsatz seines Presets.",
  );
}

function falscherPflichtsatzFehler(callId, disclosureLanguage) {
  return new Error(
    `Anrufstart abgebrochen (call=${callId}): agent.first_message beginnt nicht mit dem ` +
      `Offenlegungssatz der Sprache ${disclosureLanguage} (Artikel 50 EU AI Act).`,
  );
}

// Der einzige Fall, in dem eine getragene Eroeffnung TROTZDEM nicht den Pflichtsatz
// beweisen muss: das eigene Ziel (OC-P2), wo die Owner-Begruessung an seine Stelle tritt.
function pflichtsatzFehlt(eroeffnung, disclosureLanguage, calleeIsOwner) {
  if (calleeIsOwner === true) return false;
  return !eroeffnung.startsWith(disclosurePrefixFor(disclosureLanguage));
}

function assertDisclosureCarried(body, callId, { calleeIsOwner = false, disclosureLanguage = null } = {}) {
  const override = overrideOf(body);
  if (!spracheWeichtAb(override, disclosureLanguage)) return;
  const eroeffnung = override?.agent?.first_message;
  if (fehlendeEroeffnung(eroeffnung)) throw fehlendeEroeffnungFehler(callId, override, disclosureLanguage);
  if (pflichtsatzFehlt(eroeffnung, disclosureLanguage, calleeIsOwner))
    throw falscherPflichtsatzFehler(callId, disclosureLanguage);
}

// EINE Stelle fuer Basis-URL, Schluessel-Header, Timeout und Fehlerpruefung (G5): beide
// Endpunkte unterscheiden sich nur in Pfad und Methode. timeoutMs optional (Default
// REQUEST_TIMEOUT_MS) - ein Aufrufer mit eigener, kuerzerer Frist (S1-3) ueberschreibt sie
// gezielt, ohne den Bestandswert fuer alle anderen Aufrufer zu senken.
async function convaiFetch({ fetchImpl, account, path, op, init, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const res = await fetchImpl(`${account.apiBase}${path}`, {
    ...init,
    headers: { [API_KEY_HEADER]: account.apiKey, "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  assertConvaiOk(res, op);
  return res.json();
}

/**
 * Die EINE Kennung, die wir aus der Anrufstart-Antwort uebernehmen (Anbieter-Schema
 * SIPTrunkOutboundCallResponse: success, message, conversation_id, sip_call_id), in
 * unserer Schreibweise. Fehlt sie, ist sie null - nie undefined, damit der Aufrufer
 * genau eine Leerform kennt.
 *
 * WARUM sip_call_id AUSDRUECKLICH NICHT GELESEN WIRD - am 17.08.2026 an einem echten
 * Anruf gemessen (.fortschritt.md, "ANRUF 2 / BEFUND 4"):
 *
 *   diese Antwort          sip_call_id = "SCL_Qu4voPd3TXvD"
 *   Telnyx-Beleg           sip_call_id = "otb_4801m08d8gnce3xs4xpka1h3773a"
 *
 * ZWEI FELDER, AN BEIDEN ENDEN GLEICH BENANNT, MIT VERSCHIEDENEN WERTEN. Was hier unter
 * dem Namen sip_call_id herauskommt, ist ElevenLabs' call_sid - derselbe Anruf fuehrt
 * ihn im Gespraechs-Datensatz woertlich unter metadata.phone_call.call_sid. Der EINZIGE
 * Join zwischen den beiden Kostenquellen dieses Wegs ist der "otb_"-Wert, und den
 * liefert ausschliesslich metadata.phone_call.call_id beim Ergebnisabruf (gelesen in
 * elevenlabs/outbound.js#persistProviderResult, VOR jedem Loeschversuch). Diese Antwort
 * ist dafuer KEINE Quelle - sie war einen halben Tag lang die falsche.
 * (Der frueher hier stehende Satz "beide tragen dieselbe otb_-Kennung" war eine Annahme
 * aus dem Feldnamen, keine Messung. Genau die Fehlerklasse, gegen die dieses Repo
 * antritt.)
 *
 * EXPORTIERT, weil die Trockenlege-Attrappe (elevenlabs/outbound.js#
 * fakeSipTrunkOutboundCallResponse) in der FORM DES ANBIETERS antwortet und durch GENAU
 * DIESE Uebersetzung gelesen wird - eine zweite, dort getippte Zuordnung desselben
 * Feldnamens koennte von dieser abdriften (G5), und der Fake wuerde dann etwas anderes
 * liefern als der echte Weg.
 */
export function startResultOf(antwort) {
  return { conversationId: antwort?.conversation_id || null };
}

/**
 * Startet den Anruf beim Anbieter. Liefert die SYNCHRON zurueckgegebene Kennung
 * (s. startResultOf: conversationId null, wenn der Anbieter keine mitschickt - der
 * Aufrufer behandelt das als Fehlschlag).
 * WIRFT VOR JEDEM Netzzugriff, wenn body.conversation_initiation_client_data.
 * conversation_config_override etwas ausserhalb der Whitelist setzt (s.
 * assertOverrideWhitelisted oben) - callId dient nur diesem Log, kein Fachwert.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, body: object,
 *   callId?: string, calleeIsOwner?: boolean, disclosureLanguage?: string|null}} args
 *   calleeIsOwner: OC-P2 - nur bei true (oder bei P4a-Sprachabweichung) ist zusaetzlich
 *   OVERRIDE_FIRST_MESSAGE_LEAF_PATHS erlaubt; Default false (fail-closed).
 *   disclosureLanguage: P4a - die aufgeloeste Sprache des Pflichtsatzes; Default null
 *   (unbekannt = Bestandsaufrufer, keine Abweichung nachweisbar, fail-closed).
 * @returns {Promise<{conversationId: string|null}>}
 */
export async function startOutboundCall({
  fetchImpl,
  account,
  body,
  callId,
  calleeIsOwner = false,
  disclosureLanguage = null,
}) {
  const eroeffnungsKontext = { calleeIsOwner, disclosureLanguage };
  assertOverrideWhitelisted(body, callId, eroeffnungsKontext);
  assertDisclosureCarried(body, callId, eroeffnungsKontext);
  const antwort = await convaiFetch({
    fetchImpl,
    account,
    path: OUTBOUND_CALL_PATH,
    op: "Anrufstart",
    init: { method: "POST", body: JSON.stringify(body) },
  });
  return startResultOf(antwort);
}

/**
 * Holt den Stand eines Gespraechs (status, transcript, analysis). timeoutMs optional
 * (S1-3): Default REQUEST_TIMEOUT_MS (Bestandsverhalten fuer den regulaeren Poll-Takt);
 * der ABBRUCH-Pfad (elevenlabs/outbound.js#endActiveCall) uebergibt eine eigene, kuerzere
 * Frist, weil terminateAndBillCall synchron auf diesen Abruf wartet.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, conversationId: string, timeoutMs?: number}} args
 */
export function fetchConversation({ fetchImpl, account, conversationId, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVERSATION_PATH + encodeURIComponent(conversationId),
    op: "Gespraechsabruf",
    init: { method: "GET" },
    timeoutMs,
  });
}

// Review-Blocker Runde 1 (G5): endConversation und deletePhoneNumber waren zwei
// wortgleiche fail-soft-DELETEs (identischer try/fetchImpl/Header/Timeout/Ergebnis-Ausdruck/
// catch) - jede kuenftige Aenderung (Header, Timeout-Semantik, Fehlerbehandlung) haette an
// BEIDEN Stellen erfolgen muessen. EIN gemeinsamer Kern, der Aufrufer liefert nur den Pfad.
// Wirft NIE (Owner-Auftrag 15.08.2026): weder bei einer Anbieter-Ablehnung (4xx/5xx, kein
// assertConvaiOk) noch bei Netzwerk-/Zeitablauf-Fehlern. Ein fehlgeschlagener Loeschversuch
// darf den Abbruch unseres eigenen Datensatzes nicht verhindern - ein Werkzeug, das an einem
// Anbieter-Ausfall haengen bleibt, waere schlimmer als keins. Meldet NUR, ob der Anbieter den
// Versuch angenommen hat (HTTP-Status) - der Fehler-RUMPF wird NIE gelesen (Regel 4/5).
async function fireAndForgetDelete({ fetchImpl, account, path, timeoutMs }) {
  try {
    const res = await fetchImpl(`${account.apiBase}${path}`, {
      method: "DELETE",
      headers: { [API_KEY_HEADER]: account.apiKey, "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { accepted: res.ok, status: res.status };
  } catch {
    return { accepted: false, status: null };
  }
}

/**
 * Beende-Versuch beim Anbieter (DELETE /v1/convai/conversations/{id}): Kap-/cancel_call-
 * Pfad (telephony/call-termination.js#elevenLabsHangUpAction). FAIL-SOFT (s.
 * fireAndForgetDelete oben).
 *
 * OB das die Leitung tatsaechlich kappt, ist NICHT belegt (s. Modul-Kopf des Aufrufers,
 * elevenlabs/outbound.js) - diese Funktion beantwortet nur "hat der Anbieter den DELETE-
 * Aufruf angenommen", nicht "ist das Gespraech vorbei".
 *
 * timeoutMs optional (S1-C): Default REQUEST_TIMEOUT_MS. Der ABBRUCH-Pfad (elevenlabs/
 * outbound.js#endActiveCall) uebergibt seine eigene, kurze Frist - der Aufrufer WARTET auf
 * diesen DELETE (er ist der hangUp-Thunk von terminateAndBillCall), und mit dem Bestandswert
 * haengt ein stummer Anbieter Kappung UND cancel_call zwei volle Minuten. Die 120 s sind fuer
 * die SIP-Klingelphase des AnrufSTARTS bemessen (s.o.), nicht fuer diesen Ein-Zeilen-DELETE.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, conversationId: string, timeoutMs?: number}} args
 * @returns {Promise<{accepted: boolean, status: number|null}>}
 */
export function endConversation({ fetchImpl, account, conversationId, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return fireAndForgetDelete({
    fetchImpl,
    account,
    path: CONVERSATION_PATH + encodeURIComponent(conversationId),
    timeoutMs,
  });
}

/**
 * OUTBOUND-E4 (Pruefung 1 des Drift-Waechters): rein LESEND. Der Waechter fragt, ob die
 * registrierte SIP-Nummer beim Anbieter noch existiert, welche Rufnummer sie traegt und
 * welchem Agenten sie zugewiesen ist. KEIN RETRY (Muster der beiden Funktionen oben) - ein
 * Fehlschlag ist ein Datum fuer den Aufrufer (outbound-config-probe.js), keine Schleife
 * hier. Wirft MIT err.providerStatus wie fetchConversation (assertConvaiOk).
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, phoneNumberId: string, timeoutMs?: number}} args
 */
export function fetchPhoneNumber({ fetchImpl, account, phoneNumberId, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: PHONE_NUMBER_PATH + encodeURIComponent(phoneNumberId),
    op: "Nummernabruf",
    init: { method: "GET" },
    timeoutMs,
  });
}

/**
 * OUTBOUND-E5: alle registrierten Nummern des Kontos. NUR LESEND. Zweck: Idempotenz-Schloss
 * #2 des Anlegens (existiert die e164 schon, wird ihre Kennung UEBERNOMMEN statt eine zweite
 * Registrierung erzeugt) und der Waisen-Abgleich des Reparaturlaufs. Wirft mit
 * err.providerStatus (assertConvaiOk), KEIN Retry (Muster fetchPhoneNumber).
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, timeoutMs?: number}} args
 * @returns {Promise<Array<{phone_number: string, phone_number_id: string}>>}
 */
export function listPhoneNumbers({ fetchImpl, account, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: PHONE_NUMBERS_PATH,
    op: "Nummernliste",
    init: { method: "GET" },
    timeoutMs,
  });
}

/**
 * OUTBOUND-E5: SCHREIBZUGRIFF - legt EINE SIP-Trunk-Nummernregistrierung an.
 * Der EINZIGE schreibende Anbieter-Aufruf dieser Etappe. Er ist NICHT idempotent (der
 * Anbieter garantiert das nicht - UNBELEGT); die Idempotenz stellt der Aufrufer her
 * (elevenlabs/nummern-registrierung.js). KEIN Retry, aus demselben Grund wie beim
 * Anrufstart: ein wiederholter Schreibzugriff kann eine zweite Registrierung erzeugen.
 * Der Fehler-RUMPF wird NIE gelesen (Regel 4/5) - er kann Nummern-/Auth-Fragmente tragen.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, body: object}} args
 * @returns {Promise<{phoneNumberId: string|null}>}
 */
export async function createPhoneNumber({ fetchImpl, account, body }) {
  const antwort = await convaiFetch({
    fetchImpl,
    account,
    path: PHONE_NUMBERS_PATH,
    op: "Nummernregistrierung",
    init: { method: "POST", body: JSON.stringify(body) },
  });
  return { phoneNumberId: antwort?.phone_number_id || null };
}

/**
 * OUTBOUND-E5: SCHREIBZUGRIFF - Loeschversuch einer Registrierung (Freigabe-Protokoll).
 * FAIL-SOFT wie endConversation (s. fireAndForgetDelete oben): wirft NIE. Eine haengende
 * Anbieter-API darf eine Kuendigung/Art.-17-Loeschung nicht blockieren. Meldet nur
 * {accepted, status}.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, phoneNumberId: string, timeoutMs?: number}} args
 * @returns {Promise<{accepted: boolean, status: number|null}>}
 */
export function deletePhoneNumber({ fetchImpl, account, phoneNumberId, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return fireAndForgetDelete({
    fetchImpl,
    account,
    path: PHONE_NUMBER_PATH + encodeURIComponent(phoneNumberId),
    timeoutMs,
  });
}

/**
 * IEL-B9: NUR LESEND. Workspace-Settings des Kontos (Init-Webhook, [R1] GET-WS). Wirft mit
 * err.providerStatus (assertConvaiOk), der Fehler-RUMPF wird nie gelesen. KEIN Retry.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, timeoutMs?: number}} args
 */
export function fetchConvaiSettings({ fetchImpl, account, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVAI_SETTINGS_PATH,
    op: "Workspace-Settings-Abruf",
    init: { method: "GET" },
    timeoutMs,
  });
}

/**
 * IEL-B9: SCHREIBZUGRIFF - PATCH der Workspace-Settings. Einziger Aufrufer:
 * scripts/push-elevenlabs.mjs --workspace-init-webhook --ausfuehren. KEIN Retry: ob der PATCH
 * andere Settings beruehrt, ist ungemessen - die Gegenprobe macht der Aufrufer.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, body: object}} args
 */
export function patchConvaiSettings({ fetchImpl, account, body }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVAI_SETTINGS_PATH,
    op: "Workspace-Settings-Schreiben",
    init: { method: "PATCH", body: JSON.stringify(body) },
  });
}

/**
 * IEL-B10: NUR LESEND. Workspace-Secrets, gefiltert per Namenspraefix. Die Antwort traegt nie einen
 * Secret-Wert. Einziger Aufrufer: scripts/iel-geheimnisse-*.mjs. KEIN Retry.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, search: string, pageSize: number}} args
 */
export function listConvaiSecrets({ fetchImpl, account, search, pageSize }) {
  const query = new URLSearchParams({ search, page_size: String(pageSize) });
  return convaiFetch({
    fetchImpl,
    account,
    path: `${CONVAI_SECRETS_PATH}?${query}`,
    op: "Secret-Liste",
    init: { method: "GET" },
  });
}

/**
 * IEL-B10: SCHREIBZUGRIFF - legt ein Workspace-Secret an. Einziger Aufrufer:
 * scripts/iel-geheimnisse-*.mjs (setzen --ausfuehren). KEIN Retry; der Fehler-RUMPF wird nie gelesen
 * (er koennte den gesendeten Wert spiegeln).
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, name: string, value: string}} args
 */
export function createConvaiSecret({ fetchImpl, account, name, value }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVAI_SECRETS_PATH,
    op: "Secret-Anlegen",
    init: { method: "POST", body: JSON.stringify({ type: SECRET_TYP_NEU, name, value }) },
  });
}

/**
 * IEL-B10: SCHREIBZUGRIFF - aktualisiert den Wert eines bestehenden Workspace-Secrets. Einziger
 * Aufrufer: scripts/iel-geheimnisse-*.mjs (setzen --ausfuehren). KEIN Retry.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, secretId: string, name: string, value: string}} args
 */
export function updateConvaiSecret({ fetchImpl, account, secretId, name, value }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: `${CONVAI_SECRETS_PATH}/${encodeURIComponent(secretId)}`,
    op: "Secret-Aktualisieren",
    init: { method: "PATCH", body: JSON.stringify({ type: SECRET_TYP_UPDATE, name, value }) },
  });
}

/**
 * IEL-B10: SCHREIBZUGRIFF - PATCH einer Nummernregistrierung (inbound_trunk_config). Einziger
 * Aufrufer: scripts/iel-geheimnisse-*.mjs (setzen --ausfuehren). KEIN Retry; der Koerper traegt
 * Zugangsdaten, der Fehler-RUMPF wird nie gelesen.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, phoneNumberId: string, body: object}} args
 */
export function patchPhoneNumber({ fetchImpl, account, phoneNumberId, body }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: PHONE_NUMBER_PATH + encodeURIComponent(phoneNumberId),
    op: "Nummernregistrierung-Aendern",
    init: { method: "PATCH", body: JSON.stringify(body) },
  });
}

/**
 * IEL-B10: NUR LESEND. Conversation-Liste mit den Query-Parametern des Aufrufers. Einziger
 * Aufrufer: scripts/iel-geheimnisse-*.mjs (conversation-beleg). KEIN Retry.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, query: Record<string, string>}} args
 */
export function listConversations({ fetchImpl, account, query }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: `${CONVERSATIONS_PATH}?${new URLSearchParams(query)}`,
    op: "Gespraechsliste",
    init: { method: "GET" },
  });
}

/**
 * IEL-B10: NUR LESEND. Konfiguration eines Agenten. Einziger Aufrufer:
 * scripts/iel-geheimnisse-*.mjs (stimmen-beleg). KEIN Retry.
 * @param {{fetchImpl: Function, account: {apiKey: string, apiBase: string}, agentId: string}} args
 */
export function fetchAgent({ fetchImpl, account, agentId }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: AGENT_PATH + encodeURIComponent(agentId),
    op: "Agent-Abruf",
    init: { method: "GET" },
  });
}
