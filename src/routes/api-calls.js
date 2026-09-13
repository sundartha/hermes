// ---- makeCallRoutes (Server-Slim-Decomposition) ---------------------------------
// Extrahierte Outbound-Call-Route-Gruppe (POST /api/calls, POST /api/calls/:id/cancel)
// als Factory mit Dependency-Injection - gleiches Muster wie makeReadRoutes/
// makeBillingRoutes. Teil der server.js-Decomposition
// (PLAN-SERVER-SLIM.md): REINE Verschiebung, Verhalten unveraendert (byte-identische
// Pfade/Status/Bodies/Audit-Events). Der G30-Split der langen /api/calls-Handler ist
// bewusste Folgearbeit, NICHT diese Phase.
//
// ABSOLUTE REGEL Safety-Gates (INV-9): die geordnete Outbound-Gate-Kette laeuft
// unveraendert als EINE Schleife ueber das EINE injizierte outboundGates-Array (INV-7,
// wird NICHT hier neu gebaut); armMaxDurationTimer(call,null) (TeXML-Zweig) bzw.
// armMaxDurationTimer(call,tw.sid) (TeXML-Zweig) sitzen an exakt denselben Punkten
// (kein Cap-Verlust). Der Fehlerpfad (terminateAndBillCall + providerStatus-
// Kategorisierung, kein Roh-Provider-/Secret-Leak an den Client) wandert unveraendert.
// Hinter `internalOnly` (Loopback ohne X-Forwarded-For, seit AUTH-P5; seit AUTH-P7 die
// einzige Sicherung), an unveraenderter Mount-Position (vor makeReadRoutes).
// normNum (store/defaults) und isTrunkZeroFormatError/E164_FORMAT_ERROR
// (outbound-gates) kommen direkt aus ihrer Heimat (eine Quelle, G5 - wie
// eurText/spendMonthEndDate in outbound-gates.js); die Laufzeit-Instanzen
// (Gate-Array, Timer, Terminierung, finishCall) und die request-tenant-Resolver werden
// injiziert (EINE Quelle, INV-7).
import { Router } from "express";
import { VOICE_ENGINE } from "../config.js";
import { normNum, CONSULT_ANSWER, CONSULT_ANSWER_MODE } from "../store/defaults.js";
import { validateAssistantContext } from "./_validation.js";
import { consultAllowedFor } from "../consult/gate.js";
import { CONSULT_OPEN_MS } from "../consult/in-call.js";
import { CONSULT_EVENT } from "../consult/delivery.js";
import { isConsultEventId } from "../store/state-ops.js";
import {
  E164_FORMAT_ERROR,
  isTrunkZeroFormatError,
  runOutboundGates,
} from "../telephony/outbound-gates.js";
import { startRejectionReason } from "../telephony/failure-reason.js";
import { KOSTENPROFIL } from "../billing/kostenarten.js";
import { diagnosticRetentionGranted } from "../diagnostic-retention.js";
import { ownerSelfCallGranted } from "../callee-is-owner.js";
import { persistEndWithReason } from "../telephony/call-termination.js";
// TEIL C (Owner-Auftrag 15.08.2026, cancel_call darf nicht luegen): der Deckelwert ist
// KEINE Magic Number - er ist in elevenlabs/outbound.js besessen (Bewachung statt
// Korrektur der Anbieter-Vorlage, s. dortiger Kommentar).
import { ELEVENLABS_PROVIDER_MAX_DURATION_S, callLocaleOf } from "../elevenlabs/outbound.js";
import { fetchOpeningLine } from "../elevenlabs/opening-line-llm.js";
import { localeFor, supportedLanguageOf, SUPPORTED_LANGUAGES } from "../i18n/locales.js";
import { fetchPrecallBriefing } from "../precall-briefing.js";
import { metrics } from "../metrics.js";
import { internalOnly } from "../wiring/internal-only.js";

// I10 (call-quality Impl-1): additives Meta in der /api/calls-Erfolgsantwort - zeigt dem
// aufrufenden MCP-Client (place_call), WAS vom optionalen context tatsaechlich ankam.
// NUR bool/count, NIE der Kontext-Inhalt selbst (kein zweiter Transportweg fuer
// HINTERGRUND-Daten). active=false, wenn der Kanal komplett abgeschaltet ist
// (config.tenancy.assistantContextEnabled aus - context ist dann IMMER null, s.o.).
function contextReceivedMeta(context, config) {
  return {
    active: config.tenancy.assistantContextEnabled,
    summary: !!context?.summary,
    key_facts_count: Array.isArray(context?.key_facts) ? context.key_facts.length : 0,
    recipient_relationship: !!context?.recipient_relationship,
    desired_outcome: !!context?.desired_outcome,
  };
}

// OUTBOUND-E3a (Befund C1): der Anbieter-Status als REINE ABFRAGE. Der Vorgaenger
// (recordStartRejectionReason) schrieb UND lieferte zurueck - Command-Query-Vermischung
// (Clean-Code-Befund E2-A), und genau diese Doppelrolle machte die Reihenfolge zu einer
// verschiebbaren Anweisung im catch. Getrennt: hier die Frage, unten der Schreibweg.
const providerStatusOf = (err) => err?.providerStatus;

// OUTBOUND-E3a (Befund C1, REIHENFOLGE-RIEGEL): der Grund wird INNERHALB von persistEnd
// geschrieben - und persistEnd laeuft in terminateAndBillCall (telephony/
// call-termination.js:49-51) garantiert VOR bill(). Damit ist die Invariante "Grund vor
// Buchung" Struktur, nicht Kommentar: an dieser Naht existiert keine Anweisung mehr, die
// man hinter das await schieben KOENNTE. finishCall liest call.failureReason beim Bau der
// Benachrichtigung UND (seit E3a) beim Mailentscheid (telephony/call-finish.js:210-218);
// stuende der Grund spaeter, bekaeme der Nutzer "<Ziel> (Status: failed)" und keine Mail -
// genau die Stummheit, gegen die diese Etappe gebaut ist.
// Reihenfolge im Thunk selbst ist bewusst egal (beides vor bill()); der Grund steht
// dennoch zuerst, weil er die Aussage ist und der Endstatus nur ihr Rahmen.
// recordFailureReason ist set-once und bei null ein No-op (store/state-ops.js:854).
// Exportiert NUR fuer den Riegel-Test (test/fehlergrund-reihenfolge-riegel.test.js):
// der beweist am Produktions-Thunk selbst, dass der Grund VOR dem Endstatus geschrieben
// wird - kein zweiter, im Test nachgebauter Ablauf (das war E2-Befund E2-B).
export function endFailedCallWithReason(store, callId, providerStatus) {
  return persistEndWithReason({
    store,
    callId,
    reason: startRejectionReason(providerStatus),
    endCall: () => store.endCallRecord(callId, "failed"),
  });
}

