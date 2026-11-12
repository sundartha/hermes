import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall, waitForStoreState } from "../helpers.js";
import { abschlussFuerAnruf } from "../../src/billing/kosten-abschluss.js";

const MS_PRO_MINUTE = 60_000;
const MS_PRO_STUNDE = 60 * MS_PRO_MINUTE;
const FRISTSTUNDEN = 48;
const IN_FRIST_MINUTEN_HER = 200;
const NACH_FRIST_MINUTEN_HER = (FRISTSTUNDEN + 2) * 60;
const SCHAETZUNG_CENT = 30;
const MITSCHNITT_SEKUNDEN = 60;
const LEG_ID = "cc_herkunft_1";
const SWEEP_TAKT_MS = 61_000;
const KURZER_TAKT_MS = 50;
const ABGLEICH_FRIST_MS = 10_000;

const taktVerkuerzen = [
  "const takt = Number(process.env.COST_TRUING_SWEEP_INTERVAL_MS);",
  "const echt = globalThis.setInterval;",
  `globalThis.setInterval = (fn, ms, ...rest) => echt(fn, ms === takt ? ${KURZER_TAKT_MS} : ms, ...rest);`,
].join("\n");

const PFLICHTTYPEN = "sip-trunking,call-control";
const TEXT_UNVOLLSTAENDIG = "incomplete";
const TEXT_OHNE_SCHAETZUNG = "no_estimate";
const TEXT_TEILBELEG = "kostenbuch_teilbeleg";
const TEXT_UNBESCHAFFBAR = "beleg_strukturell_unbeschaffbar";

const sipRecord = { record_type: "sip-trunking", cost: "0.0402", billed_sec: MITSCHNITT_SEKUNDEN };
const callControlRecord = { record_type: "call-control", cost: "0.0010", billed_sec: MITSCHNITT_SEKUNDEN };

