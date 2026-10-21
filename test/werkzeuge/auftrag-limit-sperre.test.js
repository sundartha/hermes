import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { setzeLimitSperre } from "../../tools/auftrag/einsatz.mjs";
import { Verlauf } from "../../tools/auftrag/verlauf.mjs";

const JETZT = Date.parse("2026-10-21T12:00:00Z");
const MS_JE_SEKUNDE = 1000;
const MS_JE_MINUTE = 60 * MS_JE_SEKUNDE;
const HALBE_STUNDE = 30 * MS_JE_MINUTE;
const KURZE_PAUSE_HOECHSTENS = 2 * MS_JE_MINUTE;
const GEMELDET_IN_ZUKUNFT = 10 * MS_JE_MINUTE;
const LAENGERE_SPERRE = 45 * MS_JE_MINUTE;
const VOR_EINER_STUNDE = 60 * MS_JE_MINUTE;

function limitMeldung(text) {
  return JSON.stringify({ type: "result", is_error: true, result: text });
}

function resetEreignis(resetsAt) {
  return JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt } });
}

function limitAus(...zeilen) {
  const verlauf = new Verlauf();
  zeilen.forEach((zeile) => verlauf.lies(zeile));
  return verlauf.limit;
}

function restNachLimit(context, limit, { vorhanden } = {}) {
  const ordner = mkdtempSync(join(tmpdir(), "limit-sperre-"));
  context.after(() => rmSync(ordner, { recursive: true, force: true }));
  const sperre = join(ordner, "phase-l");
  if (vorhanden !== undefined) writeFileSync(sperre, String(JETZT + vorhanden));
  context.mock.timers.enable({ apis: ["Date"], now: JETZT });
  setzeLimitSperre(sperre, limit);
  return Number(readFileSync(sperre, "utf8")) - JETZT;
}

function assertKurzePause(rest) {
  assert.ok(rest > 0, `die Sperre muss eine Pause enthalten, war ${rest} ms`);
  assert.ok(rest <= KURZE_PAUSE_HOECHSTENS, `die Pause muss kurz bleiben, war ${rest} ms`);
}

test("limit-sperre: eine gemeldete Resetzeit, die beim Auswerten schon vorbei ist, sperrt nur kurz", (context) => {
  const limit = limitAus(resetEreignis(JETZT - MS_JE_SEKUNDE), limitMeldung("limit reached"));
  assertKurzePause(restNachLimit(context, limit));
});

test("limit-sperre: eine Resetzeit aus dem Meldungstext, die lange vorbei ist, sperrt nur kurz", (context) => {
  const limit = limitAus(limitMeldung(`Claude AI usage limit reached|${(JETZT - VOR_EINER_STUNDE) / MS_JE_SEKUNDE}`));
  assertKurzePause(restNachLimit(context, limit));
});

test("limit-sperre: eine Resetzeit genau jetzt sperrt nur kurz und wiederholt nicht ohne Pause", (context) => {
  assertKurzePause(restNachLimit(context, { bis: JETZT }));
});

test("limit-sperre: meldet das Limit keine Zeit, sperrt es weiter 30 Minuten", (context) => {
  const limit = limitAus(limitMeldung("limit reached"));
  assert.equal(restNachLimit(context, limit), HALBE_STUNDE);
});

test("limit-sperre: fehlt die Resetzeit ganz, sperrt es weiter 30 Minuten", (context) => {
  assert.equal(restNachLimit(context, {}), HALBE_STUNDE);
});

test("limit-sperre: eine Resetzeit 0 gilt als fehlende Angabe und sperrt 30 Minuten", (context) => {
  assert.equal(restNachLimit(context, { bis: 0 }), HALBE_STUNDE);
});

test("limit-sperre: eine unlesbare Resetzeit gilt als fehlende Angabe und sperrt 30 Minuten", (context) => {
  assert.equal(restNachLimit(context, { bis: Number.NaN }), HALBE_STUNDE);
});

test("limit-sperre: eine Resetzeit in der Zukunft sperrt genau bis dahin", (context) => {
  const limit = limitAus(resetEreignis(JETZT + GEMELDET_IN_ZUKUNFT), limitMeldung("limit reached"));
  assert.equal(restNachLimit(context, limit), GEMELDET_IN_ZUKUNFT);
});

test("limit-sperre: eine längere bestehende Sperre bleibt, auch wenn die gemeldete Zeit schon vorbei ist", (context) => {
  const rest = restNachLimit(context, { bis: JETZT - MS_JE_SEKUNDE }, { vorhanden: LAENGERE_SPERRE });
  assert.equal(rest, LAENGERE_SPERRE);
});

test("limit-sperre: eine längere bestehende Sperre bleibt, auch wenn die gemeldete Zeit früher liegt", (context) => {
  const rest = restNachLimit(context, { bis: JETZT + GEMELDET_IN_ZUKUNFT }, { vorhanden: LAENGERE_SPERRE });
  assert.equal(rest, LAENGERE_SPERRE);
});
