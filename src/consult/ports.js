// Consult-Ports: Vertraege des Rueckfrage-Kanals zwischen Anruf und MCP-Client.
// Reine JSDoc-Typdefs, keine Laufzeit-Logik (Muster src/research/ports.js).
//
// DER RUECKKANAL IST TOT (A2, PLAN-ASSISTANT-LEAP): Sampling/Elicitation/MRTR/Tasks
// sind in claude.ai UND ChatGPT unbrauchbar. Der EINZIGE belegte Kanal ist der vom
// Client GEZOGENE Tool-Aufruf. Jeder Adapter hinter diesem Port ist deshalb ein
// WARTE-Adapter (der Client fragt), nie ein Push-Adapter.

/**
 * @typedef {Object} ConsultEvent
 * @property {"consult"|"done"|"none"} event
 * @property {string|null} eventId    Kennung des offenen Consults ("c0", "c1", ...) bzw. null
 * @property {string[]} questions     Offene Fragen dieses Consults (leer ausser bei event="consult")
 */

/**
 * @typedef {Object} ConsultDelivery
 * @property {(input: {callId: string, tenantId: string, afterEventId: string|null,
 *                     signal: AbortSignal|null}) => Promise<ConsultEvent>} waitForEvent
 *   Haelt kurz offen und liefert das naechste Ereignis ODER {event:"none"}. Wirft NIE
 *   wegen Zeitablauf - Zeitablauf IST ein gueltiges Ergebnis.
 * @property {(callId: string, tenantId: string, run: () => Promise<any>) =>
 *             Promise<{granted: boolean, value: any}>} withOpenSlot
 *   Belegt EINEN der Slots dieses Kanals fuer die Dauer von run und gibt ihn danach
 *   zwingend wieder frei. granted=false heisst: die Obergrenze (Call oder Mandant) ist
 *   erreicht, run wurde NICHT ausgefuehrt. Fuer blockierende Halter ausserhalb von
 *   waitForEvent (Rueckfrage-Webhook des Laufwerks) - sie zaehlen auf DIESELBEN Zaehler.
 * @property {() => void} releaseOpenPolls
 *   Loest ALLE offenen Warter auf (Shutdown-Drain). Nebeneffekt im Namen (N7).
 * @property {() => boolean} isDraining
 *   Dasselbe Drain-Signal, gelesen statt gesetzt: Warter ausserhalb von waitForEvent
 *   fragen hier nach und loesen beim Shutdown ebenfalls auf.
 * @property {(callId: string) => number} openPollCount  Diagnose/Test.
 */
