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
  MAX_FAILED_CONFIRMATIONS_PER_WINDOW,
  acceptanceEndMs,
  deriveConfirmationKey,
  canonicalCallRequest,
  issueConfirmationCode,
  matchedWindowIndex,
  normalizeConfirmationCode,
  windowIndexFor,
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
// Store-Spalte. Grenzen (PLAN-SECURITY.md, Abschnitt OpenAI-T2-13): nach einem Neustart
// und auf einer ANDEREN Instanz (Mehr-Instanz-Betrieb) ist ein noch gueltiger Code bis zu
// CONFIRMATION_WINDOW_MS*ACCEPTED_WINDOWS lang erneut nutzbar - die bestehende Anruf-Dedup
// (call-dedup.js, <=180s auf AKTIVE Anrufe) faengt nur den Fall eines noch laufenden Anrufs.
// KORRIGIERT (Safety-Review T2-13): der Eintrag lebt bis acceptanceEndMs (Ende des LETZTEN
// Fensters, in dem der Code angenommen wird), nicht nur bis zum Ende seines Ausstellungs-
// fensters - sonst war ein verbrauchter Code im Folgefenster wieder frei.
function makeOneTimeCodeLedger() {
  const usedUntilMs = new Map();
  return function markIfUnused({ digest, acceptedUntilMs, nowMs }) {
    for (const [key, expiresAtMs] of usedUntilMs) if (expiresAtMs <= nowMs) usedUntilMs.delete(key);
    if (usedUntilMs.has(digest)) return false;
    usedUntilMs.set(digest, acceptedUntilMs);
    return true;
  };
}

// Slot-Register (Safety-Nachbesserung T2-13, Befund "Einmal-Verbrauch vs. deterministischer
// Code"): OHNE dieses Register stellt ein erneutes prepare_call mit UNVERAENDERTEN Argumenten
// im selben Fenster deterministisch denselben (schon verbrauchten) Code aus. Nach jedem
// Verbrauch schaltet das Register fuer (Mandant, Fenster, Anfrage) den naechsten Slot frei;
// Ausstellung UND Pruefung nutzen genau diesen aktuellen Slot (call-confirmation.js,
// issueConfirmationCode/matchedWindowIndex). Vor dem ersten Verbrauch bleibt Slot 0 -
// wiederholtes prepare_call bleibt bis dahin idempotent.
function slotLedgerDigest({ tenantId, windowIdx, canonical }) {
  return createHash("sha256").update(`slot|${tenantId}|${windowIdx}|${canonical}`).digest("hex");
}

// Gleiches Speicher-/Verwerfungs-Muster wie makeOneTimeCodeLedger: haelt je (Mandant,
// Fenster, kanonische Anfrage) NUR einen Zaehler im Prozessspeicher, kein Klartext, kein
// Code - bis acceptanceEndMs des Fensters (solange dessen Codes angenommen werden).
// Dieselbe Grenze wie beim Einmal-Verbrauch-Register (Kommentar oben): je App-Instanz.
function makeFreshSlotLedger() {
  const slotByDigest = new Map();
  function prune(nowMs) {
    for (const [key, entry] of slotByDigest) if (entry.expiresAtMs <= nowMs) slotByDigest.delete(key);
  }
  return {
    currentSlot({ digest, nowMs }) {
      prune(nowMs);
      return slotByDigest.get(digest)?.slot ?? 0;
    },
    advance({ digest, acceptedUntilMs, nowMs }) {
      prune(nowMs);
      const next = (slotByDigest.get(digest)?.slot ?? 0) + 1;
      slotByDigest.set(digest, { slot: next, expiresAtMs: acceptedUntilMs });
    },
  };
}

// Fehlversuchsbremse (Safety-Review T2-13, Rechnung in call-confirmation.js): je Mandant
// hoechstens MAX_FAILED_CONFIRMATIONS_PER_WINDOW abgelehnte Codes je Bestaetigungsfenster.
// Danach lehnt die Route bis Fensterende JEDEN Code ab, ohne ihn zu pruefen - auch einen
// richtigen (fail-closed, kein Treffer-Orakel fuer einen Rater). Zaehlt nur echte
// Rateversuche (nicht-leerer Code); ein fehlender Code ist keiner. Je App-Instanz im
// Speicher wie die Register oben (Grenze: PLAN-SECURITY.md).
function makeFailedAttemptBrake() {
  const failuresByTenant = new Map();
  function countFor({ tenantKey, windowIdx }) {
    const entry = failuresByTenant.get(tenantKey);
    return entry?.windowIdx === windowIdx ? entry.count : 0;
  }
  return {
    isLocked({ tenantKey, windowIdx }) {
      return countFor({ tenantKey, windowIdx }) >= MAX_FAILED_CONFIRMATIONS_PER_WINDOW;
    },
    recordFailure({ tenantKey, windowIdx }) {
      for (const [key, entry] of failuresByTenant) if (entry.windowIdx < windowIdx) failuresByTenant.delete(key);
      failuresByTenant.set(tenantKey, { windowIdx, count: countFor({ tenantKey, windowIdx }) + 1 });
    },
  };
}

