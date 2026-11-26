import { z } from "zod";
import { lastDayOfMonth } from "./utils/month.js";

export const RESULT_LIST_MAX_ITEMS = 3;
export const RESULT_TEXT_MAX_CHARS = 200;
export const RESULT_EVIDENCE_MAX_ITEMS = 2;
export const RESULT_EVIDENCE_MAX_CHARS = 160;
export const RESULT_NEXT_STEP_TYPES = ["appointment", "callback", "task", "other"] as const;

export type NaechsterSchrittArt = (typeof RESULT_NEXT_STEP_TYPES)[number];

export interface NaechsterSchritt {
  type: NaechsterSchrittArt;
  text: string;
  at: string | null;
}

const ZEITPUNKT_FORM =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/;

export interface GegenseitenUrteil {
  confirmed: boolean;
  declined: boolean;
  mailbox?: boolean;
}

export interface ErgebnisKarte {
  outcome: string | null;
  commitments: string[];
  counterpartyCommitments: string[];
  openPoints: string[];
  nextStep: string | null;
  nextSteps: NaechsterSchritt[];
  facts: string[];
  evidence?: string[];
  counterparty?: GegenseitenUrteil;
}

interface GelesenesErgebnis {
  outcome?: unknown;
  commitments?: unknown;
  counterparty_commitments?: unknown;
  open_points?: unknown;
  next_step?: unknown;
  next_steps?: unknown;
  facts?: unknown;
  evidence?: unknown;
}

interface AnsichtKarte {
  outcome: string | null;
  commitments: string[];
  counterparty_commitments: string[];
  open_points: string[];
  next_step: string | null;
}

export function evidenceRetentionEnabled(privacy: { evidenceRetentionDays: number }): boolean {
  return privacy.evidenceRetentionDays > 0;
}

function clampedText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxChars);
}

function clampedList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned: string[] = [];
  for (const entry of value) {
    const text = clampedText(entry, maxChars);
    if (text) cleaned.push(text);
    if (cleaned.length >= maxItems) break;
  }
  return cleaned;
}

function gueltigerZeitpunkt(value: unknown): string | null {
  const text = clampedText(value, RESULT_TEXT_MAX_CHARS);
  const treffer = text ? ZEITPUNKT_FORM.exec(text) : null;
  if (!text || !treffer) return null;
  const [, jahr = "", monat = "", tag = ""] = treffer;
  const letzterTag = lastDayOfMonth(new Date(`${jahr}-${monat}-01T00:00:00Z`)).getUTCDate();
  return Number(tag) <= letzterTag ? text : null;
}

const SchrittSchema = z.object({ type: z.unknown(), text: z.unknown(), at: z.unknown() });

function schrittAus(value: unknown): NaechsterSchritt | null {
  const roh = SchrittSchema.safeParse(value);
  const text = roh.success ? clampedText(roh.data.text, RESULT_TEXT_MAX_CHARS) : null;
  if (!roh.success || !text) return null;
  const art = RESULT_NEXT_STEP_TYPES.find((kandidat) => kandidat === roh.data.type) ?? "other";
  return { type: art, text, at: gueltigerZeitpunkt(roh.data.at) };
}

function schrittListe(value: unknown): NaechsterSchritt[] {
  if (!Array.isArray(value)) return [];
  const schritte: NaechsterSchritt[] = [];
  for (const eintrag of value) {
    const schritt = schrittAus(eintrag);
    if (schritt) schritte.push(schritt);
    if (schritte.length >= RESULT_LIST_MAX_ITEMS) break;
  }
  return schritte;
}

function kartenHatInhalt(card: ErgebnisKarte) {
  const listen = [
    card.commitments,
    card.counterpartyCommitments,
    card.openPoints,
    card.nextSteps,
    card.facts,
    card.evidence ?? [],
  ];
  return card.outcome !== null || card.nextStep !== null || card.counterparty !== undefined || listen.some((liste) => liste.length > 0);
}

function karteAus(parsed: GelesenesErgebnis | null | undefined): ErgebnisKarte {
  return {
    outcome: clampedText(parsed?.outcome, RESULT_TEXT_MAX_CHARS),
    commitments: clampedList(parsed?.commitments, RESULT_LIST_MAX_ITEMS, RESULT_TEXT_MAX_CHARS),
    counterpartyCommitments: clampedList(
      parsed?.counterparty_commitments,
      RESULT_LIST_MAX_ITEMS,
      RESULT_TEXT_MAX_CHARS,
    ),
    openPoints: clampedList(parsed?.open_points, RESULT_LIST_MAX_ITEMS, RESULT_TEXT_MAX_CHARS),
    nextStep: clampedText(parsed?.next_step, RESULT_TEXT_MAX_CHARS),
    nextSteps: schrittListe(parsed?.next_steps),
    facts: clampedList(parsed?.facts, RESULT_LIST_MAX_ITEMS, RESULT_TEXT_MAX_CHARS),
  };
}

export function normalizeCallResult(
  parsed: GelesenesErgebnis | null | undefined,
  { evidenceAllowed, counterparty }: { evidenceAllowed: boolean; counterparty?: GegenseitenUrteil },
): ErgebnisKarte | null {
  const card = karteAus(parsed);
  if (counterparty && (counterparty.confirmed || counterparty.declined || counterparty.mailbox)) card.counterparty = counterparty;
  if (evidenceAllowed) {
    card.evidence = clampedList(parsed?.evidence, RESULT_EVIDENCE_MAX_ITEMS, RESULT_EVIDENCE_MAX_CHARS);
  }

  return kartenHatInhalt(card) ? card : null;
}

export function stripResultEvidence(call: { result?: Record<string, unknown> | null }): Record<string, unknown> | null {
  if (!call.result || !("evidence" in call.result)) return null;
  return Object.fromEntries(Object.entries(call.result).filter(([schluessel]) => schluessel !== "evidence"));
}

export function resultCardView(result: Partial<ErgebnisKarte> | null | undefined): AnsichtKarte {
  const card: Partial<ErgebnisKarte> = result ?? {};
  return {
    outcome: card.outcome ?? null,
    commitments: card.commitments ?? [],
    counterparty_commitments: card.counterpartyCommitments ?? [],
    open_points: card.openPoints ?? [],
    next_step: card.nextStep ?? null,
  };
}

export function mapStatus(call: { status: string; answeredAt?: string | null; queued?: boolean }): string {
  if (call.status === "active") return call.answeredAt ? "in_progress" : call.queued ? "queued" : "dialing";
  return call.status;
}
