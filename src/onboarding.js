// Onboarding-Orchestrierung (zahlungsfrei): fuehrt eine 'requested' Nummer ueber
// den echten Provider-Kauf zu 'active'. Trennt die UNREINE Provider-IO (injizierter
// provisioner, DIP/P4) von der reinen State-Machine (state-ops). KEIN store.save()
// hier - der Aufrufer (Route) persistiert; KEIN config-Zugriff - Parameter werden
// hereingereicht (testbar mit makeDefaultState + Fake-Provisioner).
//
// Geld-Sicherheit (R4): eine Nummer erreicht 'active' NUR nach erfolgreichem Order
// UND Configure (Voice-Routing). Schlaegt Configure nach dem Kauf fehl, wird die
// Nummer beim Provider wieder FREIGEGEBEN (kein bezahlter Orphan) und der Zustand
// faellt auf 'failed'. Der Idempotency-Key (number-id-basiert) verhindert
// Doppelkaeufe bei Retry. Die Cap-Notbremse (maxNumbers) sitzt VOR diesem Schritt
// (requestNumber) - hier wird nur eine bereits angefragte Nummer durchgereicht.
import {
  beginProvisioning,
  activateNumber,
  failNumber,
  releaseNumber,
  findNumber,
} from "./store/state-ops.js";

// Orchestriert requested -> provisioning -> (search + order + configure) -> active.
// Fehlerpfade: search/order-Fehler -> failed (kein Geld geflossen); configure-Fehler
// nach dem Kauf -> Provider-Release + failed. Liefert die aktivierte Nummer.
export async function provisionNumber(s, provisioner, { numberId, countryCode, connectionId, type }) {
  const number = findNumber(s, numberId);
  if (!number) throw new Error(`provisionNumber: Nummer ${numberId} nicht gefunden`);
  beginProvisioning(s, numberId); // requested -> provisioning (fail-closed Transition)

  // Idempotency-Key an die number-id gebunden: ein Retry desselben Provisioning
  // kauft beim Provider nie doppelt (Plan-Schloss 3).
  const idempotencyKey = `order_${numberId}`;

  let ordered;
  try {
    const candidates = await provisioner.searchNumbers({ countryCode, type, limit: 1 });
    const candidate = candidates[0];
    if (!candidate) throw new Error("provisionNumber: keine kaufbare Nummer verfuegbar");
    ordered = await provisioner.orderNumber({ e164: candidate.e164, idempotencyKey });
  } catch (err) {
    failNumber(s, numberId); // provisioning -> failed (kein Kauf zustande gekommen)
    throw err;
  }

  try {
    await provisioner.configureNumber({ providerNumberId: ordered.providerNumberId, connectionId });
  } catch (cfgErr) {
    // Gekauft, aber Voice-Routing fehlgeschlagen -> Zustand failed, dann die
    // Provider-Nummer freigeben (kein bezahlter Orphan). NUR wenn der Provider-
    // Release SAUBER durchlaeuft, wird der Datensatz terminal 'released'; sonst
    // bleibt er 'failed' (moeglicher Orphan -> manuelle Reconciliation, durch die
    // MAX_NUMBERS-Cap gedeckelt). Der Configure-Fehler wird in jedem Fall geworfen.
    failNumber(s, numberId); // provisioning -> failed
    try {
      await provisioner.releaseNumber(ordered.providerNumberId);
      releaseNumber(s, numberId); // failed -> released (Provider-Nummer sauber weg)
    } catch {
      /* Provider-Release fehlgeschlagen -> Zustand bleibt 'failed' (Reconciliation) */
    }
    throw cfgErr;
  }

  return activateNumber(s, numberId, { e164: ordered.e164, providerNumberId: ordered.providerNumberId });
}
