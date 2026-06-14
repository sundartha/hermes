// Reine, IO-freie Code-Defaults und Profil-Sanitisierung. Von BEIDEN Backends
// (json.js + pg.js) genutzt, damit "frischer pg-Zustand == frischer json-Zustand"
// strukturell garantiert ist (eine Quelle statt zwei). Kein DB-/Datei-Zugriff hier.

// Demo-Termine relativ zum Startzeitpunkt (Tage voraus / Uhrzeit). Werte als
// benannte Eintraege statt nackter Zahlen mitten im Code.
const DEMO_EVENTS = [
  { id: "ev1", title: "Team-Meeting", daysAhead: 1, startHour: 10, endHour: 11 },
  { id: "ev2", title: "Mittagessen mit Alex", daysAhead: 2, startHour: 12, endHour: 13 },
  { id: "ev3", title: "Projekt-Review", daysAhead: 3, startHour: 15, endHour: 16.5 },
];

// Hoechstens so viele Notifications behalten (Ring-Puffer, neueste zuerst).
export const MAX_NOTIFICATIONS = 50;

function nextWeekday(daysAhead, hour) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0);
  return d.toISOString();
}

export function defaultSettings() {
  return {
    agentName: "Vodafone Agent",
    greeting:
      "Hallo, hier ist der KI-Assistent von {owner}. {owner} kann gerade nicht ans Telefon. Ich kann Nachrichten aufnehmen oder direkt einen Termin vereinbaren. Wie kann ich helfen?",
    allowCalendar: true,
    allowBooking: true,
    allowSummaries: true,
    allowPersonalData: false,
    allowBankData: false,
  };
}

// Demo-Termine, damit der Agent echte Verfuegbarkeiten hat.
export function demoCalendar() {
  return DEMO_EVENTS.map((e) => ({
    id: e.id,
    title: e.title,
    start: nextWeekday(e.daysAhead, e.startHour),
    end: nextWeekday(e.daysAhead, e.endHour),
  }));
}

export function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, costEur: 0, calls: 0 };
}

// ---- Rechteprofile pro Nutzer (Phase 2) ----
// Profil-Felder mit erwartetem Typ (Whitelist gegen sanitizeProfile, analog
// updateSettings). "string[]" = Array aus Strings.
export const PROFILE_FIELDS = {
  allowedNumbers: "string[]", // eigene Allowlist (zusaetzlich zur globalen)
  allowedCountryCodes: "string[]", // engt das globale Land-Gate weiter ein (nie auf)
  unrestricted: "boolean", // hebt die GLOBALE Allowlist auf (nur die Allowlist!)
  allowCalendar: "boolean", // get_calendar-MCP-Tool
  allowBooking: "boolean", // POST /api/calendar
  maxCallsPerHour: "number", // pro-Nutzer-Stundenlimit (effektiv min(global, profil))
};

// Whitelist gegen PROFILE_FIELDS (Key + Typ). Unbekannte Keys / falsche Typen
// werden verworfen. allowedNumbers wird wie config.allowedNumbers normalisiert,
// damit der Gate-Vergleich gegen E.164 trifft; Laendercodes nur getrimmt.
export function sanitizeProfile(patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    const type = PROFILE_FIELDS[key];
    if (!type) continue;
    if (type === "string[]") {
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        clean[key] =
          key === "allowedNumbers"
            ? value.map((n) => n.replace(/[\s\-()]/g, "")).filter(Boolean)
            : value.map((c) => c.trim()).filter(Boolean);
      }
    } else if (typeof value === type) {
      clean[key] = value;
    }
  }
  return clean;
}

// Default-Profil: kleines Stundenlimit (fail-closed fuer profillose Nutzer).
const DEFAULT_PROFILE_MAX_CALLS_PER_HOUR = 2;

// Owner = localhost/stdio ohne Identitaet: permissiv = heutiges Verhalten. Die
// globale Allowlist greift weiter (unrestricted=false, leere Profil-Allowlist),
// kein Zusatz-Stundenlimit (maxCallsPerHour=null -> effektiv global), Kalender/
// Booking erlaubt. So bleiben die Phase-0-Tests (localhost = Owner) gruen.
const OWNER_PROFILE = {
  allowedNumbers: [],
  allowedCountryCodes: [],
  unrestricted: false,
  allowCalendar: true,
  allowBooking: true,
  maxCallsPerHour: null,
};

// Default = authentifiziert, aber (noch) ohne Profil: fail-closed/restriktiv.
// Keine Allowlist-Lockerung, kleines Stundenlimit, kein Kalender/Booking.
const DEFAULT_PROFILE = {
  allowedNumbers: [],
  allowedCountryCodes: [],
  unrestricted: false,
  allowCalendar: false,
  allowBooking: false,
  maxCallsPerHour: DEFAULT_PROFILE_MAX_CALLS_PER_HOUR,
};

// Effektives Profil aus einer Identitaet + dem gespeicherten Profil (oder
// undefined). null/leere email (localhost/stdio ohne JWT) -> Owner. Bekannte
// Identitaet -> gespeichertes Profil ueber DEFAULT gemerged (fehlende Felder
// fallen restriktiv zurueck). Unbekannt -> DEFAULT. Reine Merge-Logik, vom
// Storage entkoppelt: der Aufrufer reicht den gespeicherten Datensatz herein.
export function resolveProfileFrom(email, storedProfile) {
  if (!email) return { ...OWNER_PROFILE };
  return storedProfile ? { ...DEFAULT_PROFILE, ...storedProfile } : { ...DEFAULT_PROFILE };
}
