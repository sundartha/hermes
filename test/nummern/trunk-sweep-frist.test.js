import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as beleg from "../../src/elevenlabs/inbound-trunk-beleg.ts";
import { makeElConfigRead } from "../../src/telephony/outbound-config-soll.ts";
import { NUMBER_STATUS } from "../../src/begriffe/nummern.js";

const SIP_USER = "trunk-frist-sip-benutzer";
const AGENT = "agent_trunk_frist";
const DID = "+493000005378";
const JETZT = "2026-11-18T18:00:00.000Z";
const FRIST_ERWARTET = 10000;
const HTTP_UNAVAILABLE = 503;
const HTTP_NOT_FOUND = 404;

afterEach(() => mock.restoreAll());

function konfig() {
  return {
    voice: {
      elevenLabsInbound: {
        enabled: true,
        tenantIds: ["tenant_frist"],
        scope: "allowlist",
        sipUser: SIP_USER,
        sipPassword: "p".repeat(32),
        initWebhookToken: "t".repeat(32),
      },
      elevenLabsOutbound: { apiKey: "key_frist", agentId: AGENT },
    },
  };
}

function lauf(elRead) {
  const zeilen = [];
  const aufrufe = { mark: 0, clear: 0 };
  const store = {
    load: () => ({
      numbers: [{ id: "num_frist", e164: DID, status: NUMBER_STATUS.ACTIVE, providerAgentPhoneNumberId: "phnum_frist" }],
    }),
    markNumberElInboundTrunkBelegt: () => (aufrufe.mark += 1),
    clearNumberElInboundTrunkBeleg: () => (aufrufe.clear += 1),
  };
  const logger = { log: (z) => zeilen.push(z), error: (z) => zeilen.push(z) };
  const sweep = beleg.makeTrunkSweep({ store, config: konfig(), elRead, logger, jetzt: () => new Date(JETZT) });
  return { zeilen, aufrufe, laeuft: sweep.runBootSweep() };
}

test("Frist ist 10 Sekunden", () => {
  assert.equal(beleg.TRUNK_ABRUF_FRIST_MS, FRIST_ERWARTET);
});

test("Sweep gibt jedem Abruf die kurze Frist mit", async () => {
  const fristen = [];
  const elRead = {
    fetchPhoneNumber: (_id, optionen) => {
      fristen.push(optionen?.timeoutMs);
      return Promise.resolve({});
    },
  };
  await lauf(elRead).laeuft;
  assert.deepEqual(fristen, [FRIST_ERWARTET]);
});

test("Abgelaufene Frist: Nummer gilt nicht als belegt, Log nennt status=timeout", async () => {
  const elRead = {
    fetchPhoneNumber: () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
  };
  const { zeilen, aufrufe, laeuft } = lauf(elRead);
  await laeuft;
  assert.ok(zeilen.includes("[el-trunk] abruf_fehler nummer_id=num_frist status=timeout"), zeilen.join("\n"));
  assert.equal(aufrufe.mark, 0);
  assert.match(zeilen.at(-1), /belegt=0 .*unbekannt=1/);
});

test("Fehlerstatus des Anbieters steht im Log", async () => {
  const fehler = Object.assign(new Error("ElevenLabs Nummernabruf fehlgeschlagen: HTTP 503"), { providerStatus: HTTP_UNAVAILABLE });
  const { zeilen, aufrufe, laeuft } = lauf({ fetchPhoneNumber: () => Promise.reject(fehler) });
  await laeuft;
  assert.ok(zeilen.includes("[el-trunk] abruf_fehler nummer_id=num_frist status=503"), zeilen.join("\n"));
  assert.equal(aufrufe.mark, 0);
  assert.equal(aufrufe.clear, 0);
});

test("404 loggt den Status und bleibt Abweichung", async () => {
  const fehler = Object.assign(new Error("weg"), { providerStatus: HTTP_NOT_FOUND });
  const { zeilen, aufrufe, laeuft } = lauf({ fetchPhoneNumber: () => Promise.reject(fehler) });
  await laeuft;
  assert.ok(zeilen.includes("[el-trunk] abruf_fehler nummer_id=num_frist status=404"), zeilen.join("\n"));
  assert.equal(aufrufe.clear, 1);
});

test("Anderer Fehler ohne Status und ohne Frist loggt status=fehler und kein Geheimnis", async () => {
  const { zeilen, laeuft } = lauf({ fetchPhoneNumber: () => Promise.reject(new Error("GEHEIM-key_frist")) });
  await laeuft;
  assert.ok(zeilen.includes("[el-trunk] abruf_fehler nummer_id=num_frist status=fehler"), zeilen.join("\n"));
  assert.ok(!zeilen.join("\n").includes("GEHEIM"));
});

test("Erfolgreicher Abruf schreibt keine abruf_fehler-Zeile", async () => {
  const { zeilen, laeuft } = lauf({ fetchPhoneNumber: () => Promise.resolve({}) });
  await laeuft;
  assert.ok(!zeilen.join("\n").includes("abruf_fehler"));
});

test("Konfig-Leser setzt die Frist am echten Abbruch-Signal", async () => {
  const fristen = [];
  mock.method(AbortSignal, "timeout", (ms) => {
    fristen.push(ms);
    return AbortSignal.abort();
  });
  mock.method(globalThis, "fetch", () => Promise.resolve(new Response("{}", { status: 200 })));
  const leser = makeElConfigRead({
    voice: { elevenLabsOutbound: { apiKey: "key_frist", apiBase: "https://el.invalid", agentId: AGENT } },
  });
  await leser.fetchPhoneNumber("phnum_frist", { timeoutMs: FRIST_ERWARTET });
  assert.deepEqual(fristen, [FRIST_ERWARTET]);
});
