import { createHash } from "node:crypto";
import { NUMBER_STATUS } from "../begriffe/nummern.js";
import { INBOUND_PATH } from "../telephony/inbound-path.js";
import { INBOUND_EL_SCOPE } from "./inbound-scope.ts";

interface InboundZugang {
  sipUser?: unknown;
  sipPassword?: unknown;
  initWebhookToken?: unknown;
}

interface InboundKonfiguration extends InboundZugang {
  enabled?: unknown;
  scope?: unknown;
  tenantIds?: unknown;
}

interface NummernBeleg {
  elInboundTrunkBelegtAt?: unknown;
  elInboundTrunkZugangFp?: unknown;
}

interface Entscheidungsfall {
  config: { voice: { elevenLabsInbound: InboundKonfiguration } };
  tenantId: unknown;
  numberRecord: NummernBeleg | null | undefined;
}

interface Mangel {
  envKey: string;
  mangel: string | null;
}

export const SIP_PASSWORD_MIN_LENGTH = 32;
export const INIT_WEBHOOK_TOKEN_MIN_LENGTH = 32;
export const DID_ENDUNG_ZIFFERN = 4;
const DID_ENDUNG_PRAEFIX = "…";
const KEINE_AKTIVE_DID = "keine aktive DID";

export const ZUGANG_MANGEL = Object.freeze({ FEHLT: "fehlt", ZU_KURZ: "zu kurz" });

export function istNichtLeererString(wert: unknown): boolean {
  return typeof wert === "string" && wert !== "";
}

export const ZUGANG_FP_HEX_ZEICHEN = 16;
const FP_ALGORITHMUS = "sha256";
const FP_KODIERUNG = "hex";

export function zugangsFingerabdruck(sipUser: unknown): string | null {
  if (!istNichtLeererString(sipUser)) return null;
  const hash = createHash(FP_ALGORITHMUS).update(String(sipUser));
  return hash.digest(FP_KODIERUNG).slice(0, ZUGANG_FP_HEX_ZEICHEN);
}

function laengenMangel(wert: unknown, minLength: number): string | null {
  if (!istNichtLeererString(wert)) return ZUGANG_MANGEL.FEHLT;
  return String(wert).length < minLength ? ZUGANG_MANGEL.ZU_KURZ : null;
}

function tenantIstGepinnt(tenantId: unknown, tenantIds: unknown): boolean {
  if (!istNichtLeererString(tenantId)) return false;
  if (!Array.isArray(tenantIds)) return false;
  return tenantIds.includes(tenantId);
}

export function e164Endung(e164: string): string {
  return `${DID_ENDUNG_PRAEFIX}${e164.slice(-DID_ENDUNG_ZIFFERN)}`;
}

function didEndung(number: { e164: string }): string {
  return e164Endung(number.e164);
}

export function inboundElAccessDefects({ sipUser, sipPassword, initWebhookToken }: InboundZugang): Mangel[] {
  const pruefungen = [
    { envKey: "ELEVENLABS_INBOUND_SIP_USER", mangel: istNichtLeererString(sipUser) ? null : ZUGANG_MANGEL.FEHLT },
    { envKey: "ELEVENLABS_INBOUND_SIP_PASSWORD", mangel: laengenMangel(sipPassword, SIP_PASSWORD_MIN_LENGTH) },
    { envKey: "ELEVENLABS_INIT_WEBHOOK_TOKEN", mangel: laengenMangel(initWebhookToken, INIT_WEBHOOK_TOKEN_MIN_LENGTH) },
  ];
  return pruefungen.filter((pruefung) => pruefung.mangel !== null);
}

function inboundWegBereit(inbound: InboundKonfiguration): boolean {
  return inbound.enabled === true && inboundElAccessDefects(inbound).length === 0;
}

function belegGiltFuerLaufendenZugang({
  numberRecord,
  sipUser,
}: {
  numberRecord: NummernBeleg | null | undefined;
  sipUser: unknown;
}): boolean {
  const laufenderFp = zugangsFingerabdruck(sipUser);
  if (!istNichtLeererString(laufenderFp)) return false;
  return Boolean(numberRecord?.elInboundTrunkBelegtAt) && numberRecord?.elInboundTrunkZugangFp === laufenderFp;
}

function entscheidungNachAllowlist({
  inbound,
  tenantId,
}: {
  inbound: InboundKonfiguration;
  tenantId: unknown;
}): string {
  return tenantIstGepinnt(tenantId, inbound.tenantIds) ? INBOUND_PATH.ELEVENLABS : INBOUND_PATH.BUDGET;
}

function entscheidungNachBeleg({
  inbound,
  numberRecord,
}: {
  inbound: InboundKonfiguration;
  numberRecord: NummernBeleg | null | undefined;
}): string {
  return belegGiltFuerLaufendenZugang({ numberRecord, sipUser: inbound.sipUser })
    ? INBOUND_PATH.ELEVENLABS
    : INBOUND_PATH.ABGEWIESEN;
}

export function inboundPfadEntscheidung({ config, tenantId, numberRecord }: Entscheidungsfall): string {
  const inbound = config.voice.elevenLabsInbound;
  if (!inboundWegBereit(inbound)) return INBOUND_PATH.BUDGET;
  if (inbound.scope === INBOUND_EL_SCOPE.REGISTRIERTE_DIDS) return entscheidungNachBeleg({ inbound, numberRecord });
  if (inbound.scope === INBOUND_EL_SCOPE.ALLOWLIST) return entscheidungNachAllowlist({ inbound, tenantId });
  return INBOUND_PATH.BUDGET;
}

export function inboundElPathFor({ config, tenantId, numberRecord }: Entscheidungsfall): boolean {
  return inboundPfadEntscheidung({ config, tenantId, numberRecord }) === INBOUND_PATH.ELEVENLABS;
}

export function inboundElPinnedTenantCount(tenantIds: Iterable<unknown>): number {
  return new Set(tenantIds).size;
}

export function inboundElAllowlistProbeLine({
  state,
  tenantIds,
}: {
  state: { numbers: { tenantId: unknown; status: unknown; e164: string }[] };
  tenantIds: Iterable<unknown>;
}): string {
  const gepinnt = new Set(tenantIds);
  const aktiveGepinnte = state.numbers.filter(
    (number) => gepinnt.has(number.tenantId) && number.status === NUMBER_STATUS.ACTIVE,
  );
  const endungen = aktiveGepinnte.map(didEndung).sort();
  const didTeil = endungen.length > 0 ? `aktive DIDs ${endungen.join(", ")}` : KEINE_AKTIVE_DID;
  return `Inbound-EL-Allowlist: ${String(inboundElPinnedTenantCount(tenantIds))} Tenants, ${didTeil}`;
}
