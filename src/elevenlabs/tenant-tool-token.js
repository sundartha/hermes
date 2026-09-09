// ---- Die Mandanten-Dimension des ElevenLabs-Werkzeug-Tokens (SEC-P4) -----------------
// GEMESSENER DEFEKT: das Geheimnis im Header x-hermes-tool-token ist EIN Wert fuer ALLE
// Mandanten. Wer ihn hat, erreicht jeden laufenden Anruf jedes Mandanten, sobald er dessen
// Gespraechskennung kennt - die Bindung (activeCallBoundTo) fragt nur, OB ein laufender
// Anruf zu der Kennung gehoert, nie, ob der Aufrufer fuer DIESEN Mandanten sprechen darf.
//
// WARUM DIE DIMENSION VOM ANRUFSTART KOMMT UND NICHT AUS DEM HEADER: am Anbieter gibt es
// EINE geteilte Agenten-Konfiguration mit zwei Werkzeugen, und der Header traegt je
// Werkzeug GENAU EINEN Wert (eine secret_id auf ein Workspace-Secret, s.
// elevenlabs/agent_configs/outbound-agent.template.json). Ein per-Mandant
// unterschiedlicher Header ist dort nicht konfigurierbar. Der einzige Kanal, ueber den
// etwas Anruf-Eigenes zum Agenten reist, sind die dynamic_variables des Anrufstarts, und
// der einzige Weg, es im Werkzeug-Anfragekoerper zurueckzubekommen, ist eine
// request_body_schema-Property mit dynamic_variable - genau die Mechanik, die
// conversation_id heute schon benutzt.
//
// WARUM KEIN ZWEITES GEHEIMNIS: der Wert wird aus DEMSELBEN Plattform-Token abgeleitet,
// gegen das der Webhook den Header prueft. Beide Seiten rechnen, NICHTS wird persistiert -
// eine Rotation bleibt EIN Fall, es gibt keine neue Spalte, keinen Backfill und keine N
// Mandanten-Geheimnisse, die auseinanderlaufen koennten.
//
// GRENZE, ehrlich benannt: die Ableitung schuetzt NICHT gegen einen Angreifer, der das
// Plattform-Token UND die Mandanten-Kennung besitzt - er kann den Wert selbst ausrechnen.
// Sie nimmt dem einen geteilten Token seine QUER-MANDANTEN-REICHWEITE: ein Aufruf, der
// fuer Mandant A ausgestellt wurde, passt an keinem Anruf von Mandant B.
import { createHmac } from "node:crypto";

import { safeEqual } from "../util.js";

const HMAC_ALGORITHM = "sha256";
// Versions-Praefix im abgeleiteten Text: eine kuenftige Aenderung der Ableitung bekommt
// ein eigenes Praefix und kollidiert nicht mit alten Werten.
const DERIVATION_VERSION = "v1";

/**
 * Der aus Geheimnis + Mandant abgeleitete Werkzeug-Token dieses Mandanten.
 * "" heisst: nicht ableitbar - EINE Leerform, nie null und nie undefined, damit
 * Sende- und Pruefseite dieselbe kennen.
 */
export function tenantToolToken({ secret, tenantId }) {
  if (typeof secret !== "string" || !secret) return "";
  if (typeof tenantId !== "string" || !tenantId) return "";
  return createHmac(HMAC_ALGORITHM, secret)
    .update(`${DERIVATION_VERSION}:${tenantId}`)
    .digest("hex");
}

// Drei Ausgaenge, weil der Aufrufer sie VERSCHIEDEN behandelt: FEHLT ist der
// Uebergangsfall (die heutige Anbieter-Konfiguration schickt den Wert noch nicht mit)
// und haengt am scharfen Schalter; FREMD ist immer eine Ablehnung.
export const TENANT_TOKEN_VERDICT = Object.freeze({
  PASSEND: "passend",
  FEHLT: "fehlt",
  FREMD: "fremd",
});

/**
 * Urteil ueber den vorgelegten Wert - timing-sicher (safeEqual, Absolute Regel 3).
 * FAIL-CLOSED: laesst sich der Sollwert nicht ableiten, ist das Urteil FREMD, nie PASSEND.
 */
export function tenantTokenVerdict({ secret, tenantId, presented }) {
  if (typeof presented !== "string" || !presented) return TENANT_TOKEN_VERDICT.FEHLT;
  const erwartet = tenantToolToken({ secret, tenantId });
  if (!erwartet) return TENANT_TOKEN_VERDICT.FREMD;
  return safeEqual(presented, erwartet)
    ? TENANT_TOKEN_VERDICT.PASSEND
    : TENANT_TOKEN_VERDICT.FREMD;
}
