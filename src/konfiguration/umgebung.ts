const NUM_ENV_INTEGER_PATTERN = /^[+-]?\d+$/;
const NUM_ENV_DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function parseIntegerEnv(trimmed: string): number | null {
  const parsed = parseInt(trimmed, 10);
  return NUM_ENV_INTEGER_PATTERN.test(trimmed) && Number.isFinite(parsed) ? parsed : null;
}

function parseDecimalEnv(trimmed: string): number | null {
  const parsed = parseFloat(trimmed);
  return NUM_ENV_DECIMAL_PATTERN.test(trimmed) && Number.isFinite(parsed) ? parsed : null;
}

function parseNumEnv(trimmed: string, integer: boolean): number | null {
  return integer ? parseIntegerEnv(trimmed) : parseDecimalEnv(trimmed);
}

function numEnvExpectation(integer: boolean, min: number | undefined): string {
  const art = integer ? "Ganzzahl" : "Zahl";
  return min === undefined ? art : `${art}, >= ${String(min)}`;
}

interface NumEnvOptionen {
  fallback?: number;
  min?: number;
  max?: number;
  maxIstFehler?: boolean;
  integer?: boolean;
}

interface BoolEnvOptionen {
  fallback: boolean;
}

interface EnumEnvOptionen {
  allowed: readonly string[];
  fallback: string;
}

function numEnvMit(fehlerliste: string[]) {
  function numEnv(
    name: string,
    raw: string | undefined,
    optionen: NumEnvOptionen & { fallback: number },
  ): number;
  function numEnv(
    name: string,
    raw: string | undefined,
    optionen?: NumEnvOptionen,
  ): number | undefined;
  function numEnv(
    name: string,
    raw: string | undefined,
    { fallback, min, max, maxIstFehler = false, integer = true }: NumEnvOptionen = {},
  ): number | undefined {
    if (raw === undefined || raw === "") return fallback;
    const parsed = parseNumEnv(raw.trim(), integer);
    if (parsed === null) {
      fehlerliste.push(
        `${name}="${raw}" ist keine gueltige Zahl (erwartet: ${numEnvExpectation(integer, min)}).`,
      );
      return fallback;
    }
    if (min !== undefined && parsed < min) {
      fehlerliste.push(`${name}=${String(parsed)} unterschreitet das Minimum ${String(min)}.`);
      return fallback;
    }
    if (max !== undefined && parsed > max) {
      if (!maxIstFehler) return max;
      fehlerliste.push(`${name}=${String(parsed)} ueberschreitet das Maximum ${String(max)}.`);
      return fallback;
    }
    return parsed;
  }
  return numEnv;
}

function boolEnvMit(fehlerliste: string[]) {
  return (name: string, raw: string | undefined, { fallback }: BoolEnvOptionen): boolean => {
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

function enumEnvMit(fehlerliste: string[]) {
  return (name: string, raw: string | undefined, { allowed, fallback }: EnumEnvOptionen): string => {
    if (raw === undefined || raw === "") return fallback;
    const trimmed = raw.trim();
    if (allowed.includes(trimmed)) return trimmed;
    fehlerliste.push(`${name}="${raw}" ist unbekannt (gueltig: ${allowed.join("|")}).`);
    return fallback;
  };
}

function isoInstantEnvMit(fehlerliste: string[]) {
  return (name: string, raw: string | undefined): string | null => {
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

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function textEnv(raw: string | undefined, standard: string): string {
  if (raw === undefined || raw === "") {
    return standard;
  }
  return raw;
}

function csvEnv(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((eintrag) => eintrag.trim())
    .filter(Boolean);
}

function routeCentsEnvMit(fehlerliste: string[]) {
  return (name: string, raw: string | undefined, gueltigeRouten: readonly string[]): Record<string, number> => {
    const karte: Record<string, number> = {};
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

interface UmgebungsHelfer {
  numEnv: ReturnType<typeof numEnvMit>;
  boolEnv: ReturnType<typeof boolEnvMit>;
  enumEnv: ReturnType<typeof enumEnvMit>;
  isoInstantEnv: ReturnType<typeof isoInstantEnvMit>;
  routeCentsEnv: ReturnType<typeof routeCentsEnvMit>;
  csvEnv: typeof csvEnv;
  textEnv: typeof textEnv;
  stripTrailingSlash: typeof stripTrailingSlash;
  detectProduction: () => boolean;
}

export function umgebungMit(
  fehlerliste: string[],
  env: { RENDER_EXTERNAL_URL?: string | undefined },
): UmgebungsHelfer {
  return {
    numEnv: numEnvMit(fehlerliste),
    boolEnv: boolEnvMit(fehlerliste),
    enumEnv: enumEnvMit(fehlerliste),
    isoInstantEnv: isoInstantEnvMit(fehlerliste),
    routeCentsEnv: routeCentsEnvMit(fehlerliste),
    csvEnv,
    textEnv,
    stripTrailingSlash,
    detectProduction: () => !!env.RENDER_EXTERNAL_URL,
  };
}
