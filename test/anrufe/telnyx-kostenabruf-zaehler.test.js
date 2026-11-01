import { test } from "node:test";
import assert from "node:assert/strict";

import { withFetch } from "../helpers.js";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-kostenabruf-zaehler";

const { voiceControl } = await import("../../src/telephony/registry.js");

const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const ZUWEISBARE_ARTEN = 6;
const SEITEN_DER_ERSTEN_ART = 2;

function antwort(status, body) {
  return {
    ok: status === HTTP_OK,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function leereSeiten(url) {
  const suche = new URL(url).searchParams;
  const seiten = suche.get("filter[record_type]") === "sip-trunking" ? SEITEN_DER_ERSTEN_ART : 1;
  return Promise.resolve(antwort(HTTP_OK, { data: [], meta: { total_pages: seiten } }));
}

test("Telnyx-Kostenabruf: der Pool meldet, wie viele Anfragen und Seiten der Abruf gebraucht hat", async () => {
  const pool = await withFetch(leereSeiten, () => voiceControl("telnyx").fetchCostRecordPool({}));
  assert.equal(pool.ok, true);
  assert.equal(pool.requests, ZUWEISBARE_ARTEN + SEITEN_DER_ERSTEN_ART - 1);
  assert.equal(pool.pages, ZUWEISBARE_ARTEN + SEITEN_DER_ERSTEN_ART - 1);
});

test("Telnyx-Kostenabruf: scheitert die erste Anfrage, zählt der Pool die Anfrage, aber keine Seite", async (t) => {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "log", () => {});
  const pool = await withFetch(
    () => Promise.resolve(antwort(HTTP_SERVER_ERROR, {})),
    () => voiceControl("telnyx").fetchCostRecordPool({}),
  );
  assert.equal(pool.ok, false);
  assert.equal(pool.requests, 1);
  assert.equal(pool.pages, 0);
});
