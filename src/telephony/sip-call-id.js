// ---- Waechter: sieht dieser Wert wie eine Telnyx-sip_call_id aus? ---------------------
// Blatt-Modul OHNE Imports, Muster telephony/number-denylist.js: eine reine Form-Aussage
// ueber einen Telefonie-Fakt. Genau deshalb darf die config-freie Store-Schicht
// (store/state-ops.js) sie importieren, und genau dort sitzt der einzige Aufrufer - am
// Schreibweg des Feldes, den BEIDE Backends (json und pg) gemeinsam benutzen.
//
// WOZU: sip_call_id ist der EINZIGE Join zwischen den beiden Kostenquellen der SIP-Trunk-
// Strecke - dem Telefonie-Beleg von Telnyx (GET /v2/detail_records, record_type
// sip-trunking) und dem Gespraechs-Datensatz von ElevenLabs. Am 17.08.2026 ist an einem
// echten Anruf gemessen worden, dass dieser Join ins Leere lief, und die Wurzel war ein
// FELDNAME statt einer Messung (.fortschritt.md, "ANRUF 2 / BEFUND 4"):
//
//   ElevenLabs POST /v1/convai/sip-trunk/outbound-call -> sip_call_id "SCL_Qu4voPd3TXvD"
//   Telnyx     GET  /v2/detail_records                 -> sip_call_id "otb_4801m08d8gnce3xs4xpka1h3773a"
//
// ZWEI FELDER, AN BEIDEN ENDEN "sip_call_id" GENANNT, MIT VERSCHIEDENEN WERTEN. Der Wert
// aus der Anrufstart-Antwort ist in Wahrheit ElevenLabs' call_sid - derselbe Anruf fuehrt
// ihn im Gespraechs-Datensatz woertlich unter metadata.phone_call.call_sid. Nur der
// "otb_"-Wert findet den Telefonie-Beleg.
//
// GEMESSENE WERTE, an denen die Form kalibriert ist (vier Stueck, zwei Tage, BEIDE Enden -
// s. test/fixtures/elevenlabs-conversations.js und .fortschritt.md):
//   otb_8901m0856krnfsbvtab8zcy7r35v   otb_7701m02dx3t8emg9w4wg6h4vnrek
//   otb_4601m02e503rek1b0vxwjvtxtgfw   otb_4801m08d8gnce3xs4xpka1h3773a
// Alle vier: die Kennung "otb_" plus 28 Zeichen.
//
// BEWUSST LOCKER (die Auflage lautet, den Fall von heute zu fangen, ohne bei einer
// harmlosen Formaenderung des Anbieters faelschlich anzuschlagen): geprueft wird NUR die
// Namensraum-Kennung - ohne Ruecksicht auf Gross-/Kleinschreibung - und eine
// Mindestlaenge des Rumpfes, die mit 8 weit unter den gemessenen 28 liegt. Zeichenvorrat,
// Trennzeichen und Rumpflaenge duerfen sich also aendern, ohne dass ein richtiger
// Schluessel verloren geht. Was durchfaellt, ist ein Wert aus einem FREMDEN Namensraum
// (der Fall von heute) und eine leere Huelse.
//
// PREIS, bewusst getragen: aendert der Anbieter die Kennung selbst ("otb_" -> etwas
// anderes), weist der Waechter richtige Schluessel ab. Er meldet das an seinem Aufrufer
// LAUT (store/state-ops.js#recordSipCallId), und der Verlust ist derselbe wie ohne
// Messwert - ein leeres Feld. Ein FALSCHER Wert waere schlechter als ein leeres Feld: er
// joint ebenfalls nicht, belegt aber zusaetzlich den set-once-Platz der richtigen Quelle
// und behauptet eine Zuordnung, die es nicht gibt.
const TELNYX_SIP_CALL_ID_PREFIX = "otb_";

// Grosszuegig: gemessen sind 28 Zeichen. Der Wert soll nur verhindern, dass ein blosser
// Praefix-Stumpf ("otb_") oder ein Platzhalter als Schluessel durchgeht.
const TELNYX_SIP_CALL_ID_MIN_RUMPF_LEN = 8;

/**
 * Sieht der Wert aus wie die sip_call_id, die auf dem Telnyx-Beleg steht? Nimmt jeden
 * Typ entgegen (der Aufrufer liest aus einer Anbieter-Antwort) - alles, was kein
 * nicht-leerer String der erwarteten Form ist, ist false.
 * @param {unknown} wert
 * @returns {boolean}
 */
export function isTelnyxSipCallId(wert) {
  if (typeof wert !== "string") return false;
  if (!wert.toLowerCase().startsWith(TELNYX_SIP_CALL_ID_PREFIX)) return false;
  return wert.length - TELNYX_SIP_CALL_ID_PREFIX.length >= TELNYX_SIP_CALL_ID_MIN_RUMPF_LEN;
}
