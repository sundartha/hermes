import assert from "node:assert/strict";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";
import { urteilen } from "../../scripts/anruf-probe/urteil.mjs";

const BASIS = "https://hermes-staging-erpv.onrender.com";
const ZIEL = "+12722205602";
const AUFTRAGGEBER = "Probe GmbH";
const VORNAME = "Anna";
const JETZT = Date.parse("2026-11-17T10:00:00.000Z");
const GRUSS =
  "Hallo, hier ist der KI-Assistent von Probe GmbH. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?";

function uhrBauen() {
  const uhr = { zeit: JETZT, jetzt: () => uhr.zeit, warte: async (ms) => (uhr.zeit += ms) };
  return uhr;
}

function antwort(strukturiert, { sse = false, fehler = false } = {}) {
  const rpc = { jsonrpc: "2.0", id: 1, result: { isError: fehler, structuredContent: strukturiert } };
  const koerper = sse ? `event: message\ndata: ${JSON.stringify(rpc)}\n\n` : JSON.stringify(rpc);
  return { ok: true, status: 200, text: async () => koerper };
}

function stand(abweichung = {}) {
  return {
    call_id: "c1",
    status: "in_progress",
    duration_s: 0,
    started_at: new Date(JETZT).toISOString(),
    answered_at: new Date(JETZT + 4000).toISOString(),
    last_transcript_lines: [],
    failure_reason: null,
    ...abweichung,
  };
}

function attrappe(werkzeuge) {
  const uhr = uhrBauen();
  const aufrufe = [];
  const abfrage = async (url, optionen) => {
    const nachricht = JSON.parse(optionen.body);
    const { name, arguments: argumente } = nachricht.params;
    const eintrag = { url, optionen, nachricht, name, argumente, zeit: uhr.zeit };
    aufrufe.push(eintrag);
    const nummer = aufrufe.filter((x) => x.name === name).length - 1;
    const behandler = werkzeuge[name];
    if (!behandler) return antwort({}, { fehler: true });
    return behandler(argumente, nummer, uhr);
  };
  const anrufer = anruferBauen({
    basis: BASIS,
    token: PROBE_STAGING_TEST_TOKEN,
    ziel: ZIEL,
    sprache: "de",
    auftraggeber: AUFTRAGGEBER,
    vorname: VORNAME,
    abfrage,
    uhr,
  });
  const von = (name) => aufrufe.filter((x) => x.name === name);
  return { anrufer, aufrufe, von, uhr };
}

const PLATZIERT = () => antwort({ call_id: "c1", status: "dialing" });

test("Eigene Nummer: tools/call get_agent_number als POST mit Bearer an /intern/probe/mcp, SSE-Antwort wird gelesen", async () => {
  const { anrufer, aufrufe } = attrappe({ get_agent_number: () => antwort({ number: ZIEL }, { sse: true }) });
  assert.equal(await anrufer.eigeneNummer(), ZIEL);
  const [aufruf] = aufrufe;
  assert.equal(aufruf.url, `${BASIS}/intern/probe/mcp`);
  assert.equal(aufruf.optionen.method, "POST");
  assert.equal(aufruf.optionen.redirect, "error");
  assert.equal(aufruf.optionen.headers.authorization, `Bearer ${PROBE_STAGING_TEST_TOKEN}`);
  assert.equal(aufruf.optionen.headers["content-type"], "application/json");
  assert.equal(aufruf.optionen.headers.accept, "application/json, text/event-stream");
  assert.equal(aufruf.nachricht.jsonrpc, "2.0");
  assert.equal(aufruf.nachricht.method, "tools/call");
  assert.deepEqual(aufruf.argumente, {});
});

test("Eigene Nummer: HTTP-Fehler, Werkzeugfehler und leere Antwort werden zum Fehler", async () => {
  const fehlerhafte = [
    () => ({ ok: false, status: 401, text: async () => "" }),
    () => antwort({ number: ZIEL }, { fehler: true }),
    () => ({ ok: true, status: 200, text: async () => "" }),
    () => ({ ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) }),
  ];
  for (const behandler of fehlerhafte) {
    const { anrufer } = attrappe({ get_agent_number: behandler });
    await assert.rejects(anrufer.eigeneNummer());
  }
});

