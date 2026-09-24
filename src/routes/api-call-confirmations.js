// ---- Geldpfad: serverseitige Bestaetigung vor dem Waehlen (T2-13, N-10) -----------------
// POST /api/call-confirmations - Vorschau + Ausstellung/Pruefung des Bestaetigungs-Codes,
// den prepare_call/place_call (src/mcp-tools.js) um POST /api/calls herum legen (s.
// src/call-confirmation.js fuer WAS der Code beweist und was NICHT). Absichtlich NICHT
// unter /api/calls/..., damit sie nicht mit GET/POST /api/calls/:id kollidiert.
//
// Diese Route ist reine PRUEFUNG: sie schreibt NICHTS in den Store, ruft KEIN audit() und
// loggt weder Code noch Ziel. Sie faehrt auch NICHT die Outbound-Gate-Kette - eine Vorschau
// sagt keine Gate-Entscheidung voraus (Reserve/Audit sind Nebenwirkungen der Gates). Alle
// Sicherheits-/Geld-Gates (Permit, OUTBOUND_FROZEN, Denylist, Land, Stundenlimit,
// Tenant-Kostendecke, Max-Dauer, Signaturpruefung) laufen unveraendert erst beim echten
// Waehlen in POST /api/calls (src/routes/api-calls.js) - diese Route ersetzt kein Gate.
//
// Hinter `internalOnly` (Loopback, AUTH-P5/P7) wie POST /api/calls - ihr einziger Aufrufer
// ist der MCP-Handler (place_call/prepare_call) im selben Prozess.
import { Router } from "express";
import { createHash } from "node:crypto";

import { normNum } from "../store/defaults.js";
import { E164_FORMAT_ERROR, isTrunkZeroFormatError, resolveDialTarget } from "../telephony/outbound-gates.js";
import { supportedLanguageOf } from "../i18n/locales.js";
import { unsupportedLanguageBody, languageUnavailableBody } from "./_call-request.js";
import { TENANT_REJECT } from "../request-tenant.js";
import { internalOnly } from "../wiring/internal-only.js";
import {
  CONFIRMATION_WINDOW_MS,
  deriveConfirmationKey,
  canonicalCallRequest,
  issueConfirmationCode,
  matchedWindowIndex,
  normalizeConfirmationCode,
} from "../call-confirmation.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;
const CONFIRMATION_UNAVAILABLE_BODY = Object.freeze({ reason: "confirmation_unavailable" });
const PREVIEW_STATUS = "awaiting_confirmation";
// Zusaetzliche gebundene Felder ueber to/objective hinaus - genau die Argumente, die
// place_call auch entgegennimmt (src/mcp-tools.js, PLACE_CALL_REQUEST_SCHEMA). Fehlende
// werden in der Vorschau weggelassen (kein "briefing: undefined" im JSON).
const PREVIEW_OPTIONAL_FIELDS = ["language", "max_duration_s", "briefing", "constraints", "mandate", "context", "diagnostic"];

function buildPreview({ to, objective, body }) {
  const preview = { status: PREVIEW_STATUS, to, objective };
  for (const field of PREVIEW_OPTIONAL_FIELDS) {
    if (body[field] !== undefined) preview[field] = body[field];
  }
  return preview;
}

// Die drei EINGABE-Ablehnungen vor jedem Gate - dieselbe Reihenfolge und dieselben Bodies
// wie POST /api/calls (src/routes/api-calls.js), keine Kopie der Sprach-Bodies (die kommen
// aus dem geteilten Modul _call-request.js).
function missingFieldsDenial({ to, objective }) {
  if (to && objective) return null;
  return { status: HTTP_BAD_REQUEST, body: { error: "to und objective sind Pflicht" } };
}

function trunkZeroDenial(to) {
  if (!isTrunkZeroFormatError(to)) return null;
  return { status: HTTP_BAD_REQUEST, body: { error: E164_FORMAT_ERROR } };
}

function languageDenial({ body, config }) {
  if (!body.language) return null;
  const requested = supportedLanguageOf(body.language);
  if (!requested) return { status: HTTP_BAD_REQUEST, body: unsupportedLanguageBody() };
  if (!config.voice.elevenLabsOutbound.enabled)
    return { status: HTTP_BAD_REQUEST, body: languageUnavailableBody() };
  return null;
}

function tenantDenial(tenantId) {
  if (tenantId !== TENANT_REJECT) return null;
  return { status: HTTP_FORBIDDEN, body: { error: "Kein Tenant fuer diese Identitaet." } };
}

