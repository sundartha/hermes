// ---- Rueckfrage-Webhook des ElevenLabs-Laufwerks (Werkzeug get_consult) --------------
// Der Agent des Anbieters fuehrt das Gespraech und ruft dieses Werkzeug MITTEN im
// laufenden, kostenden Anruf auf: er haelt seinen Request offen und legt unsere Antwort
// seinem Modell als Werkzeug-Ergebnis vor (Frage-Antwort-Zyklus, kein
// Feuern-und-Vergessen). Die Wirkung laeuft ueber den BESTEHENDEN Consult-Kanal
// (call.consults, AL-P13) - kein zweiter Rueckfrage-Weg neben dem, den
// await_call_event/answer_consult schon bedienen.
//
// AUTH-AUSNAHME (Absolute Regel 3, begruendet - Eintrag in src/route-policy.js):
// HANDLER-INTERNE AUTH. ElevenLabs ruft serverseitig und kann keinen Session-Cookie
// senden; es SIGNIERT Werkzeug-Webhooks auch nicht (es gibt nur frei konfigurierbare
// Request-Header, s. elevenlabs/agent_configs/outbound-agent.template.json). Die einzige
// Sicherung ist deshalb das geteilte Geheimnis im Header x-hermes-tool-token, timing-sicher
// (safeEqual) gegen ELEVENLABS_TOOL_TOKEN geprueft, BEVOR irgendetwas anderes geschieht -
// leerer config-Wert lehnt JEDEN Aufruf ab (fail-closed, nie offen). NICHT unter /voice
// gemountet: die Ed25519-Signaturpruefung des Providers gilt dort weiter unveraendert.
//
// REIHENFOLGE DER SICHERUNGEN ist bindend und steht im Handler noch einmal einzeln:
// Geheimnis -> Bindung an einen laufenden Anruf (und damit an seinen Mandanten) ->
// Faehigkeit -> Geld -> erst dann die Wirkung. Es gibt keinen "anfragenden Mandanten":
// der Webhook traegt ausser dem Plattform-Token keine Identitaet, der Mandant kann NUR aus
// dem gebundenen Anruf kommen.
import { Router } from "express";
import { blockingBudgetAxis } from "../budget-gate.js";
import { consultAllowedFor } from "../consult/gate.js";
import { CONSULT_RESULT } from "../conversation/consult-raised.js";
import { localeFor } from "../i18n/locales.js";
import { safeEqual } from "../util.js";

// Pfad + Header als benannte Konstanten (G25): beide stehen so in der Agenten-Vorlage.
export const ELEVENLABS_CONSULT_PATH = "/webhooks/elevenlabs/consult";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";

// Die drei Ablehnungscodes. 402 nach dem Bestandsmuster der Geld-Denials
// (telephony/outbound-gates.js), 404 statt 403 nach dem Bestandsmuster der Call-Routen
// (kein Existenz-Leck), 403 fuer das Geheimnis.
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

// Was das Laufwerk seinem Modell als Werkzeug-Ergebnis vorlegt. Alle drei Texte sind
// bestehende, sprachrichtige Steuertexte (i18n/prompts/*) - der Server erfindet hier keine
// neue Rede. Eine Antwort OHNE uebernommene Fakten (der geteilte key_facts-Deckel war voll)
// traegt denselben Text wie der Zeitablauf: es gibt nichts, was der Agent aussprechen
// koennte, und ein leerer Antworttext waere die schlechtere Luege.
function toolResultText(outcome, locale) {
  const control = locale.prompt.turnControl;
  if (outcome.kind === CONSULT_RESULT.REJECTED) return control.consultDeclined;
  return outcome.facts.length ? outcome.facts.join(" ") : control.consultTimeout;
}

/**
 * @param {{store: object, config: object, onConsultRaised: Function}} deps
 *   onConsultRaised = die Wirkung am bestehenden Consult-Kanal
 *   (conversation/consult-raised.js), als Naht hereingereicht.
 */