function gruenerAblauf(zusatz = {}) {
  return {
    place_call: PLATZIERT,
    get_call_status: (argumente, nummer) => {
      if (nummer === 0) return antwort(stand({ last_transcript_lines: [] }));
      if (nummer === 1) {
        return antwort(stand({ last_transcript_lines: [`Gegenseite: ${GRUSS}`, "Agent: Hallo"] }));
      }
      return antwort(stand({ status: "completed", duration_s: 31 }));
    },
    cancel_call: () => antwort({}),
    ...zusatz,
  };
}

test("Anruf: place_call mit Ziel, 60 s und Deutsch, Messung aus Status und erster Gegenseitenzeile, kein Auflegen nötig", async () => {
  const { anrufer, von, uhr } = attrappe(gruenerAblauf());
  const messung = await anrufer.anrufen({ ziel: ZIEL });
  const [platziert] = von("place_call");
  assert.equal(platziert.argumente.to, ZIEL);
  assert.equal(platziert.argumente.max_duration_s, 60);
  assert.equal(platziert.argumente.language, "de");
  assert.equal(typeof platziert.argumente.objective, "string");
  assert.ok(platziert.argumente.objective.length > 0);
  assert.deepEqual(
    von("get_call_status").map((x) => x.argumente),
    [{ call_id: "c1" }, { call_id: "c1" }, { call_id: "c1" }],
  );
  assert.equal(von("cancel_call").length, 0);
  assert.deepEqual(messung, {
    annahmeSekunden: 4,
    begruessung: GRUSS,
    begruessungAntwort: false,
    gegenseite: [GRUSS],
    stillstandSekunden: 0,
    sprache: "de",
    auftraggeber: AUFTRAGGEBER,
    vorname: VORNAME,
    richtung: "eingehend",
    dauerSekunden: 31,
    status: "completed",
  });
  assert.equal(uhr.zeit, JETZT + 2 * 2000);
  assert.deepEqual(urteilen(messung), { gruen: false, gerissen: ["keine_antwort"] });
});

test("Anruf: Gegenseitenzeile in jeder Sprache der Rolle, Agentenzeilen zählen nicht, die erste gewinnt", async () => {
  for (const rolle of ["Gegenseite", "Other party", "Interlocuteur"]) {
    const { anrufer } = attrappe(
      gruenerAblauf({
        get_call_status: (argumente, nummer) => {
          if (nummer === 0) return antwort(stand({ last_transcript_lines: ["Agent: Zuerst der Agent"] }));
          if (nummer === 1) {
            return antwort(stand({ last_transcript_lines: ["Agent: Zuerst der Agent", `${rolle}: erste`] }));
          }
          if (nummer === 2) {
            return antwort(stand({ last_transcript_lines: [`${rolle}: erste`, `${rolle}: zweite`] }));
          }
          return antwort(stand({ status: "completed", duration_s: 5 }));
        },
      }),
    );
    assert.equal((await anrufer.anrufen({ ziel: ZIEL })).begruessung, "erste");
  }
});

test("Anruf: keine Gegenseitenzeile ergibt keine Begrüßung und rotes Urteil begruessung", async () => {
  const { anrufer } = attrappe(
    gruenerAblauf({
      get_call_status: (argumente, nummer) =>
        antwort(nummer === 0 ? stand({ last_transcript_lines: ["Agent: x", "Gegenseiteix: y"] }) : stand({ status: "completed", duration_s: 5 })),
    }),
  );
  const messung = await anrufer.anrufen({ ziel: ZIEL });
  assert.equal(messung.begruessung, undefined);
  assert.deepEqual(urteilen(messung).gerissen, ["begruessung", "zu_kurz", "keine_antwort"]);
});

test("Anruf: nie angenommen ergibt Status des Anbieters und Annahme ohne Zahl, Urteil rot annahme und status", async () => {
  const { anrufer, von } = attrappe(
    gruenerAblauf({
      get_call_status: () => antwort(stand({ status: "no_answer", answered_at: null })),
    }),
  );
  const messung = await anrufer.anrufen({ ziel: ZIEL });
  assert.equal(messung.status, "no_answer");
  assert.ok(Number.isNaN(messung.annahmeSekunden));
  assert.equal(von("get_call_status").length, 1);
  assert.deepEqual(urteilen(messung).gerissen, ["annahme", "begruessung", "zu_kurz", "keine_antwort", "status"]);
});

