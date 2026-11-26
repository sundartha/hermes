import { MS_PER_DAY } from "../utils/timer.ts";

const LISTE_ZURUECK = "newsletter_recipients, newsletter_confirm_mail_log";
const LEERE_LISTE = "'[]'::jsonb";

const ELEMENTE = "jsonb_array_elements(COALESCE(newsletter_recipients, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)";
const neueListe = (bedingung: string, element = "e"): string =>
  `(SELECT COALESCE(jsonb_agg(${element} ORDER BY ord), ${LEERE_LISTE}) FROM ${ELEMENTE} ${bedingung})`;

const SCHON_DA = `EXISTS (SELECT 1 FROM ${ELEMENTE} WHERE e->>'unsubToken' = ($2::jsonb)->0->>'unsubToken')`;

const ANHAENGEN_SQL = `UPDATE tenant SET newsletter_recipients = CASE WHEN ${SCHON_DA} THEN COALESCE(newsletter_recipients, ${LEERE_LISTE}) ELSE COALESCE(newsletter_recipients, ${LEERE_LISTE}) || $2::jsonb END,
  newsletter_confirm_mail_log = (SELECT COALESCE(jsonb_agg(s ORDER BY ord), ${LEERE_LISTE}) FROM jsonb_array_elements(COALESCE(newsletter_confirm_mail_log, ${LEERE_LISTE})) WITH ORDINALITY AS l(s, ord) WHERE (s #>> '{}') >= $3::text) || CASE WHEN ${SCHON_DA} THEN ${LEERE_LISTE} ELSE to_jsonb(ARRAY[$4::text]) END
  WHERE id = $1 RETURNING ${LISTE_ZURUECK}`;

const ENTFERNEN_SQL = `UPDATE tenant SET newsletter_recipients = ${neueListe("WHERE e->>'email' <> $2::text")} WHERE id = $1 RETURNING ${LISTE_ZURUECK}`;

const ABMELDEN_SQL = `UPDATE tenant SET newsletter_recipients = ${neueListe("WHERE e->>'unsubToken' IS DISTINCT FROM $2::text")} WHERE id = $1 RETURNING ${LISTE_ZURUECK}`;

const BESTAETIGEN_SQL = `UPDATE tenant SET newsletter_recipients = ${neueListe(
  "",
  `CASE WHEN e->>'status' = 'pending' AND e->>'tokenHash' = $2::text AND e->>'tokenExpiresAt' > $3::text THEN e || jsonb_build_object('status', 'confirmed', 'confirmedAt', $3::text, 'tokenHash', NULL::text, 'tokenExpiresAt', NULL::text) ELSE e END`,
)} WHERE id = $1 RETURNING ${LISTE_ZURUECK}`;

const LESEN_SQL = `SELECT id, ${LISTE_ZURUECK} FROM tenant WHERE`;
const MIT_LISTE = "newsletter_recipients IS NOT NULL";
const enthaelt = (schluessel: string): string => `newsletter_recipients @> jsonb_build_array(jsonb_build_object('${schluessel}', $1::text))`;

export interface AbgleichFilter {
  tenantId?: string;
  tokenHash?: string;
  unsubToken?: string;
}

export function listenLesen(filter: AbgleichFilter = {}): Anweisung {
  if (filter.tenantId !== undefined) return { sql: `${LESEN_SQL} id = $1 AND ${MIT_LISTE}`, werte: [filter.tenantId] };
  if (filter.tokenHash !== undefined) return { sql: `${LESEN_SQL} ${enthaelt("tokenHash")}`, werte: [filter.tokenHash] };
  if (filter.unsubToken !== undefined) return { sql: `${LESEN_SQL} ${enthaelt("unsubToken")}`, werte: [filter.unsubToken] };
  return { sql: `${LESEN_SQL} ${MIT_LISTE}`, werte: [] };
}

interface Anweisung {
  sql: string;
  werte: string[];
}

export function empfaengerAnhaengen(empfaenger: unknown, nowIso: string): Anweisung {
  const grenze = new Date(Date.parse(nowIso) - MS_PER_DAY).toISOString();
  return { sql: ANHAENGEN_SQL, werte: [JSON.stringify([empfaenger]), grenze, nowIso] };
}

export const empfaengerEntfernen = (email: string): Anweisung => ({ sql: ENTFERNEN_SQL, werte: [email] });
export const empfaengerAbmelden = (token: string): Anweisung => ({ sql: ABMELDEN_SQL, werte: [token] });
export const empfaengerBestaetigen = (tokenHash: string, nowIso: string): Anweisung => ({ sql: BESTAETIGEN_SQL, werte: [tokenHash, nowIso] });