// Fail-closed-Ersatz fuer den EL-Anrufstart (s. deps unten): ein eingeschalteter Zweig
// ohne verdrahtete Instanz waehlt NICHT. Die Meldung nennt die gescheiterte Operation und
// ihre Ursache (P8), damit der Fehlerpfad-Log sie nicht raten muss.
function elevenLabsCallNotWired() {
  throw new Error(
    "ELEVENLABS_OUTBOUND_ENABLED ist an, aber der Anrufstart ist nicht verdrahtet (deps.elevenLabsOutbound fehlt)",
  );
}

// S1-5 Fix (Owner-Auftrag 15.08.2026): LAUTER Fallback statt eines stillen No-op fuer
// elevenLabsHangUpAction (s. deps unten). Ein stiller Vorgabewert liesse eine
// Kompositionswurzel, die diesen Parameter vergisst, den EL-Terminierungspfad UNBEMERKT
// abschalten - die Antwort behauptete trotzdem "cancelled" (Absolute Regel 1). Bleibt eine
// Funktion statt eines Pflichtparameters (Tests ohne EL-Wiring bleiben gruen, sie treffen
// nie einen EL-Call - isElevenLabsCall in der Route unten haengt am Anruf, nicht an den
// deps), wird aber LAUT, SOBALD sie tatsaechlich fuer einen EL-Call aufgerufen wird:
// Fehlerebene-Log, dieselbe Meldungsform wie elevenLabsCallNotWired oben (P8). Die Antwort
// bleibt ehrlich unabhaengig vom Grund: hangup_attempted:false (Route unten) sagt bereits
// "kein Beende-Weg lief" - ob die Kennung fehlt oder die Verdrahtung, ist fuer den
// Aufrufer dieselbe Auskunft ("kein Griff auf das Gespraech").
function elevenLabsHangUpActionNotWired(_endActiveCall, call) {
  console.error(
    `[cancel] ELEVENLABS_OUTBOUND_ENABLED ist an, aber elevenLabsHangUpAction ist nicht verdrahtet (deps fehlt, call=${call.id})`,
  );
  return null;
}

// P2b + OC-P1 (PLAN-OWNER-CALL): EINE Lesung der eigenen Nummer fuer BEIDE serverseitigen
// Praedikate dieses Outbound-Calls - zwei store-Aufrufe waeren zwei Momentaufnahmen
// desselben, aenderbaren Feldes (POST /api/self-service/private-number) und liessen
// diagnostic und calleeIsOwner desselben Anrufs theoretisch auseinanderlaufen.
//
// AUF MODUL-EBENE statt inline in der Route: die Route (`makeCallRoutes`, der POST-
// Handler darin) traegt bereits einen erhoehten Altlast-Pin (eslint-legacy-exceptions.json)
// fuer Zeilenzahl/Komplexitaet - ihn fuer OC-P1 WEITER anzuheben braucht die Freigabe des
// Eigentuemers (test/check-staged-suppressions.test.js, "Altlast-Ratsche"). Diese
// Extraktion haelt den Aufrufer bei seiner heutigen Groesse; sie ist ausserdem der
// sauberere Schnitt (G30: eine Aufgabe, ein Name).
//
//   diagnostic           - P2b: darf das Roh-Transkript die Summary ueberleben? (Ziel ==
//                           eigene Nummer, Opt-out im Body moeglich, s.
//                           diagnosticRetentionGranted).
//   calleeIsOwnerOfThisCall - OC-P1: ruft dieser Tenant seine EIGENE hinterlegte Nummer an
//                           (Schalter + Tenant-Allowlist + Ziel, s. ownerSelfCallGranted)?
//                           Serverseitig gesetzt; das Ergebnis geht set-once an den
//                           Anruf-Datensatz und wirkt in dieser Phase noch nirgends.
//
// ctx.to (NICHT die rohe `to`) und ctx.tenantId (der ANRUFENDE Tenant aus resolve_identity)
// sind Pflicht - s. Kommentar an der Aufrufstelle. Bewusst KEIN neues Gate in der
// outboundGates-Kette: beide Praedikate lehnen nie ab, wuerden von keinem Gate gelesen und
// haetten die reihenfolge-gepinnte Safety-Kette nur verbreitert
// (test/outbound-gates-order.test.js bleibt unangetastet).
// P2 (Review-Fix Runde 1, S1/CLAUDE.md "keine neuen abgeschaltete Sicherungen"): reine
// Formpruefung ausgelagert - EIN Verzweigungspunkt statt der zusammengesetzten
// Bedingung (status !== undefined && status !== WORKING && status !== FINAL) direkt in
// der Route. Modul-Ebene wie resolveCallPrivacyFlags oben (G30/G34, eine
// Abstraktionsebene je Funktion) - macht den am 2026-09-06 gepinnten
// Komplexitaets-Befund ueberfluessig statt ihn hinzunehmen.
function invalidConsultAnswerStatus(status) {
  if (status === undefined) return null;
  if (status === CONSULT_ANSWER_MODE.WORKING || status === CONSULT_ANSWER_MODE.FINAL) return null;
  return "status ist ungueltig";
}

