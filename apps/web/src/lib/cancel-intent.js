// Kuendigungs-Auftrag fuer die App-Shell (§ 312k BGB, Owner-Entscheidung 2026-10-01).
//
// Gekuendigt wird NUR im Kundenbereich - ohne Anmeldung koennte jeder mit fremdem
// Namen und fremder Email einen Vertrag kuendigen. Jeder Link "Verträge kündigen" /
// "Cancel contracts" der Website zeigt deshalb auf <Gateway>/app#kuendigen
// (lib/routes.js CANCEL_URL). Die App-Shell wertet den Anker hier aus:
//   - eingeloggt          -> Kuendigungs-Bestaetigung sofort oeffnen
//   - nicht eingeloggt    -> Auftrag merken, durch den Login, danach oeffnen
//   - wartet auf Freigabe -> nichts zu kuendigen, Auftrag verwerfen
// Der Login kennt kein Ruecksprung-Ziel (src/web-auth.js, fester postLoginPath /app),
// der Anker geht auf dem Weg verloren. Deshalb reist der Auftrag im sessionStorage
// dieses Tabs mit (gleicher Origin vor und nach dem Login) - kein neuer Server-
// Parameter, keine Umleitungs-Allowlist, kein offener Redirect.
//
// Rein und ohne DOM: der Speicher wird hineingereicht (Test: Map-Attrappe). Jeder
// Speicherzugriff ist abgefangen - Privatmodus/gesperrter Speicher heisst nur, dass
// der Auftrag den Login nicht ueberlebt; die Kuendigung im Dashboard bleibt erreichbar.

import { AUTH_STATE } from "./api.js";

export const CANCEL_INTENT_HASH = "#kuendigen";
const STORAGE_KEY = "hermes.cancelIntent";

// Ein gemerkter Auftrag gilt nur fuer den Login-Umweg, nicht fuer spaetere Besuche.
const MS_PER_MINUTE = 60_000;
const INTENT_TTL_MINUTES = 15;
const INTENT_TTL_MS = INTENT_TTL_MINUTES * MS_PER_MINUTE;

export const CANCEL_INTENT_STEP = Object.freeze({
  NONE: "none", // kein Auftrag
  LOGIN: "login", // merken und zum Login
  OPEN: "open", // Bestaetigung oeffnen
  DROP: "drop", // verwerfen (nichts zu kuendigen oder Login schon versucht)
});

function readSaved(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function rememberCancelIntent(storage, now) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ at: now }));
  } catch {
    // Speicher gesperrt: der Auftrag ueberlebt den Login nicht (s. Kopf).
  }
}

export function clearCancelIntent(storage) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Speicher gesperrt: es gibt nichts zu loeschen.
  }
}

// Auftrag beim Seitenstart: der Anker in der Adresse (frisch von der Website) oder ein
// noch frischer Merker (Rueckkehr vom Login). viaLogin verhindert eine Login-Schleife:
// wer nach dem Login-Umweg immer noch anonym ist, wird nicht ein zweites Mal geschickt.
export function pendingCancelIntent({ hash, storage, now }) {
  if (hash === CANCEL_INTENT_HASH) return { pending: true, viaLogin: false };
  const saved = readSaved(storage);
  const fresh = Number.isFinite(saved?.at) && now - saved.at <= INTENT_TTL_MS;
  return { pending: fresh, viaLogin: fresh };
}

// Ein Ladefehler (AUTH_STATE.ERROR) entscheidet nichts: der Auftrag bleibt fuer den
// naechsten Versuch ("Try again") stehen.
export function cancelIntentStep(authState, intent) {
  if (!intent.pending || authState === AUTH_STATE.ERROR) return CANCEL_INTENT_STEP.NONE;
  if (authState === AUTH_STATE.AUTHENTICATED) return CANCEL_INTENT_STEP.OPEN;
  if (authState === AUTH_STATE.ANONYMOUS && !intent.viaLogin) return CANCEL_INTENT_STEP.LOGIN;
  return CANCEL_INTENT_STEP.DROP;
}