// Digest fuer den Einmal-Verbrauch: Mandant + Fenster + normalisierter Code. Ein Hash statt
// des Klartexts - dieselbe Zurueckhaltung wie beim Code selbst (der auch nicht geloggt
// wird), obwohl die Menge nur im Prozessspeicher lebt.
function usedCodeDigest({ tenantId, windowIdx, normalizedCode }) {
  return createHash("sha256").update(`${tenantId}|${windowIdx}|${normalizedCode}`).digest("hex");
}

// Einmal-Verbrauch je App-Instanz (Schritt 3 der Spec): bewusst im Speicher, keine
// Store-Spalte - die Architektur setzt ohnehin eine Instanz voraus (pg-Store haelt Zustand
// im Speicher, Lehre pg-store-holds-state-in-memory). Grenze: nach einem Neustart ist ein
// noch gueltiger Code bis zu CONFIRMATION_WINDOW_MS*ACCEPTED_WINDOWS lang erneut nutzbar -
// die bestehende Anruf-Dedup (call-dedup.js, <=180s auf AKTIVE Anrufe) faengt den Fall eines
// noch laufenden Anrufs; laenger zurueckliegende Replays bleiben eine akzeptierte,
// dokumentierte Grenze (PLAN-SECURITY.md).
function makeOneTimeCodeLedger() {
  const usedUntilMs = new Map();
  return function markIfUnused({ digest, windowEndMs, nowMs }) {
    for (const [key, expiresAtMs] of usedUntilMs) if (expiresAtMs <= nowMs) usedUntilMs.delete(key);
    if (usedUntilMs.has(digest)) return false;
    usedUntilMs.set(digest, windowEndMs);
    return true;
  };
}

// War der vorgelegte Code gueltig UND noch nicht verbraucht? Verbraucht ihn bei JA sofort
// (kein zweiter Treffer moeglich).
function confirmAndConsume({ key, tenantId, canonical, code, nowMs, markIfUnused }) {
  const windowIdx = matchedWindowIndex({ key, tenantId, canonical, code, nowMs });
  if (windowIdx === null) return false;
  const digest = usedCodeDigest({ tenantId, windowIdx, normalizedCode: normalizeConfirmationCode(code) });
  return markIfUnused({ digest, windowEndMs: (windowIdx + 1) * CONFIRMATION_WINDOW_MS, nowMs });
}

// tenant = { requestTenant } (dieselbe EINE Quelle wie in makeCallRoutes). now injizierbar
// fuer Tests (Route-Unit-Test mit injizierter Uhr, s. Spec Schritt 4) - der gespawnte
// Server bekommt bewusst KEINE Uhr-Naht per Env (Plan Abschnitt 4, "Nicht bauen").
export function makeCallConfirmationRoutes({ store, config, tenant: { requestTenant }, now = Date.now }) {
  const router = Router();
  const markIfUnused = makeOneTimeCodeLedger();

  router.post("/api/call-confirmations", internalOnly, (req, res) => {
    const body = req.body || {};
    const to = normNum(body.to);
    const objective = body.objective || body.goal;

    const preDenial =
      missingFieldsDenial({ to, objective }) || trunkZeroDenial(to) || languageDenial({ body, config });
    if (preDenial) return res.status(preDenial.status).json(preDenial.body);

    const tenantId = requestTenant(req);
    const tenantErr = tenantDenial(tenantId);
    if (tenantErr) return res.status(tenantErr.status).json(tenantErr.body);

    const normalizedTo = resolveDialTarget({ store, tenantId, to });
    const normalizedDenial = trunkZeroDenial(normalizedTo);
    if (normalizedDenial) return res.status(normalizedDenial.status).json(normalizedDenial.body);

    const preview = buildPreview({ to: normalizedTo, objective, body });
    const key = deriveConfirmationKey(config.auth.callConfirmationSecret);
    if (!key) return res.status(HTTP_SERVICE_UNAVAILABLE).json(CONFIRMATION_UNAVAILABLE_BODY);

    const canonical = canonicalCallRequest({ to: normalizedTo, args: body });
    const nowMs = now();

    if (typeof body.confirmation_code === "string") {
      const confirmed = confirmAndConsume({
        key,
        tenantId,
        canonical,
        code: body.confirmation_code,
        nowMs,
        markIfUnused,
      });
      return res.status(HTTP_OK).json({ preview, confirmed });
    }

    const { code, expiresAtMs } = issueConfirmationCode({ key, tenantId, canonical, nowMs });
    return res.status(HTTP_OK).json({
      preview,
      confirmation: { code, expires_at: new Date(expiresAtMs).toISOString() },
    });
  });

  return router;
}
