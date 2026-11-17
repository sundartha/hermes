import { createHash } from "node:crypto";
import { INBOUND_PATH } from "../telephony/inbound-path.ts";

interface InboundZugang {
  sipUser?: string | undefined;
  sipPassword?: string | undefined;
  initWebhookToken?: unknown;
}

interface NummernBeleg {
  elInboundTrunkBelegtAt?: unknown;
  elInboundTrunkZugangFp?: unknown;
}

interface Entscheidungsfall {
  config: { voice: { elevenLabsInbound: InboundZugang } };
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

export function e164Endung(e164: string): string {
  return `${DID_ENDUNG_PRAEFIX}${e164.slice(-DID_ENDUNG_ZIFFERN)}`;
}

export function inboundElAccessDefects({ sipUser, sipPassword, initWebhookToken }: InboundZugang): Mangel[] {
  const pruefungen = [
    { envKey: "ELEVENLABS_INBOUND_SIP_USER", mangel: istNichtLeererString(sipUser) ? null : ZUGANG_MANGEL.FEHLT },
    { envKey: "ELEVENLABS_INBOUND_SIP_PASSWORD", mangel: laengenMangel(sipPassword, SIP_PASSWORD_MIN_LENGTH) },
    { envKey: "ELEVENLABS_INIT_WEBHOOK_TOKEN", mangel: laengenMangel(initWebhookToken, INIT_WEBHOOK_TOKEN_MIN_LENGTH) },
  ];
  return pruefungen.filter((pruefung) => pruefung.mangel !== null);
}

function inboundWegBereit(inbound: InboundZugang): boolean {
  return inboundElAccessDefects(inbound).length === 0;
}

export function inboundPfadEntscheidung({ config }: Entscheidungsfall): string {
  const inbound = config.voice.elevenLabsInbound;
  return inboundWegBereit(inbound) ? INBOUND_PATH.ELEVENLABS : INBOUND_PATH.ABGEWIESEN;
}

export function inboundElPathFor({ config, tenantId, numberRecord }: Entscheidungsfall): boolean {
  return inboundPfadEntscheidung({ config, tenantId, numberRecord }) === INBOUND_PATH.ELEVENLABS;
}