// P2 (Review-Fix Runde 1): der leichte Quittungs-Zweig (status=WORKING) ausgelagert -
// gleiches Muster wie consultResponseBody in webhooks-elevenlabs.js (G30/eine
// Abstraktionsebene je Funktion). Reiner Aufruf ohne eigenen Verzweigungspunkt in der
// Route selbst; Ablehnungscode 409 UNVERAENDERT, nur verschoben.
function ackWorkingConsult({ store, audit, req, res, call, eventId }) {
  const { outcome } = store.ackConsult(call.id, { eventId });
  // Eigene Aktion statt "consult_answered": eine Quittung ist keine Antwort, und der
  // Forensik-Trail von P3 muss beides unterscheiden koennen. PII-frei - Kennungen und
  // Ergebnis-Token, nie der Fragetext (Regel 4).
  audit("consult_acked", req, `call=${call.id} event=${eventId} ergebnis=${outcome}`);
  if (outcome !== CONSULT_ANSWER.ACCEPTED) return res.status(409).json({ error: outcome });
  return res.json({ accepted: true, merged_facts: 0 });
}

// P2 (Review-Fix Runde 1): der volle Antwort-Zweig (status=FINAL/Bestand) ausgelagert -
// gleiche Begruendung wie ackWorkingConsult oben. Verhalten byte-identisch zum Vorzustand,
// nur aus der Route in eine eigene Funktion verschoben.
function answerConsultFinal({ store, audit, req, res, call, eventId, answers }) {
  const validated = validateAssistantContext({ key_facts: answers });
  if (validated.error || !validated.value)
    return res.status(400).json({ error: validated.error || "answers ist Pflicht" });
  // GQ-P2: die Offen-Frist-KONSTANTE kommt aus dem Consult-Modul (G22/EINE Quelle),
  // der DB-Zugriff bleibt am injizierten store (DIP).
  const { outcome, mergedFacts } = store.answerConsult(call.id, {
    eventId,
    facts: validated.value.key_facts,
    nowMs: Date.now(),
    openMs: CONSULT_OPEN_MS,
  });
  audit(
    "consult_answered",
    req,
    `call=${call.id} event=${eventId} ergebnis=${outcome} fakten=${mergedFacts}`,
  );
  if (outcome !== CONSULT_ANSWER.ACCEPTED) return res.status(409).json({ error: outcome });
  return res.json({ accepted: true, merged_facts: mergedFacts });
}

function resolveCallPrivacyFlags({ store, config, ctx }) {
  const ownNumber = store.tenantPrivateNumber(ctx.tenantId);
  const diagnostic = diagnosticRetentionGranted({
    requested: ctx.b.diagnostic,
    to: ctx.to,
    ownNumber,
    privacy: config.privacy,
  });
  const calleeIsOwnerOfThisCall = ownerSelfCallGranted({
    to: ctx.to,
    ownNumber,
    tenantId: ctx.tenantId,
    enabled: config.voice.ownerSelfCallEnabled,
    allowedTenantIds: config.voice.ownerSelfCallTenantIds,
  });
  return { diagnostic, calleeIsOwnerOfThisCall };
}

// GAP-35: die drei PII-freien Dimensionen des Ablehnungs-Ereignisses. Land und Sprache
// kommen aus dem TENANT (tenantGeo, reine Query), NICHT aus der Zielnummer: eine aus
// der E.164-Vorwahl abgeleitete Landangabe waere ein Rufnummern-Fragment im Log
// (Absolute Regel 4). Ohne aufgeloesten Tenant - outbound_frozen feuert VOR
// resolve_identity, tenant_reject traegt eine unbekannte Identitaet - liefert tenantGeo
// beide Achsen als null: geraten wird nichts. Bewusst NICHT resolveCallLanguage, das
// via settingsFor lazy einen Settings-Bucket anlegen wuerde (Schreib-Nebeneffekt auf
// einer unaufgeloesten Identitaet).
// SEC-P6: von der Closure auf die Modul-Ebene gezogen (Praezedenz resolveCallPrivacyFlags
// oben) - so waechst die ohnehin ueberlange makeCallRoutes durch diese Phase NICHT.
function denialDimensions({ store, grund, tenantId }) {
  const { country, defaultLanguage } = store.tenantGeo(tenantId);
  return { grund, country, language: defaultLanguage };
}

// SEC-P6: Audit und Metrik einer Ablehnung sind BEOBACHTUNG, nie Bedingung der Antwort.
// Die zweite Haelfte des GATE-02-Haengers sass genau hier: stirbt store.tenantGeo, wirft
// denialDimensions ein zweites Mal - diesmal AUSSERHALB jedes Gates, also wieder ohne
// Antwort. Scheitert die Protokollierung, wird sie LAUT (secret-freie Fehlerzeile), die
// Ablehnung wird trotzdem zugestellt: der Anruf ist so oder so abgelehnt, und eine stumme
// Antwort ist der schlechtere Ausgang. Reine 400er-Eingabefehler tragen kein audit-Objekt
// und erzeugen weiterhin weder Audit- noch Metrik-Zeile (Bestand, unveraendert).
function beobachteAblehnung({ store, audit, denial, req, tenantId }) {
  if (!denial.audit) return;
  try {
    audit(denial.audit.event, req, denial.audit.detail);
    metrics.logCallDenied(denialDimensions({ store, grund: denial.audit.grund, tenantId }));
  } catch (fehler) {
    console.error("[place_call] Ablehnung nicht protokollierbar:", fehler?.message);
  }
}

// P4a (F-2): die zwei Ablehnungen des Sprachwunsches. Beide sind reine EINGABEfehler und
// laufen deshalb wie die Bestands-400er VOR jedem Gate - ohne Audit, ohne Metrik
// (dieselbe Regel wie bei to/objective und E164_FORMAT_ERROR). Die unterstuetzten Codes
// stehen IM error-String: der MCP-Weg reicht nur json.error an das aufrufende Modell
// weiter (mcp-tools.js#api), ein Zusatzfeld saehe es nie. code/supported reisen zusaetzlich
// fuer maschinelle Leser. Englisch, weil hier das Client-MODELL liest, nicht der Tenant
// (Systemgrenze O14) - Gate-Ablehnungen an den Tenant bleiben davon unberuehrt.
const UNSUPPORTED_LANGUAGE = "unsupported_language";
const LANGUAGE_UNAVAILABLE = "language_unavailable";

