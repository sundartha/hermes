import { createHash } from "node:crypto";
import { z } from "zod";
import { anfrage } from "../utils/anfrage.js";
import { findActiveNumber } from "../store/views.ts";
import type { Zustand } from "../store/views.ts";
import { BOOTSTRAP_TENANT_ID } from "../begriffe/mandant.js";
import { PLATFORM_NUMBER_PURPOSE } from "../begriffe/nummern-vergabe.js";
import { openPlatformBindingByPurpose } from "../store/state-ops.js";

interface StoreMitZustand {
  load: () => Zustand;
}

interface AlarmAbsender {
  provider: string | null | undefined;
  e164: string;
}

interface SmsVersand {
  sendSms: (nachricht: { from: string; to: string; body: string }) => Promise<unknown>;
}

interface VorfallMeldung {
  adresse: string;
  anlass: string;
  schluessel: string;
  status: string;
  meldezeile: string;
}

export function resolveBootstrapAlertSender(store: StoreMitZustand): NonNullable<z.infer<typeof NUMMER>> | null {
  const sender = NUMMER.parse(findActiveNumber(store.load(), BOOTSTRAP_TENANT_ID));
  if (sender) return sender;
  console.warn("[alert-sms] Plattform-Alarm: keine aktive Bootstrap-Nummer, KEINE SMS");
  return null;
}

export function platformAlertSender(store: StoreMitZustand): AlarmAbsender | null {
  const binding = BINDUNG.parse(openPlatformBindingByPurpose(store.load(), PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER));
  if (binding?.e164) return { provider: binding.provider, e164: binding.e164 };
  console.warn("[alert-sms] Ausfall-Melder: keine gebundene Alarm-Absendernummer, KEINE SMS");
  return null;
}

export function sendFailSoftAlertSms({
  messaging,
  to,
  body,
  resolveSender,
  onError,
}: {
  messaging: (provider: string | null | undefined) => SmsVersand;
  to: string | null | undefined;
  body: string;
  resolveSender: () => AlarmAbsender | null | undefined;
  onError: (fehler: unknown) => void;
}): void {
  try {
    if (!to) return;
    const sender = resolveSender();
    if (!sender) return;
    messaging(sender.provider)
      .sendSms({ from: sender.e164, to, body })
      .catch(onError);
  } catch (e) {
    onError(e);
  }
}

const TEXT_ODER_LEER = z.string().nullish();
const ABSENDER_FELDER = z.object({ provider: TEXT_ODER_LEER, e164: TEXT_ODER_LEER });
const NUMMER = ABSENDER_FELDER.passthrough().nullish();
const BINDUNG = ABSENDER_FELDER.nullish();
const FEHLERNAME = z.object({ name: z.unknown() });
const ALARM_KONFIG = z.object({ billing: z.object({ betterstackAlertUrl: z.string().catch("") }) });
const BETTERSTACK_FRIST_MS = 5000;
const MELDEZEILE_MAX_ZEICHEN = 1000;
const KURZ_HASH_ZEICHEN = 8;

function fehlerName(err: unknown): string {
  const gelesen = FEHLERNAME.safeParse(err);
  return String(gelesen.data?.name);
}

function alarmAdresse(config: unknown): string {
  const { billing } = ALARM_KONFIG.parse(config);
  return billing.betterstackAlertUrl;
}

function logNichtZugestellt(anlass: string, schluessel: string, grund: string): void {
  console.error(`[${anlass}] Better-Stack-Meldung ${schluessel} nicht zugestellt: ${grund}`);
}

export async function sendeVorfall({ adresse, anlass, schluessel, status, meldezeile }: VorfallMeldung): Promise<boolean> {
  if (!adresse) return false;
  try {
    const res = await anfrage(adresse, {
      fristMs: BETTERSTACK_FRIST_MS,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        incident: { id: schluessel, status },
        text: meldezeile.slice(0, MELDEZEILE_MAX_ZEICHEN),
      }),
    });
    if (!res.ok) logNichtZugestellt(anlass, schluessel, `HTTP ${String(res.status)}`);
    return res.ok;
  } catch (err) {
    logNichtZugestellt(anlass, schluessel, fehlerName(err));
    return false;
  }
}

function einmalSchluessel(logTag: string, meldezeile: string, jetzt: () => Date): string {
  const kurzHash = createHash("sha256").update(meldezeile).digest("hex").slice(0, KURZ_HASH_ZEICHEN);
  return `${logTag}:${jetzt().toISOString()}:${kurzHash}`;
}

export function sendBootstrapAlertSms({
  config,
  prefix,
  detail,
  logTag,
  jetzt,
}: {
  config: unknown;
  prefix: string;
  detail: string;
  logTag: string;
  jetzt: () => Date;
}): void {
  const meldezeile = prefix + detail;
  const schluessel = einmalSchluessel(logTag, meldezeile, jetzt);
  sendeVorfall({
    adresse: alarmAdresse(config),
    anlass: logTag,
    schluessel,
    status: "alert",
    meldezeile,
  }).catch((err: unknown) => {
    logNichtZugestellt(logTag, schluessel, fehlerName(err));
  });
}