test("Anruf: jeder Endstatus beendet die Abfrage ohne Auflegen", async () => {
  for (const status of ["completed", "failed", "cancelled", "no_answer", "busy"]) {
    const { anrufer, von } = attrappe(gruenerAblauf({ get_call_status: () => antwort(stand({ status })) }));
    assert.equal((await anrufer.anrufen({ ziel: ZIEL })).status, status);
    assert.equal(von("get_call_status").length, 1);
    assert.equal(von("cancel_call").length, 0);
  }
});

test("Anruf: läuft er nach genau 60000 ms noch, wird hart aufgelegt, danach einmal der Endstand gelesen", async () => {
  const { anrufer, von, uhr } = attrappe(
    gruenerAblauf({
      get_call_status: (argumente, nummer) => {
        const aufgelegt = von("cancel_call").length > 0;
        return antwort(stand(aufgelegt ? { status: "cancelled", duration_s: 60 } : { status: "in_progress", duration_s: nummer }));
      },
    }),
  );
  const messung = await anrufer.anrufen({ ziel: ZIEL });
  assert.equal(von("cancel_call").length, 1);
  assert.equal(von("cancel_call")[0].zeit, JETZT + 60000);
  assert.deepEqual(von("cancel_call")[0].argumente, { call_id: "c1" });
  assert.equal(von("get_call_status").length, 26);
  assert.equal(uhr.zeit, JETZT + 62000);
  assert.equal(messung.status, "cancelled");
  assert.deepEqual(urteilen(messung).gerissen.includes("status"), true);
});

test("Anruf: fällt die Abfrage aus, wird aufgelegt und der Fehler bleibt", async () => {
  const { anrufer, von } = attrappe(
    gruenerAblauf({ get_call_status: () => ({ ok: false, status: 500, text: async () => "" }) }),
  );
  await assert.rejects(anrufer.anrufen({ ziel: ZIEL }), /mcp_http_500/);
  assert.equal(von("cancel_call").length, 1);
  assert.deepEqual(von("cancel_call")[0].argumente, { call_id: "c1" });
});

test("Anruf: scheitert auch das Auflegen, bleibt der erste Fehler", async () => {
  const { anrufer } = attrappe(
    gruenerAblauf({
      get_call_status: () => ({ ok: false, status: 502, text: async () => "" }),
      cancel_call: () => ({ ok: false, status: 503, text: async () => "" }),
    }),
  );
  await assert.rejects(anrufer.anrufen({ ziel: ZIEL }), /mcp_http_502/);
});

test("Anruf: wird nicht gewählt (Werkzeugfehler), wird nichts aufgelegt und der Fehler zeigt das Werkzeug", async () => {
  const { anrufer, von } = attrappe({ place_call: () => antwort({}, { fehler: true }) });
  await assert.rejects(anrufer.anrufen({ ziel: ZIEL }), /mcp_place_call_fehlgeschlagen/);
  assert.equal(von("cancel_call").length, 0);
});

function listeMit(eintraege, starts) {
  return {
    list_calls: () => antwort({ calls: eintraege }),
    get_call_status: (argumente) => antwort(stand({ call_id: argumente.call_id, started_at: starts[argumente.call_id] })),
  };
}

function ausgehend(id, gegenseite = ZIEL, richtung = "outbound") {
  return { id, direction: richtung, counterparty: gegenseite, status: "completed", startedAt: "Di., 17.11., 10:00" };
}

const TAGESSTAND = [
  ["kein Anruf heute", [], { erstversuche: 0, anrufe: 0 }],
  ["zwei Erstversuche weit auseinander", ["2026-11-17T01:00:00.000Z", "2026-11-17T07:00:00.000Z"], { erstversuche: 2, anrufe: 2 }],
  ["Wiederholung genau 120 s danach", ["2026-11-17T01:00:00.000Z", "2026-11-17T01:02:00.000Z"], { erstversuche: 1, anrufe: 2 }],
  ["Wiederholung genau 240 s danach", ["2026-11-17T01:00:00.000Z", "2026-11-17T01:04:00.000Z"], { erstversuche: 1, anrufe: 2 }],
  ["119 s danach ist keine Wiederholung", ["2026-11-17T01:00:00.000Z", "2026-11-17T01:01:59.000Z"], { erstversuche: 2, anrufe: 2 }],
  ["241 s danach ist keine Wiederholung", ["2026-11-17T01:00:00.000Z", "2026-11-17T01:04:01.000Z"], { erstversuche: 2, anrufe: 2 }],
  ["Reihenfolge der Liste egal", ["2026-11-17T01:02:00.000Z", "2026-11-17T01:00:00.000Z"], { erstversuche: 1, anrufe: 2 }],
  ["gestern 23:59:59 zählt nicht, heute 00:00:00 schon", ["2026-11-16T23:59:59.000Z", "2026-11-17T00:00:00.000Z"], { erstversuche: 1, anrufe: 1 }],
  ["morgen zählt nicht", ["2026-11-18T00:00:00.000Z", "2026-11-17T23:59:59.000Z"], { erstversuche: 1, anrufe: 1 }],
];