async function mitAnbieterAttrappe(records, ablauf) {
  const server = http.createServer((req, res) => {
    const typ = new URL(req.url, "http://anbieter.test").searchParams.get("filter[record_type]");
    const data = records
      .filter((record) => record.record_type === typ)
      .map((record) => ({ currency: "USD", call_control_id: LEG_ID, ...record }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data, meta: { total_pages: 1 } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await ablauf(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function beendeterAnruf({ schaetzung = SCHAETZUNG_CENT, minutenHer = IN_FRIST_MINUTEN_HER, costProfile }) {
  const jetzt = Date.now();
  return seedCall({
    id: "call_herkunft_1",
    provider: "telnyx",
    callControlId: LEG_ID,
    costProfile,
    status: "completed",
    startedAt: new Date(jetzt - (minutenHer + 1) * MS_PRO_MINUTE).toISOString(),
    answeredAt: new Date(jetzt - (minutenHer + 1) * MS_PRO_MINUTE).toISOString(),
    endedAt: new Date(jetzt - minutenHer * MS_PRO_MINUTE).toISOString(),
    estimatedCostCents: schaetzung,
    costTruedAt: null,
    costTruedSource: null,
    costTruingAttempts: 0,
  });
}

async function gespeicherteHerkunftNachAbgleich({ anruf, records }) {
  return mitAnbieterAttrappe(records, async (anbieterUrl) => {
    const srv = await startServer({
      seed: seedState({ calls: [anruf] }),
      env: {
        TELNYX_API_KEY: "KEYtest-secret",
        TELNYX_CONNECTION_ID: "conn_test",
        TELNYX_ACCOUNT_SID: "acct_test",
        TELNYX_API_BASE: anbieterUrl,
        COST_TRUING_DELAY_MINUTES: "0",
        COST_TRUING_REQUIRED_RECORD_TYPES: PFLICHTTYPEN,
        COST_SETTLE_DEADLINE_HOURS: String(FRISTSTUNDEN),
        COST_TRUING_SWEEP_INTERVAL_MS: String(SWEEP_TAKT_MS),
        NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(taktVerkuerzen)}`,
      },
    });
    try {
      const stand = await waitForStoreState(
        srv,
        (store) => store.calls.some((call) => call.id === anruf.id && call.costTruedSource !== null),
        ABGLEICH_FRIST_MS,
      );
      return stand.calls.find((call) => call.id === anruf.id);
    } finally {
      await srv.stop();
    }
  });
}

test("Kostenabgleich: fehlt dem Anruf ein Pflicht-Belegtyp, steht die Herkunft 'incomplete' im Store", async () => {
  const gespeichert = await gespeicherteHerkunftNachAbgleich({
    anruf: beendeterAnruf({ costProfile: "telnyx_budget" }),
    records: [sipRecord],
  });
  assert.equal(gespeichert.costTruedSource, TEXT_UNVOLLSTAENDIG);
});

test("Kostenabgleich: ein voll belegter Anruf ohne Schaetzung speichert die Herkunft 'no_estimate'", async () => {
  const gespeichert = await gespeicherteHerkunftNachAbgleich({
    anruf: beendeterAnruf({ costProfile: "telnyx_budget", schaetzung: null }),
    records: [sipRecord, callControlRecord],
  });
  assert.equal(gespeichert.costTruedSource, TEXT_OHNE_SCHAETZUNG);
});

test("Kostenabgleich: nach Fristablauf mit fehlendem Traeger speichert die Herkunft 'kostenbuch_teilbeleg'", async () => {
  const gespeichert = await gespeicherteHerkunftNachAbgleich({
    anruf: beendeterAnruf({ costProfile: "telnyx_inbound_el_convai", minutenHer: NACH_FRIST_MINUTEN_HER }),
    records: [sipRecord, callControlRecord],
  });
  assert.equal(gespeichert.costTruedSource, TEXT_TEILBELEG);
});

const FRIST_MS = FRISTSTUNDEN * MS_PRO_STUNDE;

function abschlussMitKostenbuch({ call, belege }) {
  const jetzt = Date.now();
  return abschlussFuerAnruf({
    call: {
      ...call,
      endedAt: new Date(jetzt - IN_FRIST_MINUTEN_HER * MS_PRO_MINUTE).toISOString(),
    },
    belege,
    nowMs: jetzt,
    deadlineMs: FRIST_MS,
    sweepTraegerErledigt: true,
  });
}

test("Kostenbuch-Abschluss: ein nicht nachreifbarer Pflicht-Traeger ergibt den Endzustand 'beleg_strukturell_unbeschaffbar'", () => {
  const abschluss = abschlussMitKostenbuch({
    call: { id: "call_unbeschaffbar_1", costProfile: "telnyx_budget" },
    belege: [{ traeger: "telnyx_call_records", reife: "vorlaeufig", nachreifbar: false }],
  });
  assert.equal(abschluss.geschlossen, true);
  assert.equal(abschluss.endzustand, TEXT_UNBESCHAFFBAR);
});

test("Kostenbuch-Abschluss: ein Pflicht-Traeger ohne Nachreifung bleibt 'unvollstaendig_final', nicht 'beleg_strukturell_unbeschaffbar'", () => {
  const abschluss = abschlussMitKostenbuch({
    call: { id: "call_unbeschaffbar_2", costProfile: "telnyx_budget" },
    belege: [{ traeger: "telnyx_call_records", reife: "vorlaeufig", nachreifbar: true }],
  });
  assert.equal(abschluss.endzustand, "unvollstaendig_final");
  assert.notEqual(abschluss.endzustand, TEXT_UNBESCHAFFBAR);
});

const EL_CONV_ID = "conv_kostenabgleich_el_0001";
const EL_PFAD = `/v1/convai/conversations/${EL_CONV_ID}`;
const EL_SCHLUESSEL = "el-kostenabgleich-schluessel";
const EL_ALT_MIKRO_CENTS = 10_000_000;
const EL_NEU_MIKRO_CENTS = 12_000_000;
const EL_NEU_COST_FIAT = 0.12;

async function mitElAttrappe(ablauf) {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    anfragen.push({ url: req.url, schluessel: req.headers["xi-api-key"] });
    res.writeHead(200, { "content-type": "application/json" });
    const antwort = req.url === EL_PFAD
      ? { conversation_id: EL_CONV_ID, metadata: { cost_fiat: EL_NEU_COST_FIAT } }
      : { data: [], meta: { total_pages: 1 } };
    res.end(JSON.stringify(antwort));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await ablauf({ url: `http://127.0.0.1:${server.address().port}`, anfragen });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function elBelegZeile(anruf) {
  return {
    id: "cev_kostenabgleich_el_1",
    tenantId: anruf.tenantId,
    callId: anruf.id,
    traeger: "elevenlabs_convai",
    reife: "vorlaeufig",
    betragMikroCents: EL_ALT_MIKRO_CENTS,
    waehrung: "USD",
    quelle: "el_kosten_beleg",
    belegRef: null,
    versuche: 0,
    gemessenAt: null,
    abstandZumGespraechsendeS: null,
    detail: null,
    nachreifbar: true,
  };
}

test("Kostenabgleich: der Sweep ruft den ElevenLabs-Gespraechsabruf mit Konto und Schluessel und belegt die Zeile", async () => {
  const anruf = {
    ...beendeterAnruf({ costProfile: "el_convai_sip" }),
    elevenlabsConversationId: EL_CONV_ID,
  };
  const state = { ...seedState({ calls: [anruf] }), callCostEvidence: [elBelegZeile(anruf)] };
  await mitElAttrappe(async (el) => {
    const srv = await startServer({
      seed: state,
      env: {
        TELNYX_API_KEY: "KEYtest-secret",
        TELNYX_CONNECTION_ID: "conn_test",
        TELNYX_ACCOUNT_SID: "acct_test",
        TELNYX_API_BASE: el.url,
        ELEVENLABS_API_BASE: el.url,
        ELEVENLABS_API_KEY: EL_SCHLUESSEL,
        COST_TRUING_DELAY_MINUTES: "0",
        COST_TRUING_REQUIRED_RECORD_TYPES: PFLICHTTYPEN,
        COST_SETTLE_DEADLINE_HOURS: String(FRISTSTUNDEN),
        COST_TRUING_SWEEP_INTERVAL_MS: String(SWEEP_TAKT_MS),
        NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(taktVerkuerzen)}`,
      },
    });
    try {
      const stand = await waitForStoreState(
        srv,
        (store) => store.callCostEvidence.some((zeile) => zeile.reife === "belegt"),
        ABGLEICH_FRIST_MS,
      );
      const zeile = stand.callCostEvidence.find((eintrag) => eintrag.traeger === "elevenlabs_convai");
      assert.equal(zeile.betragMikroCents, EL_NEU_MIKRO_CENTS);
      const abruf = el.anfragen.find((anfrage) => anfrage.url === EL_PFAD);
      assert.equal(abruf.schluessel, EL_SCHLUESSEL);
    } finally {
      await srv.stop();
    }
  });
});