export function makeElevenLabsWebhookRoutes({ store, config, onConsultRaised }) {
  const router = Router();

  // Jede greifende Sicherung wird LAUT statt stumm (Diagnose-Muster des Brain-Shims):
  // ausschliesslich der Grund-Token und - wo vorhanden - die server-eigene Call-Kennung.
  // NIE die Nutzlast, nie ein Stueck des Geheimnisses (Absolute Regel 4).
  function denied(res, status, grund) {
    console.log(`[el-consult] abgelehnt grund=${grund}`);
    return res.status(status).json({ error: grund });
  }

  // Bindung ueber die opake Anbieter-Kennung am Call-Datensatz - dasselbe Muster wie das
  // bestehende Provider-Handle telnyxConversationId. NUR ein laufender Anruf ist bindbar:
  // eine Rueckfrage nachtraeglich in ein beendetes Gespraech zu reichen ist derselbe
  // Angriff wie eine erfundene Kennung. Kein Rueckfall auf "irgendeinen laufenden Anruf".
  function activeCallByConversationId(conversationId) {
    if (typeof conversationId !== "string" || !conversationId) return null;
    const calls = store.load().calls;
    return (
      calls.find(
        (call) => call.elevenlabsConversationId === conversationId && call.status === "active",
      ) || null
    );
  }

  // Faehigkeits-Schnittmenge des Kanals (consult/gate.js) PLUS das eigene Flag der
  // Rueckfrage IM Gespraech: diese Frage entsteht aus FREMDER Rede - der Angerufene hat
  // dem nie zugestimmt, und genau dafuer existiert IN_CALL_CONSULT_ENABLED getrennt vom
  // Kanal-Flag. Ohne diesen Faktor waere der neue Weg die Umgehung eines Datenschutz-Gates,
  // das der alte Weg respektiert.
  function consultAllowed(call) {
    return (
      config.tenancy.inCallConsultEnabled === true &&
      consultAllowedFor(store.resolveProfile(call.tenantId))
    );
  }

  router.post(ELEVENLABS_CONSULT_PATH, async (req, res) => {
    // 1) Geteiltes Geheimnis - VOR jedem Store-Zugriff, jeder Zustandsaenderung und jeder
    // Protokollzeile, die Inhalt tragen koennte. Leerer config-Wert -> 403 statt "nichts
    // zu pruefen" (Empty-Secret-Trap: safeEqual("", "") waere true).
    const secret = config.voice.elevenLabsToolToken;
    if (!secret || !safeEqual(req.get(TOOL_TOKEN_HEADER) || "", secret))
      return denied(res, HTTP_FORBIDDEN, "token");

    // 2) Bindung an Anruf und damit an den Mandanten.
    const call = activeCallByConversationId(req.body?.conversation_id);
    if (!call) return denied(res, HTTP_NOT_FOUND, "kein_laufender_anruf");

    // 3) Faehigkeit. Fehlt sie -> 404 wie an der /api-Kante: die Existenz des Kanals ist
    // selbst eine Information.
    if (!consultAllowed(call)) return denied(res, HTTP_NOT_FOUND, "kanal_nicht_freigegeben");

    // 4) Geld (Absolute Regel 1): die gerissene pro-Tenant-Decke sperrt AUCH diesen Weg -
    // eine Rueckfrage haelt das Gespraech offen und kostet damit Leitungsminuten.
    const budgetAxis = blockingBudgetAxis({
      store,
      billing: config.billing,
      tenantId: call.tenantId,
    });
    if (budgetAxis) return denied(res, HTTP_PAYMENT_REQUIRED, budgetAxis);

    // 5) Wirkung - erst hier entsteht ein Datensatz.
    const outcome = await onConsultRaised({ callId: call.id, question: req.body?.question });
    console.log(`[el-consult] call=${call.id} ergebnis=${outcome.kind}`);
    res.json({ status: outcome.kind, answer: toolResultText(outcome, localeFor(call.language)) });
  });

  return router;
}
