// OUTBOUND-E5 (F3): Lebenszyklus EINER ElevenLabs-SIP-Nummernregistrierung. Getrennt von der
// AUSWAHL (telephony/absender-registrierung.js, rein): hier liegt das Netz, dort die
// Entscheidung. IO injiziert (fetchImpl), damit jeder Test gegen eine Attrappe faehrt.
//
// DIE TRUNK-VORLAGE IST GEMESSEN, NICHT GERATEN: sie ist die outbound_trunk-Projektion der
// heute bestehenden Registrierung (GET /v1/convai/phone-numbers, 2026-08-29).
// inbound_trunk_config wird BEWUSST WEGGELASSEN - der Inbound laeuft ueber die
// Telnyx-Voice-Application, nicht ueber diesen Trunk; eine Inbound-Freigabe waere eine
// Berechtigung ohne Zweck.
import { listPhoneNumbers, createPhoneNumber, deletePhoneNumber } from "./convai.js";

const TRUNK_ADRESSE = "sip.telnyx.com"; // gemessen; kein Env-Knopf, kein Betriebs-Tuning
const TRUNK_TRANSPORT = "tcp";
const TRUNK_MEDIA_ENCRYPTION = "disabled";
const TRUNK_CODECS = Object.freeze(["PCMU/8000"]);

export function registrierungsKoerper({ e164, numberId, agentId, sipUser, sipPasswort }) {
  return {
    phone_number: e164,
    // Label = unsere interne Nummern-ID: stabil, PII-frei, joint zurueck auf den Datensatz.
    label: `hermes-${numberId}`,
    provider: "sip_trunk",
    agent_id: agentId,
    outbound_trunk_config: {
      address: TRUNK_ADRESSE,
      transport: TRUNK_TRANSPORT,
      media_encryption: TRUNK_MEDIA_ENCRYPTION,
      credentials: { username: sipUser, password: sipPasswort },
      enabled_codecs: [...TRUNK_CODECS],
    },
  };
}

// Review-Blocker Runde 1 (Blocker 1/2/G4): die FAIL-CLOSED-Zusage unten war bis hierher nur
// Kommentar - weder hier noch am Injektions-Gate (provisioning-orchestrator.js) wurden
// apiKey/agentId/SIP-Zugangsdaten je geprueft. Fehlten sie, registrierte ensureRegistration
// beim Anbieter mit LEEREN credentials/agent_id - ein echter Schreibzugriff, dessen Ergebnis
// (falls vom Anbieter angenommen) als funktionierende Registrierung persistiert wurde
// (attachNumberRegistration ist set-once, der Schaden war danach NICHT mehr reparierbar).
// Die Pruefung steht bewusst HIER (nicht im Injektions-Gate des Orchestrators): sie deckt
// JEDEN Aufrufer ab (Orchestrator UND den CLI-Reparaturlauf), nicht nur den einen.
export function fehlendeZugangsdaten({ el, sipUser, sipPasswort }) {
  if (!el?.apiKey) return "ELEVENLABS_API_KEY fehlt";
  if (!el?.agentId) return "ELEVENLABS_AGENT_ID fehlt";
  if (!sipUser) return "TELNYX_SIP_TRUNK_USERNAME fehlt";
  if (!sipPasswort) return "TELNYX_SIP_TRUNK_PASSWORD fehlt";
  return null;
}

// FAIL-CLOSED, NIE STILLES GRUEN: fehlt Schluessel/Agent/SIP-Zugang, wird NICHT "nichts zu
// tun" gemeldet, sondern geworfen - der Aufrufer zaehlt das als eigenen, benannten
// Fehlschlag.
export function makeElSipRegistrar({ el, sipUser, sipPasswort, fetchImpl = fetch, logger = console }) {
  // Schloss #2 (Wiederanlauf): existiert die Nummer beim Anbieter schon, wird ihre Kennung
  // UEBERNOMMEN. Deckt den Fall "angelegt, aber vor dem Persistieren abgestuerzt" ab, ohne
  // sich auf eine Anbieter-Garantie zu stuetzen, die UNBELEGT ist.
  async function ensureRegistration({ e164, numberId }) {
    // VOR jedem Netzzugriff (auch vor dem GET) - ein Aufruf mit leeren Zugangsdaten liefe
    // sonst als echter, folgenreicher Anbieter-Schreibzugriff durch.
    const grund = fehlendeZugangsdaten({ el, sipUser, sipPasswort });
    if (grund) throw new Error(`ElevenLabs-Nummernregistrierung: ${grund}`);
    const bestand = (await listPhoneNumbers({ fetchImpl, account: el })).find(
      (eintrag) => eintrag.phone_number === e164,
    );
    if (bestand?.phone_number_id) return { phoneNumberId: bestand.phone_number_id, angelegt: false };
    const { phoneNumberId } = await createPhoneNumber({
      fetchImpl,
      account: el,
      body: registrierungsKoerper({ e164, numberId, agentId: el.agentId, sipUser, sipPasswort }),
    });
    if (!phoneNumberId)
      throw new Error("ElevenLabs-Nummernregistrierung lieferte keine phone_number_id");
    return { phoneNumberId, angelegt: true };
  }

  // Freigabe-Protokoll (release-reconcile.js): fail-soft, nie werfen (Muster
  // deletePhoneNumber selbst) - eine haengende Anbieter-API darf die Freigabe unserer
  // Nummer nicht blockieren. logger nur fuer den benannten Fehlschlag, PII-/Secret-frei.
  async function removeRegistration(phoneNumberId) {
    const { accepted, status } = await deletePhoneNumber({ fetchImpl, account: el, phoneNumberId });
    if (!accepted)
      logger.warn(
        `[el-registrierung] Loeschversuch FEHLGESCHLAGEN phone_number_id=${phoneNumberId} status=${status ?? "unbekannt"} - Waise beim Anbieter moeglich, s. Reparaturlauf`,
      );
    return { accepted, status };
  }

  return { ensureRegistration, removeRegistration };
}