for (const [name, zeiten, erwartet] of TAGESSTAND) {
  test(`Tagesstand UTC: ${name}`, async () => {
    const eintraege = zeiten.map((_zeit, index) => ausgehend(`k${index}`));
    const starts = Object.fromEntries(zeiten.map((zeit, index) => [`k${index}`, zeit]));
    const { anrufer } = attrappe(listeMit(eintraege, starts));
    assert.deepEqual(await anrufer.tagesstand(), erwartet);
  });
}

test("Tagesstand: fremde Gegenseite und eingehende Anrufe zählen nicht und werden nicht abgefragt", async () => {
  const eintraege = [
    ausgehend("a", ZIEL),
    ausgehend("b", "+4930555000199"),
    ausgehend("c", ZIEL, "inbound"),
    ausgehend("d", null),
  ];
  const starts = { a: "2026-11-17T01:00:00.000Z", b: "2026-11-17T02:00:00.000Z", c: "2026-11-17T03:00:00.000Z", d: "2026-11-17T04:00:00.000Z" };
  const { anrufer, von } = attrappe(listeMit(eintraege, starts));
  assert.deepEqual(await anrufer.tagesstand(), { erstversuche: 1, anrufe: 1 });
  assert.deepEqual(von("get_call_status").map((x) => x.argumente.call_id), ["a"]);
});

test("Tagesstand: nicht lesbar heißt Fehler (Liste fehlt, Status fehlt, Startzeit ohne Datum)", async () => {
  const faelle = [
    { list_calls: () => ({ ok: false, status: 500, text: async () => "" }) },
    {
      list_calls: () => antwort({ calls: [ausgehend("a")] }),
      get_call_status: () => ({ ok: false, status: 500, text: async () => "" }),
    },
    listeMit([ausgehend("a")], { a: null }),
    listeMit([ausgehend("a")], { a: "gestern" }),
  ];
  for (const werkzeuge of faelle) {
    const { anrufer } = attrappe(werkzeuge);
    await assert.rejects(anrufer.tagesstand());
  }
});

function vollListe(anzahl, tagVon) {
  const eintraege = Array.from({ length: anzahl }, (_x, index) => ausgehend(`v${index}`, "+4930555000199"));
  const starts = Object.fromEntries(eintraege.map((eintrag, index) => [eintrag.id, tagVon(index)]));
  return listeMit(eintraege, starts);
}

test("Tagesstand: volle Liste von 30 Einträgen, alle von heute, ist nicht lesbar und stoppt mit probe_tageszaehl_unklar", async () => {
  const { anrufer } = attrappe(vollListe(30, () => "2026-11-17T01:00:00.000Z"));
  await assert.rejects(anrufer.tagesstand(), /probe_tageszaehl_unklar/);
});

test("Tagesstand: volle Liste mit einem Eintrag von gestern ist vollständig und zählt", async () => {
  const { anrufer } = attrappe(vollListe(30, (index) => (index === 29 ? "2026-11-16T23:00:00.000Z" : "2026-11-17T01:00:00.000Z")));
  assert.deepEqual(await anrufer.tagesstand(), { erstversuche: 0, anrufe: 0 });
});

test("Tagesstand: 29 Einträge, alle von heute, sind vollständig und zählen", async () => {
  const { anrufer } = attrappe(vollListe(29, () => "2026-11-17T01:00:00.000Z"));
  assert.deepEqual(await anrufer.tagesstand(), { erstversuche: 0, anrufe: 0 });
});