const unsupportedLanguageBody = () => ({
  error: `${UNSUPPORTED_LANGUAGE}: language must be one of ${SUPPORTED_LANGUAGES.join(", ")}`,
  code: UNSUPPORTED_LANGUAGE,
  supported: SUPPORTED_LANGUAGES,
});

// P4a/E-1 (hartes Gate): der Wunsch gilt NUR auf dem Sprechweg, der Gespraechs- und
// Offenlegungssprache getrennt beantwortet (ElevenLabs, elevenlabs/call-locale.js). Die
// Der TeXML-Zweig rendert den Offenlegungssatz aus call.language (claude.js
// disclosureSentence) - dort machte ein Wunsch die Sprache der PFLICHTAUSSAGE
// client-bestimmt, und genau das verbietet F-2 Punkt 4 (PM-2). LAUT abgelehnt statt still
// ignoriert: ein wirkungsloses Feld IST der Defekt, gegen den diese Phase gebaut ist.
const languageUnavailableBody = () => ({
  error:
    `${LANGUAGE_UNAVAILABLE}: this deployment cannot separate the spoken language from the ` +
    "mandatory AI disclosure - omit language",
  code: LANGUAGE_UNAVAILABLE,
});

// deps: siehe Modul-Doc. arm = { armMaxDurationTimer, armReserveReleaseTimer } aus der EINEN
// lifecycle-Instanz (Cap-/Reserve-Backstop, INV-7); finishCall = callFinish.finishCall (bare,
// EINE Referenz wie in call-lifecycle.js); tenant = { requestTenant, requireTenant,
// tenantOwnsCall } (die EINEN Wurzel-Resolver, kein zweiter); consultDelivery = die EINE
// Consult-Zustell-Instanz (AL-P13, in server.js konstruiert - Poll-Zaehler und Drain-Flag
// leben in ihrem Closure-Scope, eine zweite Instanz haette keine Obergrenze).
export function makeCallRoutes({
  store,
  config,
  audit,
  outboundGates,
  voiceControl,
  // EL-Anrufstart (dritter Outbound-Weg): die EINE Instanz aus server.js (INV-7) - sie
  // haelt den ziehenden Ergebnisweg, eine zweite haette eine zweite Abhol-Schleife.
  // Ohne verdrahtete Instanz greift der fail-closed Ersatz: bei eingeschaltetem Schalter
  // WIRFT er in den EINEN Fehlerpfad (Call sauber beendet, Reserve frei), statt einen
  // Anruf ueber einen halb verdrahteten Weg auszuloesen.
  originateElevenLabsCall = elevenLabsCallNotWired,
  terminateAndBillCall,
  hangUpAction,
  // TEIL B (Owner-Auftrag 15.08.2026): die EL-Parallele zu hangUpAction (dieselbe DI-Naht,
  // s. telephony/call-termination.js). Der Default ist S1-5-Fix elevenLabsHangUpActionNotWired
  // (s.o.) - LAUT statt still, haelt Tests ohne EL-Wiring aber unveraendert gruen (sie
  // treffen ohnehin nie einen EL-Call).
  elevenLabsHangUpAction = elevenLabsHangUpActionNotWired,
  endActiveCall,
  billThunk,
  finishCall,
  arm: { armMaxDurationTimer, armReserveReleaseTimer },
  tenant: { requestTenant, requireTenant, tenantOwnsCall },
  consultDelivery,
  internalIdentity,
  OWNER_ID,
}) {
  const router = Router();


  // L5/I5: EINE Sichtbarkeits-Regel fuer alle Call-Routen dieser Datei (G5) - fremder
  // Tenant -> der Aufrufer antwortet 404 (kein Existenz-Leck, NICHT 403). Hinter dem
  // Flag: aus -> ungefiltert wie im Bestand (byte-identisch, auch fuer Calls ohne
  // tenantId). !call short-circuitet vor dem tenantOwnsCall-Zugriff.
  function callVisibleTo(call, tenantId) {
    return Boolean(call) && (!config.tenancy.multiTenant || tenantOwnsCall(call, tenantId));
  }

  // AL-P13: Consult #0. Keine Fragen ODER Faehigkeit nicht freigegeben -> No-op (kein
  // Datensatz, call.consults bleibt null). Rein additiv: der Anruf laeuft davon voellig
  // unberuehrt. Das Audit traegt NUR Zaehler, nie den Fragetext (Regel 4).
  function emitOpeningConsult({ req, call, context, tenantId }) {
    if (!consultAllowedFor(store.resolveProfile(tenantId))) return;
    const questions = Array.isArray(context?.open_questions) ? context.open_questions : [];
    if (!questions.length) return;
    store.emitConsult(call.id, questions);
    audit("consult_emitted", req, `call=${call.id} fragen=${questions.length}`);
  }

  // Outbound-Call starten (Vertrag laut Brief: objective/briefing/constraints/...)
  router.post("/api/calls", internalOnly, async (req, res) => {
    const b = req.body || {};
    let to = normNum(b.to);
    const objective = b.objective || b.goal;
    if (!to || !objective) return res.status(400).json({ error: "to und objective sind Pflicht" });
    // C4 (6.6): 400 VOR jedem Gate und vor dem Dial; 400 = reiner Eingabefehler -> kein Audit
    // (wie die to/objective-Pruefung oben).
    if (isTrunkZeroFormatError(to)) return res.status(400).json({ error: E164_FORMAT_ERROR });

    // P4a: der Sprachwunsch - VOR jedem Gate, vor jedem Datensatz, vor jeder Buchung
    // (E-3: kein Anruf, kein Datensatz, keine Kosten). Fehlend/"" heisst "kein Wunsch"
    // (Bestandsverhalten); alles andere MUSS im Katalog stehen.
    const requestedLanguage = b.language ? supportedLanguageOf(b.language) : null;
    if (b.language && !requestedLanguage) return res.status(400).json(unsupportedLanguageBody());
    if (requestedLanguage && !config.voice.elevenLabsOutbound.enabled)
      return res.status(400).json(languageUnavailableBody());

    // Geordnete Safety-/Geld-Gate-Kette (EINE Kettenfahrt, EIN Array, Struct-1 P6). ctx
    // transportiert Derivationen (normalisiertes to, tenantId, Absendernummer, Reserve)
    // zwischen den Gates; volle Reihenfolge + Rationale in telephony/outbound-gates.js.
    // SEC-P6: die Kette faehrt in runOutboundGates (telephony/outbound-gates.js) - dort ist
    // "ein geworfenes Gate ist eine Ablehnung" STRUKTUR und nicht Disziplin dieser Route
    // (G27). Die Senke unten ist unveraendert die einzige Stelle, an der eine Ablehnung den
    // Client erreicht (GAP-35: Audit + PII-freie Metrik, gleiche Bedingung wie bisher).
    const ctx = { req, to, objective, b };
    const denial = await runOutboundGates({ gates: outboundGates, ctx });
    if (denial) {
      beobachteAblehnung({ store, audit, denial, req, tenantId: ctx.tenantId });
      return res.status(denial.status).json(denial.body);
    }

    // Ab hier ist ctx vollstaendig durch die Gate-Kette befuellt. KRITISCH: ctx.to ist die von
    // normalize_target aufgeloeste Nummer - die lokale `to` bleibt roh und wird ab hier NICHT
    // mehr gelesen.
    // P4a (F-2 Punkt 2): der Wunsch des Auftraggebers gewinnt, sonst UNVERAENDERT die
    // Auftraggeber-Kette. Das ist die GESPRAECHSsprache; die Sprache des
    // Offenlegungssatzes entsteht getrennt und aus dem Angerufenen
    // (elevenlabs/call-locale.js#disclosureLanguageOf) und wird hier nicht beruehrt.
    const language =
      requestedLanguage ||
      store.resolveCallLanguage({ tenantId: ctx.tenantId, numberRecord: ctx.numberRecord });
    // P2b + OC-P1: beide serverseitigen Praedikate (diagnostic, calleeIsOwner) aus EINER
    // Lesung der eigenen Nummer - volle Begruendung an resolveCallPrivacyFlags (Modul-Ebene,
    // haelt diese ohnehin ueberlange Route nicht weiter wachsen, s. dortiger Kommentar).
    const { diagnostic, calleeIsOwnerOfThisCall } = resolveCallPrivacyFlags({
      store,
      config,
      ctx,
    });

    // P8 (PLAN-CONVERSATION-QUALITY-V2): Pre-Call-Briefing VOR dem Waehlen. Laeuft NUR,
    // wenn der Owner selbst keinen Kontext mitgeschickt hat (Owner-Eingabe gewinnt immer),
    // und nur hinter PRECALL_BRIEFING_ENABLED (Default aus). Fail-Soft: Fehler/Timeout/
    // Schemaverstoss -> null -> ctx.context bleibt null -> systemPrompt byte-identisch
    // zum Bestand (assistantContextSection: `!call.context -> ""`). Bewusst KEIN Gate in
    // der outboundGates-Kette (Praezedenz diagnostic oben): es lehnt nie ab und haette die
    // reihenfolge-gepinnte Safety-Kette nur verbreitert. Position NACH der Kette ist
    // Pflicht - so entstehen keine Briefing-Token fuer einen Call, den Budget-, Nummern-
    // oder KYC-Gate ohnehin ablehnen (Regel 1).
    if (!ctx.context) {
      const briefed = await fetchPrecallBriefing({
        objective: ctx.objective,
        ownerNotes: b.briefing,
        constraints: b.constraints,
        to: ctx.to,
        tenantId: ctx.tenantId,
      });
      if (briefed) {
        ctx.context = briefed.context;
        ctx.mandate = ctx.mandate || briefed.mandate;
      }
    }

    // Thema A (Auftrag 2026-08-19): die Eroeffnungszeile des ElevenLabs-Wegs entsteht
    // BEI AUFTRAGSANNAHME - vorab erzeugt, fail-closed validiert, mit Rueckfall-Treppe
    // (src/elevenlabs/opening-line.js). NUR hinter dem EL-Schalter: die beiden
    // Der TeXML-Zweig liest die Zeile nie, eine Erzeugung dort waere bezahlter Muell.
    // Position NACH der Gate-Kette wie das Briefing (Regel 1: keine LLM-Token fuer
    // einen Anruf, den ein Gate ablehnt). Die Sprache kommt aus DERSELBEN Aufloesung,
    // die der Anrufstart benutzt (callLocaleOf, elevenlabs/outbound.js) - kein zweiter
    // Sprachweg, der still divergieren koennte. Geloggt werden nur Quelle und Laenge,
    // NIE der Text (er traegt Auftragsinhalt, Regel 4).
    let openingLine = null;
    if (config.voice.elevenLabsOutbound.enabled) {
      const { ownerName } = store.tenantContext(ctx.tenantId);
      const callLocale = callLocaleOf({
        store,
        config,
        // P4a: die Gespraechssprache steht bereits fest (s. oben) und reist mit - sie
        // wird hier NICHT zum zweiten Mal aufgeloest (G5). Die Grund-Zeile entsteht in
        // der Sprache des Gespraechs, der Pflichtsatz davor in der des Angerufenen.
        call: { tenantId: ctx.tenantId, from: ctx.fromNumber, to: ctx.to, language },
        ownerName,
      });
      const opening = await fetchOpeningLine({
        objective: ctx.objective,
        tenantId: ctx.tenantId,
        locale: localeFor(callLocale.language),
      });
      openingLine = opening.line;
      console.log(`[opening-line] quelle=${opening.source} zeichen=${openingLine.length}`);
    }

    // Der /voice/outbound-Webhook rendert dank call.provider (P6a) automatisch TeXML
    // statt TwiML.
    const call = store.createCall({
      direction: "outbound",
      from: ctx.fromNumber,
      to: ctx.to,
      goal: ctx.objective,
      openingLine, // Thema A: null auf dem TeXML-Zweig (s. Block oben)
      briefing: b.briefing,
      constraints: b.constraints,
      context: ctx.context,
      mandate: ctx.mandate, // P6: serverseitig normalisiert, nie roh aus dem Body
      language,
      maxDurationS: ctx.maxDur,
      requestedBy: ctx.requestedBy,
      tenantId: ctx.tenantId,
      provider: ctx.outboundProvider,
      reserveCents: ctx.reserveCents, // OUT-05 (F2)
      diagnostic, // P2b: serverseitig aufgeloest, nie roh aus dem Body
      // OC-P1: ebenfalls rein serverseitig - der Aufrufer nennt nur `to`, alles andere
      // (eigene Nummer, Schalter, Allowlist) entscheidet der Server. Kein Client-Flag.
      calleeIsOwner: calleeIsOwnerOfThisCall,
    });
    audit(
      "place_call",
      req,
      `to=${ctx.to} call=${call.id} provider=${ctx.outboundProvider} requestedBy=${ctx.requestedBy}`,
    );

    // AL-P13 (Sprosse 3 der Fakten-Leiter): die offenen Fragen des Briefings werden
    // beantwortet, WAEHREND das Telefon klingelt - 0 ms Gespraechslatenz. Bewusst KEIN
    // Gate in der outboundGates-Kette (Praezedenz diagnostic/Briefing): es lehnt nie ab
    // und haette die reihenfolge-gepinnte Safety-Kette nur verbreitert. Position NACH
    // jedem Gate: es entsteht kein Consult fuer einen Call, den ein Gate ohnehin ablehnt.
    emitOpeningConsult({ req, call, context: ctx.context, tenantId: ctx.tenantId });

    try {
      // EL-Anrufstart: an EXAKT derselben Stelle wie der TeXML-Weg -
      // HINTER der kompletten, unveraenderten Gate-Kette (KEIN zweiter Einstieg, Regel 1).
      // Der Weichenschalter steht Default aus; aus -> der TeXML-Zweig unten laeuft
      // byte-identisch weiter. Der PROVIDER des Anrufs bleibt telnyx (die DID liegt dort,
      // ElevenLabs haengt per SIP-Trunk daran) - deshalb keine Provider-Abfrage, sondern
      // ein Engine-Schalter (s. src/elevenlabs/outbound.js).
      if (config.voice.elevenLabsOutbound.enabled) {
        // KV2-2: Kostenprofil an der Weiche, VOR dem Waehlen. Set-once (state-ops);
        // liest niemand produktiv, lehnt niemanden ab.
        store.recordCostProfile(call.id, KOSTENPROFIL.EL_CONVAI_SIP);
        await originateElevenLabsCall(call);
        // Regel 1 (Minuten-Achse): derselbe harte Max-Dauer-Cap wie im TeXML-Zweig.
        // providerCallSid=null ist Absicht (es gibt keinen twilioSid); ohne callControlId
        // faellt hangUpAction auf null - der Cap beendet und bucht den Record, stoppt die
        // Ergebnis-Abholung UND loest seit 6da29ec (elevenLabsHangUpAction, s.
        // telephony/call-lifecycle.js) den Loeschversuch beim Anbieter aus (DELETE
        // /v1/convai/conversations/{id}, S1-2b: Kommentar korrigiert - er behauptete
        // vorher das Gegenteil). OB das die Leitung tatsaechlich kappt, ist weiterhin
        // NICHT belegt (s. convai.js#endConversation).
        armMaxDurationTimer(call, null);
      } else {
        // Owner-Entscheidung 10 laeuft auf ihrem DEFAULT: dieser Zweig verzweigt NICHT
        // auf die Engine (die Weiche faellt erst im Webhook /voice/outbound), also deckt
        // telnyx_budget hier beide Engines ab. Benannte Restluecke, unerreichbar
        // solange der Boot-Riegel (h) VOICE_ENGINE=realtime verhindert.
        store.recordCostProfile(call.id, KOSTENPROFIL.TELNYX_BUDGET);
        const tw = await voiceControl(ctx.outboundProvider).originateCall({
          from: ctx.fromNumber,
          to: ctx.to,
          url: `${config.server.publicUrl}/voice/outbound?callId=${call.id}`,
          statusCallback: `${config.server.publicUrl}/voice/status?callId=${call.id}`,
          statusCallbackEvent: ["answered", "completed"],
          method: "POST",
          timeLimit: ctx.maxDur,
        });
        call.twilioSid = tw.sid;
        store.save();
        // Max-Dauer hart durchsetzen (Budget-Engine). Fuer den TeXML-Pfad der EINZIGE
        // verlaessliche Cap. Erst NACH erfolgreichem Originate armen (vorher gibt es
        // keinen providerCallSid).
        if (config.voice.voiceEngine !== VOICE_ENGINE.REALTIME) armMaxDurationTimer(call, tw.sid);
      }
      armReserveReleaseTimer(call); // OUT-05 (F2): Reserve-Backstop, BEIDE Pfade, nach erfolgreichem Originate
      res.json({
        ok: true,
        callId: call.id,
        twilioSid: call.twilioSid,
        status: "dialing",
        context_received: contextReceivedMeta(ctx.context, config), // I10
        // P2b: ehrliche Rueckmeldung, ob der Diagnose-Wunsch gewaehrt wurde. Eine still
        // verweigerte, datenschutzrelevante Anforderung ohne jede Beobachtbarkeit waere
        // ein eigener Defekt (Praezedenz: context_received/I10). NUR ein Boolean.
        diagnostic: call.diagnostic,
      });
    } catch (err) {
      // OUTBOUND-E3a (Befund C1, REIHENFOLGE-RIEGEL): der Grund wird INNERHALB von
      // persistEnd geschrieben (endFailedCallWithReason oben) - und persistEnd laeuft in
      // terminateAndBillCall garantiert VOR bill() (telephony/call-termination.js:49-51).
      // Damit ist "Grund vor Buchung" Struktur, nicht Kommentar: an dieser Naht existiert
      // keine Anweisung mehr, die sich hinter das await schieben liesse (Regressionsfang:
      // test/fehlergrund-reihenfolge-riegel.test.js). bill laeuft ueber finishCall, und
      // finishCall liest call.failureReason beim Notification-Bau UND (seit E3a) beim
      // Mailentscheid (telephony/call-finish.js:210-218); stuende der Grund spaeter, bliebe
      // der Nutzertext "<Ziel> (Status: failed)" und die not-placed-Mail bliebe aus - genau
      // die Stummheit, fuer die diese Etappe gebaut ist. Der catch umschliesst ALLE DREI
      // Engine-Zweige (:331/:345/:363) - damit bekommt auch eine Telnyx-Start-Ablehnung auf
      // dem TeXML-Weg erstmals einen Grund.
      const providerStatus = providerStatusOf(err);
      // C5 (Struct-4): die eigentliche Luecke - bisher lief hier NIE finishCall (Settlement/
      // Notification fehlten komplett bei einem Dial-Fehlschlag), und releaseReserve wurde
      // manuell dupliziert obwohl finishCall es bereits idempotent selbst aufruft (S2,
      // reserveReleased-Guard in state-ops.js). Jetzt derselbe Gateway wie die anderen 4
      // Terminierungspfade; hangUp:null (kein Dial = kein Provider-Leg zum Auflegen).
      await terminateAndBillCall({
        persistEnd: endFailedCallWithReason(store, call.id, providerStatus),
        hangUp: null,
        bill: billThunk(finishCall, store, call.id),
        callId: call.id, // P8: Settlement-Fehler-Log (terminateAndBillCall) mit Korrelation
      });
      // Rohe Provider-Message NICHT an den Client (Secret-/Param-Leak, Regel 4/5):
      // Provider-SDK-Fehler koennen URL-/Auth-/Nummern-Fragmente tragen. Serverseitig
      // secret-frei loggen (wie die P0-Guards: err.message, nie config), dem Aufrufer
      // eine generische, stabile Meldung geben.
      console.error(
        `[place_call] originate fehlgeschlagen call=${call.id}:`,
        err?.message || String(err),
      );
      // Der Adapter haengt bei einer Provider-HTTP-Ablehnung err.providerStatus an
      // (secret-frei, oben gelesen). Liegt sie vor -> kategorisierte, provider-NEUTRALE
      // Meldung mit Statusklasse (502 Upstream), damit der Aufrufer den echten Grund
      // erkennt. C-P4: der frueher hier angehaengte Twilio-Trial-Hint ist mit dem Adapter
      // entfallen - er haette nur fuer einen Anbieter gegolten, den es nicht mehr gibt.
      // Kein Roh-Body/Key an den Client (Regel 4/5).
      const body = providerStatus
        ? {
            error: `Provider hat den Anruf abgelehnt (HTTP ${providerStatus}). Account-/Nummern-Konfiguration pruefen.`,
          }
        : { error: "Anruf konnte nicht gestartet werden." };
      res.status(providerStatus ? 502 : 500).json(body);
    }
  });

  // AL-P13: kurzer Long-Poll auf das naechste Consult-Ereignis. HINTER `internalOnly`
  // (Regel 3, keine neue Auth-Ausnahme), plus callVisibleTo wie
  // GET /api/calls/:id: fremder Call -> 404 (kein Existenz-Leck, NICHT 403). Fehlende
  // Faehigkeit -> ebenfalls 404: die Existenz des Kanals ist selbst eine Information.
  // Liefert NIE Transkript/Audio - nur Ereignis, Kennung und Fragen (Regel 5).
  //
  // KEIN req.on("close")-Abbruch: ein abgebrochener Host-Request darf den Slot NICHT
  // ueber das Socket-Ereignis freigeben (genau dort schliesst routes/mcp.js Transport
  // und Server, waehrend der Handler weiterlaeuft). Der Slot faellt im finally von
  // waitForEvent, spaetestens nach der Haltezeit.
  router.get("/api/calls/:id/consult", internalOnly, async (req, res) => {
    const call = store.getCall(req.params.id);
    const tenantId = requestTenant(req);
    if (!callVisibleTo(call, tenantId)) return res.status(404).json({ error: "not found" });
    if (!consultAllowedFor(store.resolveProfile(tenantId)))
      return res.status(404).json({ error: "not found" });
    // AL-P14: der Zug des Clients ist der Beleg, dass eine Rueckfrage im Gespraech
    // ueberhaupt jemanden erreicht. Vor waitForEvent gebucht - es zaehlt die ABSICHT
    // des Clients, nicht der Ausgang des Polls. Ephemer, kein Persistenz-Pfad.
    store.noteConsultPoll(call.id);
    const event = await consultDelivery.waitForEvent({
      callId: call.id,
      tenantId: call.tenantId,
      afterEventId: typeof req.query.after === "string" ? req.query.after : null,
      signal: null,
    });
    // P2 (Stufe 0, N-10): DIES ist die Zustellung - der Client bekommt die Frage mit dieser
    // Antwort in die Hand. Bis heute war nirgends festgehalten, ob eine Rueckfrage jemals
    // einen Client ERREICHT hat; die Aufklaerung am 06.09. brauchte deshalb eine
    // Zeugenaussage statt einer Messung. Der Marker gehoert an den Datensatz und nicht in
    // waitForEvent: consult/delivery.js liest, es schreibt nicht.
    if (event.event === CONSULT_EVENT.CONSULT && event.eventId)
      store.markConsultAskDelivered(call.id, event.eventId);
    res.json(event);
  });

  // AL-P13: Antwort einspeisen. Reihenfolge bindend (Safety vor Eingabefehler):
  // Tenant-Aufloesung -> Ownership -> Faehigkeit -> Validierung.
  // Die Antwort ist FREMDBESTIMMTER Text ueber einen SCHREIBENDEN Endpunkt und laeuft
  // deshalb durch DIESELBE validateAssistantContext-Kante wie das Briefing - eine
  // zweite, eigene Laengenpruefung waere eine zweite, schwaechere Tuer in den
  // Systemprompt. Verstoss -> 400, Antwort verworfen, Consult bleibt unbeantwortet.
  router.post("/api/calls/:id/consult/answer", internalOnly, (req, res) => {
    const tenantId = requireTenant(req, res); // REJECT -> 403 (Write-403, I-Kette)
    if (!tenantId) return;
    const call = store.getCall(req.params.id);
    if (!callVisibleTo(call, tenantId)) return res.status(404).json({ error: "not found" });
    if (!consultAllowedFor(store.resolveProfile(tenantId)))
      return res
        .status(403)
        .json({ error: "Consult-Kanal ist fuer diesen Tenant nicht freigegeben." });
    const { event_id: eventId, answers, status } = req.body || {};
    // event_id ist Client-Freitext ueber einen authentifizierten Endpunkt. Format-
    // Pruefung VOR jeder Weiterverarbeitung (auch vor dem Audit-Log unten) - sonst
    // landet beliebiger Text im Forensik-Trail (Regel 4: keine Freitext-Audit-Zeile).
    if (!isConsultEventId(eventId))
      return res.status(400).json({ error: "event_id ist ungueltig" });
    // P2 (SCOPE 2): der leichte Modus. AUSDRUECKLICH ueber status und NICHT ueber ein
    // fehlendes answers-Feld: ein Client, der answers vergisst, wuerde sonst still
    // quittieren statt zu antworten - der Fehler saehe wie Erfolg aus. Fehlender status =
    // FINAL, damit jeder Bestands-Aufrufer byte-identisch bleibt.
    const statusError = invalidConsultAnswerStatus(status);
    if (statusError) return res.status(400).json({ error: statusError });
    if (status === CONSULT_ANSWER_MODE.WORKING)
      return ackWorkingConsult({ store, audit, req, res, call, eventId });
    return answerConsultFinal({ store, audit, req, res, call, eventId, answers });
  });

  // Laufenden Anruf sauber abbrechen
  router.post("/api/calls/:id/cancel", internalOnly, async (req, res) => {
    const call = store.getCall(req.params.id);
    if (!callVisibleTo(call, requestTenant(req)))
      return res.status(404).json({ error: "not found" });
    if (call.status !== "active") return res.json({ status: call.status });
    const requestedBy = internalIdentity(req) || OWNER_ID; // L5: forensisch nachvollziehbar
    audit("cancel_call", req, `call=${call.id} requestedBy=${requestedBy}`);
    // S1-4 Fix (Owner-Auftrag 15.08.2026): hangUpAction() EINMAL ausgewertet (vorher
    // zweimal identisch aufgerufen, das erste Ergebnis nur als Boolean verworfen) -
    // providerHangUp ist zugleich der Telnyx-Thunk UND die Telnyx-Form-Erkennung.
    const providerHangUp = hangUpAction(voiceControl, call, call.twilioSid);
    // Die EL-FORM des Anrufs entscheidet die ehrliche Antwort weiter unten - NICHT, ob der
    // Beende-Versuch zufaellig zustandekam. elevenlabsConversationId kann waehrend der
    // Klingelphase noch fehlen (elevenlabs/outbound.js Modul-Kopf, ~40s gemessen); ein
    // cancel_call in diesem Fenster darf trotzdem nicht die kurze, unbedingte
    // "cancelled"-Antwort bekommen. config.voice.elevenLabsOutbound.enabled ist derselbe
    // Schalter, der in POST /api/calls die drei Origination-Zweige exklusiv verzweigt (kein
    // zweiter Wortlaut, G5): steht er an, lief jeder outbound Call ohne providerHangUp durch
    // GENAU diesen Zweig - unabhaengig davon, ob die Kennung schon zurueck ist.
    const isElevenLabsCall = !providerHangUp && config.voice.elevenLabsOutbound.enabled;
    const elHangUp = isElevenLabsCall ? elevenLabsHangUpAction(endActiveCall, call) : null;
    // F10 Runde 2 (G5): derselbe Terminierungspfad wie der Max-Dauer-Cap - erst auflegen
    // (awaited, provider-aware ueber call.provider - sonst endCall ueber den falschen
    // Anbieter), dann buchen (fire-and-forget).
    await terminateAndBillCall({
      persistEnd: () => store.endCallRecord(call.id, "cancelled"),
      // P6 (Check 5): dieselbe callControlId-/twilioSid-Auswahl wie terminateCappedCall (G5,
      // EINE Quelle) - EL-Calls fallen auf den Beende-Versuch (elHangUp, s.o.).
      hangUp: providerHangUp ?? elHangUp,
      bill: billThunk(finishCall, store, call.id),
      onHangUpError: (e) => console.error("[cancel]", e.message),
      callId: call.id, // P8: Settlement-Fehler-Log (terminateAndBillCall) mit Korrelation
    });
    // S1-4 Fix: die ehrliche Antwortform gilt fuer JEDEN EL-Anruf (isElevenLabsCall), nicht
    // nur fuer die mit bereits angekommener Kennung - der Loeschversuch beim Anbieter ist
    // ohnehin NICHT belegt, die Leitung zu kappen (s. convai.js#endConversation).
    // "cancelled" behauptet auf diesem Pfad nur, was wahr ist (Datensatz storniert, Buchung
    // gestoppt), NICHT, dass die Leitung schon steht. hangup_attempted meldet zusaetzlich,
    // ob ueberhaupt ein Griff auf das Gespraech bestand (elHangUp truthy): fehlt die
    // Kennung noch (oder ist elevenLabsHangUpAction gar nicht verdrahtet, S1-5), sagt die
    // Antwort das ausdruecklich, statt einen Versuch zu behaupten, der nie stattfand. Der
    // Telnyx-Pfad (awaiteter, bestaetigter Hangup) bleibt bei der reinen Kurzantwort.
    if (isElevenLabsCall)
      return res.json({
        status: "cancelled",
        line_hangup_confirmed: false,
        max_line_s: ELEVENLABS_PROVIDER_MAX_DURATION_S,
        hangup_attempted: Boolean(elHangUp),
      });
    res.json({ status: "cancelled" });
  });

  return router;
}
