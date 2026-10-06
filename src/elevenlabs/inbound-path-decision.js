import { createHash } from "node:crypto";
import { NUMBER_STATUS } from "../store/defaults.js";
import { INBOUND_PATH } from "../telephony/inbound-path.js";
import { INBOUND_EL_SCOPE } from "./inbound-scope.js";

export const SIP_PASSWORD_MIN_LENGTH = 32;
export const INIT_WEBHOOK_TOKEN_MIN_LENGTH = 32;
export const DID_ENDUNG_ZIFFERN = 4;
const DID_ENDUNG_PRAEFIX = "…";
const KEINE_AKTIVE_DID = "keine aktive DID";

export const ZUGANG_MANGEL = Object.freeze({ FEHLT: "fehlt", ZU_KURZ: "zu kurz" });

export function istNichtLeererString(wert) {
  return typeof wert === "string" && wert !== "";
}

export const ZUGANG_FP_HEX_ZEICHEN = 16;
const FP_ALGORITHMUS = "sha256";
const FP_KODIERUNG = "hex";

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

export function e164Endung(e164) {
  return `${DID_ENDUNG_PRAEFIX}${e164.slice(-DID_ENDUNG_ZIFFERN)}`;
}

function didEndung(number) {
  return e164Endung(number.e164);
}

export function inboundElAccessDefects({ sipUser, sipPassword, initWebhookToken }) {
  const pruefungen = [
    { envKey: "ELEVENLABS_INBOUND_SIP_USER", mangel: istNichtLeererString(sipUser) ? null : ZUGANG_MANGEL.FEHLT },
    { envKey: "ELEVENLABS_INBOUND_SIP_PASSWORD", mangel: laengenMangel(sipPassword, SIP_PASSWORD_MIN_LENGTH) },
    { envKey: "ELEVENLABS_INIT_WEBHOOK_TOKEN", mangel: laengenMangel(initWebhookToken, INIT_WEBHOOK_TOKEN_MIN_LENGTH) },
  ];
  return pruefungen.filter((pruefung) => pruefung.mangel !== null);
}

function inboundWegBereit(inbound) {
  return inbound.enabled === true && inboundElAccessDefects(inbound).length === 0;
}

function belegGiltFuerLaufendenZugang({ numberRecord, sipUser }) {
  const laufenderFp = zugangsFingerabdruck(sipUser);
  if (!istNichtLeererString(laufenderFp)) return false;
  return Boolean(numberRecord?.elInboundTrunkBelegtAt) && numberRecord.elInboundTrunkZugangFp === laufenderFp;
}

function entscheidungNachAllowlist({ inbound, tenantId }) {
  return tenantIstGepinnt(tenantId, inbound.tenantIds) ? INBOUND_PATH.ELEVENLABS : INBOUND_PATH.BUDGET;
}

function entscheidungNachBeleg({ inbound, numberRecord }) {
  return belegGiltFuerLaufendenZugang({ numberRecord, sipUser: inbound.sipUser })
    ? INBOUND_PATH.ELEVENLABS
    : INBOUND_PATH.ABGEWIESEN;
}

export function inboundPfadEntscheidung({ config, tenantId, numberRecord }) {
  const inbound = config.voice.elevenLabsInbound;
  if (!inboundWegBereit(inbound)) return INBOUND_PATH.BUDGET;
  if (inbound.scope === INBOUND_EL_SCOPE.REGISTRIERTE_DIDS) return entscheidungNachBeleg({ inbound, numberRecord });
  if (inbound.scope === INBOUND_EL_SCOPE.ALLOWLIST) return entscheidungNachAllowlist({ inbound, tenantId });
  return INBOUND_PATH.BUDGET;
}

export function inboundElPathFor({ config, tenantId, numberRecord }) {
  return inboundPfadEntscheidung({ config, tenantId, numberRecord }) === INBOUND_PATH.ELEVENLABS;
}

export function inboundElPinnedTenantCount(tenantIds) {
  return new Set(tenantIds).size;
}

export function inboundElAllowlistProbeLine({ state, tenantIds }) {
  const gepinnt = new Set(tenantIds);
  const aktiveGepinnte = state.numbers.filter(
    (number) => gepinnt.has(number.tenantId) && number.status === NUMBER_STATUS.ACTIVE,
  );
  const endungen = aktiveGepinnte.map(didEndung).sort();
  const didTeil = endungen.length > 0 ? `aktive DIDs ${endungen.join(", ")}` : KEINE_AKTIVE_DID;
  return `Inbound-EL-Allowlist: ${inboundElPinnedTenantCount(tenantIds)} Tenants, ${didTeil}`;
}
