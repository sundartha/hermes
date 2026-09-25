// IEL-B1: die WEICHE, ob ein eingehender Anruf ueber den ElevenLabs-Inbound-Weg laufen
// darf. Rein: kein Konfig-Import, kein IO, kein Log, kein try/catch. Fail-closed: jede
// fehlende Zutat ergibt false. Die Allowlist bedeutet leer NIEMAND, nie JEDER (Muster
// src/callee-is-owner.js). Dies ist die einzige Quelle der beiden Mindestlaengen
// (Praedikat, Boot-Riegel, spaeter Init-Route B6 und Geheimnis-Skript B10).
//
// IEX-A9 (E9): dreiwertig - inboundPfadEntscheidung liefert INBOUND_PATH.BUDGET | ELEVENLABS |
// ABGEWIESEN. Fail-closed: jede fehlende Zutat ergibt nie ELEVENLABS. Unter registrierte_dids wirkt
// nur ein Beleg mit dem Fingerabdruck des LAUFENDEN Zugangs (Rotation macht alte Belege sofort
// unwirksam, netzunabhaengig). Leser: /voice/incoming (Weiche), Init-Route Stufe 3
// (inboundElPathFor), Beleg-Sweep (Fingerabdruck), Boot-Riegel, Boot-Banner, Tests.

import { createHash } from "node:crypto";
import { NUMBER_STATUS } from "../store/defaults.js";
import { INBOUND_PATH } from "../telephony/inbound-path.js";
import { INBOUND_EL_SCOPE } from "./inbound-scope.js";

export const SIP_PASSWORD_MIN_LENGTH = 32;
export const INIT_WEBHOOK_TOKEN_MIN_LENGTH = 32;
export const DID_ENDUNG_ZIFFERN = 4;
const DID_ENDUNG_PRAEFIX = "…"; // Auslassungszeichen, Quelltext bleibt ASCII
const KEINE_AKTIVE_DID = "keine aktive DID";

export const ZUGANG_MANGEL = Object.freeze({ FEHLT: "fehlt", ZU_KURZ: "zu kurz" });

// Exportiert fuer den Registrierungs-Beleg (inbound-trunk-beleg.js, IEX-A8): dieselbe
// Leer-Definition wie Praedikat und Boot-Riegel (G5), keine dritte Kopie.
export function istNichtLeererString(wert) {
  return typeof wert === "string" && wert !== "";
}

export const ZUGANG_FP_HEX_ZEICHEN = 16;
const FP_ALGORITHMUS = "sha256";
const FP_KODIERUNG = "hex";

// 16 Hex von SHA-256 ueber den SIP-Benutzer - nie das Passwort. Leer/kein String -> null
// (fail-closed: ohne Zugang gibt es keinen Fingerabdruck, also auch keinen Beleg). Lebt neben der
// Zugangs-Definition (IEX-A9): Weiche und Beleg-Sweep lesen dieselbe Funktion, ohne Import-Zyklus.
export function zugangsFingerabdruck(sipUser) {
  if (!istNichtLeererString(sipUser)) return null;
  const hash = createHash(FP_ALGORITHMUS).update(sipUser);
  return hash.digest(FP_KODIERUNG).slice(0, ZUGANG_FP_HEX_ZEICHEN);
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

// Schalter an UND Zugang vollstaendig - Voraussetzung jedes Scopes (E9).
function inboundWegBereit(inbound) {
  return inbound.enabled === true && inboundElAccessDefects(inbound).length === 0;
}

// E8/E9: ein Beleg wirkt nur mit dem Fingerabdruck des laufenden Zugangs. G3: fehlende Seite gilt nie
// als Uebereinstimmung.
function belegGiltFuerLaufendenZugang({ numberRecord, sipUser }) {
  const laufenderFp = zugangsFingerabdruck(sipUser);
  if (!istNichtLeererString(laufenderFp)) return false;
  return Boolean(numberRecord?.elInboundTrunkBelegtAt) && numberRecord.elInboundTrunkZugangFp === laufenderFp;
}

function entscheidungNachAllowlist({ inbound, tenantId }) {
  return tenantIstGepinnt(tenantId, inbound.tenantIds) ? INBOUND_PATH.ELEVENLABS : INBOUND_PATH.BUDGET;
}

// Tenant-Liste ohne Wirkung; ohne gueltigen Beleg keine Uebergabe und kein Budget-Gespraech (O5).
function entscheidungNachBeleg({ inbound, numberRecord }) {
  return belegGiltFuerLaufendenZugang({ numberRecord, sipUser: inbound.sipUser })
    ? INBOUND_PATH.ELEVENLABS
    : INBOUND_PATH.ABGEWIESEN;
}

// IEX-A9 (E9): die Weiche je Anruf. config ist die volle Konfig-Oberflaeche (Spec E2); numberRecord =
// die angerufene, aktive DID (numberRecordByE164). Unbekannter Scope -> BUDGET (heutiger Weg); in
// Produktion unerreichbar, der Boot-Befund ist fatal.
export function inboundPfadEntscheidung({ config, tenantId, numberRecord }) {
  const inbound = config.voice.elevenLabsInbound;
  if (!inboundWegBereit(inbound)) return INBOUND_PATH.BUDGET;
  if (inbound.scope === INBOUND_EL_SCOPE.REGISTRIERTE_DIDS) return entscheidungNachBeleg({ inbound, numberRecord });
  if (inbound.scope === INBOUND_EL_SCOPE.ALLOWLIST) return entscheidungNachAllowlist({ inbound, tenantId });
  return INBOUND_PATH.BUDGET;
}

// Boolesche Sicht fuer die Init-Route (Stufe 3): nur ELEVENLABS bindet.
export function inboundElPathFor({ config, tenantId, numberRecord }) {
  return inboundPfadEntscheidung({ config, tenantId, numberRecord }) === INBOUND_PATH.ELEVENLABS;
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