// War der vorgelegte Code der AKTUELL gueltige Code dieser Anfrage (je akzeptiertem Fenster
// genau der Code des aktuellen Slots, s. matchedWindowIndex) UND noch nicht verbraucht?
// Verbraucht ihn bei JA sofort (kein zweiter Treffer moeglich) und schaltet - NUR bei
// tatsaechlichem Verbrauch - den naechsten Slot frei, damit ein nachfolgendes prepare_call
// einen FRISCHEN Code liefert statt des soeben verbrauchten.
function consumeIfCurrent({ key, tenantId, canonical, code, nowMs, registers }) {
  const slotDigestFor = (windowIdx) => slotLedgerDigest({ tenantId, windowIdx, canonical });
  const windowIdx = matchedWindowIndex({
    key,
    tenantId,
    canonical,
    code,
    nowMs,
    slotForWindow: (idx) => registers.freshSlots.currentSlot({ digest: slotDigestFor(idx), nowMs }),
  });
  if (windowIdx === null) return false;
  const acceptedUntilMs = acceptanceEndMs(windowIdx);
  const digest = usedCodeDigest({ tenantId, windowIdx, normalizedCode: normalizeConfirmationCode(code) });
  if (!registers.markIfUnused({ digest, acceptedUntilMs, nowMs })) return false;
  registers.freshSlots.advance({ digest: slotDigestFor(windowIdx), acceptedUntilMs, nowMs });
  return true;
}

// Bremse um consumeIfCurrent: gesperrt -> false ohne Pruefung; abgelehnter echter Versuch
// -> gezaehlt.
function confirmCode({ key, tenantId, canonical, code, nowMs, registers }) {
  const brakeKey = { tenantKey: String(tenantId), windowIdx: windowIndexFor(nowMs) };
  if (registers.brake.isLocked(brakeKey)) return false;
  const confirmed = consumeIfCurrent({ key, tenantId, canonical, code, nowMs, registers });
  if (!confirmed && normalizeConfirmationCode(code)) registers.brake.recordFailure(brakeKey);
  return confirmed;
}

// tenant = { requestTenant } (dieselbe EINE Quelle wie in makeCallRoutes). now injizierbar
// fuer Tests (Route-Unit-Test mit injizierter Uhr, s. Spec Schritt 4) - der gespawnte
// Server bekommt bewusst KEINE Uhr-Naht per Env (Plan Abschnitt 4, "Nicht bauen").
export function makeCallConfirmationRoutes({ store, config, tenant: { requestTenant }, now = Date.now }) {
  const router = Router();
  const registers = {
    markIfUnused: makeOneTimeCodeLedger(),
    freshSlots: makeFreshSlotLedger(),
    brake: makeFailedAttemptBrake(),
  };

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
      const confirmed = confirmCode({
        key,
        tenantId,
        canonical,
        code: body.confirmation_code,
        nowMs,
        registers,
      });
      return res.status(HTTP_OK).json({ preview, confirmed });
    }

    // Frischer Slot nach einem etwaigen Verbrauch (s. makeFreshSlotLedger oben) - slot
    // bleibt 0, solange fuer diese exakte Anfrage in diesem Fenster noch nichts verbraucht
    // wurde, macht die Ausstellung also byte-identisch zum Bestand.
    const windowIdx = windowIndexFor(nowMs);
    const slot = registers.freshSlots.currentSlot({
      digest: slotLedgerDigest({ tenantId, windowIdx, canonical }),
      nowMs,
    });
    const { code, expiresAtMs } = issueConfirmationCode({ key, tenantId, canonical, nowMs, slot });
    return res.status(HTTP_OK).json({
      preview,
      confirmation: { code, expires_at: new Date(expiresAtMs).toISOString() },
    });
  });

  return router;
}
