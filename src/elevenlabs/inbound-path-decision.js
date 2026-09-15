// IEL-B1: die WEICHE, ob ein eingehender Anruf ueber den ElevenLabs-Inbound-Weg laufen
// darf. Rein: kein Konfig-Import, kein IO, kein Log, kein try/catch. Fail-closed: jede
// fehlende Zutat ergibt false. Die Allowlist bedeutet leer NIEMAND, nie JEDER (Muster
// src/callee-is-owner.js). Dies ist die einzige Quelle der beiden Mindestlaengen
// (Praedikat, Boot-Riegel, spaeter Init-Route B6 und Geheimnis-Skript B10).
//
// Leser: /voice/incoming (Sprechpfad-Weiche, IEL-B8), Init-Route (IEL-B6), Boot-Riegel,
// Boot-Banner, Tests.

import { NUMBER_STATUS } from "../store/defaults.js";

export const SIP_PASSWORD_MIN_LENGTH = 32;
export const INIT_WEBHOOK_TOKEN_MIN_LENGTH = 32;
export const DID_ENDUNG_ZIFFERN = 4;
const DID_ENDUNG_PRAEFIX = "…"; // Auslassungszeichen, Quelltext bleibt ASCII
const KEINE_AKTIVE_DID = "keine aktive DID";

export const ZUGANG_MANGEL = Object.freeze({ FEHLT: "fehlt", ZU_KURZ: "zu kurz" });

function istNichtLeererString(wert) {
  return typeof wert === "string" && wert !== "";
}

function laengenMangel(wert, minLength) {
  if (!istNichtLeererString(wert)) return ZUGANG_MANGEL.FEHLT;
  return wert.length < minLength ? ZUGANG_MANGEL.ZU_KURZ : null;
}

function tenantIstGepinnt(tenantId, tenantIds) {
  if (!istNichtLeererString(tenantId)) return false;
  if (!Array.isArray(tenantIds)) return false;
  return tenantIds.includes(tenantId);
}
// Bewusste Kopie der 3-Zeilen-Logik aus callee-is-owner.js#tenantDarfAusloesen (G13): ein
// Export aus dem Offenlegungs-Modul wuerde zwei fachfremde Domaenen koppeln. Vorrang G13
// vor G5 (Duplizierung), begruendet in tasks/iel-spec.md.

// Eine Quelle fuer das Endungs-Format: Boot-Sondenzeile und Registrierungs-Inventar (IEL-B9)
// muessen dieselbe Schreibweise tragen, sonst ist der E13-Abgleich Augenmass.
export function e164Endung(e164) {
  return `${DID_ENDUNG_PRAEFIX}${e164.slice(-DID_ENDUNG_ZIFFERN)}`;
}

function didEndung(number) {
  return e164Endung(number.e164);
}

// Die einzige Stelle, die "Zugang des EL-Inbound-Wegs vollstaendig" definiert (G5).
// Praedikat und Boot-Riegel nutzen beide diese Funktion. Liefert nie einen Wert, nur
// Schluesselnamen und Mangel-Art.
export function inboundElAccessDefects({ sipUser, sipPassword, initWebhookToken }) {
  const pruefungen = [
    { envKey: "ELEVENLABS_INBOUND_SIP_USER", mangel: istNichtLeererString(sipUser) ? null : ZUGANG_MANGEL.FEHLT },
    { envKey: "ELEVENLABS_INBOUND_SIP_PASSWORD", mangel: laengenMangel(sipPassword, SIP_PASSWORD_MIN_LENGTH) },
    { envKey: "ELEVENLABS_INIT_WEBHOOK_TOKEN", mangel: laengenMangel(initWebhookToken, INIT_WEBHOOK_TOKEN_MIN_LENGTH) },
  ];
  return pruefungen.filter((pruefung) => pruefung.mangel !== null);
}

// Die vollstaendige Bedingung: Schalter an UND Tenant gepinnt UND Zugang vollstaendig.
// config ist die volle Konfig-Oberflaeche (Spec E2); B8 ruft das Praedikat mit dem
// Singleton auf.
export function inboundElPathFor({ config, tenantId }) {
  const inbound = config.voice.elevenLabsInbound;
  if (inbound.enabled !== true) return false;
  if (!tenantIstGepinnt(tenantId, inbound.tenantIds)) return false;
  return inboundElAccessDefects(inbound).length === 0;
}

// Eine Quelle fuer "n Tenants" in Banner und Sondenzeile; ein doppelter Eintrag zaehlt
// einmal.
export function inboundElPinnedTenantCount(tenantIds) {
  return new Set(tenantIds).size;
}

// Serverseitiger Tenant-DID-Beleg ohne Prod-DB: nur Anzahl und letzte Ziffern, NIE eine
// Tenant-ID oder eine volle Nummer (Regel 4/PII). number.tenantId + Status ACTIVE ist
// dieselbe Quelle, ueber die state-ops.js#numberRecordByE164 den Tenant eines Anrufs
// bestimmt. Unabhaengig vom Schalter.
export function inboundElAllowlistProbeLine({ state, tenantIds }) {
  const gepinnt = new Set(tenantIds);
  const aktiveGepinnte = state.numbers.filter(
    (number) => gepinnt.has(number.tenantId) && number.status === NUMBER_STATUS.ACTIVE,
  );
  const endungen = aktiveGepinnte.map(didEndung).sort();
  const didTeil = endungen.length > 0 ? `aktive DIDs ${endungen.join(", ")}` : KEINE_AKTIVE_DID;
  return `Inbound-EL-Allowlist: ${inboundElPinnedTenantCount(tenantIds)} Tenants, ${didTeil}`;
}
