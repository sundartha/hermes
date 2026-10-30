const NUM_ENV_INTEGER_PATTERN = /^[+-]?\d+$/;
const NUM_ENV_DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function parseNumEnv(trimmed, integer) {
  const pattern = integer ? NUM_ENV_INTEGER_PATTERN : NUM_ENV_DECIMAL_PATTERN;
  const parsed = integer ? parseInt(trimmed, 10) : parseFloat(trimmed);
  return pattern.test(trimmed) && Number.isFinite(parsed) ? parsed : null;
}

function numEnvExpectation(integer, min) {
  const art = integer ? "Ganzzahl" : "Zahl";
  return min === undefined ? art : `${art}, >= ${min}`;
}

export function stripTrailingSlash(url) {
  return url.replace(/\/$/, "");
}

export function csvEnv(raw) {
  return (raw || "")
    .split(",")
    .map((eintrag) => eintrag.trim())
    .filter(Boolean);
}

export function trimmedUpper(raw) {
  return (raw || "").trim().toUpperCase();
}

export function detectProduction(env) {
  return !!env.RENDER_EXTERNAL_URL;
}

function numEnvMit(fehlerliste) {
  return function numEnv(name, raw, { fallback, min, max, integer = true } = {}) {
    if (raw === undefined || raw === "") return fallback;
    const parsed = parseNumEnv(raw.trim(), integer);
    if (parsed === null) {
      fehlerliste.push(
        `${name}="${raw}" ist keine gueltige Zahl (erwartet: ${numEnvExpectation(integer, min)}).`,
      );
      return fallback;
    }
    if (min !== undefined && parsed < min) {
      fehlerliste.push(`${name}=${parsed} unterschreitet das Minimum ${min}.`);
      return fallback;
    }
    if (max !== undefined && parsed > max) return max;
    return parsed;
  };
}

function boolEnvMit(fehlerliste) {
  return function boolEnv(name, raw, { fallback }) {
    if (raw === undefined || raw === "") return fallback;
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    fehlerliste.push(
      `${name}="${raw}" ist kein gueltiger Boolean (erwartet: "true" oder "false").`,
    );
    return fallback;
  };
}

function enumEnvMit(fehlerliste) {
  return function enumEnv(name, raw, { allowed, fallback }) {
    if (raw === undefined || raw === "") return fallback;
    const trimmed = raw.trim();
    if (allowed.includes(trimmed)) return trimmed;
    fehlerliste.push(`${name}="${raw}" ist unbekannt (gueltig: ${allowed.join("|")}).`);
    return fallback;
  };
}

function isoInstantEnvMit(fehlerliste) {
  return function isoInstantEnv(name, raw) {
    if (raw === undefined || raw === "") return null;
    const trimmed = raw.trim();
    const at = new Date(trimmed);
    if (!ISO_INSTANT_PATTERN.test(trimmed) || Number.isNaN(at.getTime())) {
      fehlerliste.push(
        `${name}="${raw}" ist kein gueltiger ISO-8601-Zeitpunkt mit Zone (erwartet z.B. 2026-08-04T00:00:00Z).`,
      );
      return null;
    }
    return at.toISOString();
  };
}

function routeCentsEnvMit(fehlerliste) {
  return function routeCentsEnv(name, raw, gueltigeRouten) {
    const karte = {};
    for (const eintrag of csvEnv(raw)) {
      const trennIndex = eintrag.lastIndexOf(":");
      const profil = trennIndex === -1 ? "" : eintrag.slice(0, trennIndex);
      const cents = trennIndex === -1 ? null : parseNumEnv(eintrag.slice(trennIndex + 1), true);
      if (!gueltigeRouten.includes(profil) || cents === null || cents < 0) {
        fehlerliste.push(
          `${name}="${eintrag}" ist keine gueltige Karte profil:ganze-cent ` +
            `(gueltige Profile: ${gueltigeRouten.join("|")}).`,
        );
        continue;
      }
      karte[profil] = cents;
    }
    return karte;
  };
}

export function umgebungMit(fehlerliste, env) {
  return {
    env,
    numEnv: numEnvMit(fehlerliste),
    boolEnv: boolEnvMit(fehlerliste),
    enumEnv: enumEnvMit(fehlerliste),
    isoInstantEnv: isoInstantEnvMit(fehlerliste),
    routeCentsEnv: routeCentsEnvMit(fehlerliste),
  };
}
