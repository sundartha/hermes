import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const SEITENGROESSE = 20;
const EINTRAEGE_GESAMT = 25;
const EINTRAEGE_HINTER_DER_ERSTEN_SEITE = EINTRAEGE_GESAMT - SEITENGROESSE;
const SEHR_GROSSES_OFFSET = 1000000;
const OFFSET_FEHLER = "offset muss eine ganze Zahl ab 0 sein";
const MINUTE_MS = 60_000;
const ERSTER_START_MS = Date.parse("2026-08-21T08:00:00.000Z");
const CALLER = "+4915112345678";
const EINGETRAGEN = "2026-08-21T10:00:00.000Z";
const GESEHEN = "2026-08-21T11:00:00.000Z";

function eintragsId(index) {
  return `call_seite_${String(index).padStart(2, "0")}`;
}

function seedEintraege({ gesehen }) {
  const calls = Array.from({ length: EINTRAEGE_GESAMT }, (_, index) =>
    seedCall({
      id: eintragsId(index),
      direction: "inbound",
      from: CALLER,
      status: "completed",
      startedAt: new Date(ERSTER_START_MS + index * MINUTE_MS).toISOString(),
      summary: `Anliegen ${index}`,
      inboxEntryAt: EINGETRAGEN,
      inboxSeenAt: gesehen ? GESEHEN : null,
    }),
  );
  return seedState({ calls });
}

function idsVon(von, bis) {
  return Array.from({ length: bis - von }, (_, index) => eintragsId(von + index));
}

function poll(srv, body) {
  return abrufMitFrist(`${srv.localUrl}/api/inbox/poll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function mitServer({ gesehen }, ablauf) {
  const srv = await startServer({ seed: seedEintraege({ gesehen }) });
  try {
    await ablauf(srv);
  } finally {
    await srv.stop();
  }
}

const callIds = (body) => body.entries.map((entry) => entry.call_id);

test("Rückschau mit offset 20 liefert die 5 jüngsten Einträge hinter der ersten Seite", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const res = await poll(srv, { include_seen: true, offset: SEITENGROESSE });
    assert.equal(res.status, HTTP_OK);
    const body = await res.json();
    assert.equal(body.remaining, 0, `remaining ${body.remaining} !== 0`);
    assert.deepEqual(callIds(body), idsVon(SEITENGROESSE, EINTRAEGE_GESAMT));
  });
});

test("Rückschau mit negativem offset wird mit 400 abgelehnt", async () => {
  await mitServer({ gesehen: false }, async (srv) => {
    const res = await poll(srv, { include_seen: true, offset: -1 });
    assert.equal(res.status, HTTP_BAD_REQUEST);
    assert.deepEqual(await res.json(), { error: OFFSET_FEHLER });
  });
});

test("include_seen als Text ignoriert offset und markiert nur die 20 gelieferten Einträge", async () => {
  await mitServer({ gesehen: false }, async (srv) => {
    const first = await poll(srv, { include_seen: "true", offset: SEITENGROESSE });
    assert.equal(first.status, HTTP_OK);
    const firstBody = await first.json();
    assert.deepEqual(callIds(firstBody), idsVon(0, SEITENGROESSE));
    assert.equal(firstBody.remaining, EINTRAEGE_HINTER_DER_ERSTEN_SEITE);

    const second = await poll(srv, {});
    const secondBody = await second.json();
    assert.deepEqual(callIds(secondBody), idsVon(SEITENGROESSE, EINTRAEGE_GESAMT));
  });
});

test("[NIE1] ohne include_seen ignoriert der Abruf offset und markiert die gelieferten Einträge als gesehen", async () => {
  await mitServer({ gesehen: false }, async (srv) => {
    const first = await (await poll(srv, { offset: SEITENGROESSE })).json();
    assert.deepEqual(callIds(first), idsVon(0, SEITENGROESSE));
    const second = await (await poll(srv, {})).json();
    assert.deepEqual(callIds(second), idsVon(SEITENGROESSE, EINTRAEGE_GESAMT));
    const third = await (await poll(srv, {})).json();
    assert.deepEqual(third.entries, []);
  });
});

test("[NIE2] ohne offset bleibt es bei einer Seite von 20 und dem Rest aus dem Store", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const body = await (await poll(srv, { include_seen: true })).json();
    assert.deepEqual(callIds(body), idsVon(0, SEITENGROESSE));
    assert.equal(body.remaining, EINTRAEGE_HINTER_DER_ERSTEN_SEITE);
  });
});

test("[NIE3] offset als Text, Bruch oder negative Zahl ergibt 400 mit Fehlertext", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    for (const offset of ["20", 1.5, -1]) {
      const res = await poll(srv, { include_seen: true, offset });
      assert.equal(res.status, HTTP_BAD_REQUEST, `offset ${JSON.stringify(offset)}`);
      assert.deepEqual(await res.json(), { error: OFFSET_FEHLER });
    }
  });
});

test("[NIE4] sehr großes offset liefert 200 mit leerer Liste und remaining 0", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const res = await poll(srv, { include_seen: true, offset: SEHR_GROSSES_OFFSET });
    assert.equal(res.status, HTTP_OK);
    assert.deepEqual(await res.json(), { entries: [], remaining: 0 });
  });
});

test("[NIE5] ohne offset liefert der Abruf mit include_seen genau die erste Seite", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const body = await (await poll(srv, { include_seen: true })).json();
    assert.equal(body.entries.length, SEITENGROESSE);
    assert.equal(body.remaining, EINTRAEGE_HINTER_DER_ERSTEN_SEITE);
  });
});

test("[NIE6] der Abruf ohne include_seen liefert weiter 20 Einträge und Rest 5", async () => {
  await mitServer({ gesehen: false }, async (srv) => {
    const body = await (await poll(srv, {})).json();
    assert.deepEqual(callIds(body), idsVon(0, SEITENGROESSE));
    assert.equal(body.remaining, EINTRAEGE_HINTER_DER_ERSTEN_SEITE);
  });
});

test("[NIE7] die Audit-Zeile bleibt ein Zähler und nennt offset nicht", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const offset = 7;
    await poll(srv, { include_seen: true, offset });
    const zeile = srv.stdout.split("\n").find((text) => text.includes("[audit] inbox_poll "));
    assert.ok(zeile, "Audit-Zeile fehlt");
    assert.match(zeile, /neu=\d+ rest=\d+$/);
    assert.ok(!zeile.includes("offset"));
  });
});

test("[NIE8] die Antwort besteht nur aus entries und remaining", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const body = await (await poll(srv, { include_seen: true, offset: SEITENGROESSE })).json();
    assert.deepEqual(Object.keys(body).sort(), ["entries", "remaining"]);
  });
});

test("[NIE9] ein offset im verbrauchenden Abruf markiert übersprungene Einträge nicht als gesehen", async () => {
  await mitServer({ gesehen: false }, async (srv) => {
    await poll(srv, { offset: SEITENGROESSE });
    const rueckschau = await (await poll(srv, { include_seen: true })).json();
    assert.equal(rueckschau.entries.length, SEITENGROESSE);
    const verbrauch = await (await poll(srv, {})).json();
    assert.deepEqual(callIds(verbrauch), idsVon(SEITENGROESSE, EINTRAEGE_GESAMT));
  });
});

test("[NIE10] offset als Text bleibt abgelehnt und wird nicht in eine Zahl umgewandelt", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const res = await poll(srv, { include_seen: true, offset: "0" });
    assert.equal(res.status, HTTP_BAD_REQUEST);
    assert.deepEqual(await res.json(), { error: OFFSET_FEHLER });
  });
});

test("[NIE11] sehr großes offset lässt remaining 0 aus der Store-Abfrage kommen", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const body = await (
      await poll(srv, { include_seen: true, offset: EINTRAEGE_GESAMT + SEITENGROESSE })
    ).json();
    assert.equal(body.entries.length, 0);
    assert.equal(body.remaining, 0);
  });
});

test("[NIE12] offset als Bruch wird mit 400 abgelehnt statt abgerundet", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const res = await poll(srv, { include_seen: true, offset: 1.5 });
    assert.equal(res.status, HTTP_BAD_REQUEST);
    assert.deepEqual(await res.json(), { error: OFFSET_FEHLER });
  });
});

test("[NIE13] check_inbox-Abruf ohne offset liefert unverändert die erste Seite", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const body = await (await poll(srv, { include_seen: true })).json();
    assert.deepEqual(callIds(body), idsVon(0, SEITENGROESSE));
  });
});

test("[NIE14] die Fortsetzung zählt Stellen, ein Cursor-Feld im Body bleibt wirkungslos", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const body = await (await poll(srv, { include_seen: true, cursor: "x" })).json();
    assert.deepEqual(callIds(body), idsVon(0, SEITENGROESSE));
  });
});

test("[NIE15] offset ohne include_seen wird nicht gelesen, auch ein ungültiges offset nicht", async () => {
  await mitServer({ gesehen: false }, async (srv) => {
    const res = await poll(srv, { offset: -1 });
    assert.equal(res.status, HTTP_OK);
    assert.deepEqual(callIds(await res.json()), idsVon(0, SEITENGROESSE));
  });
});

test("[NIE16] ein limit vom Aufrufer ändert die Seitengröße von 20 nicht", async () => {
  const angefragtesLimit = 50;
  const faelle = [
    { gesehen: true, body: { include_seen: true, limit: angefragtesLimit } },
    { gesehen: false, body: { limit: angefragtesLimit } },
  ];
  for (const { gesehen, body } of faelle) {
    await mitServer({ gesehen }, async (srv) => {
      const antwort = await (await poll(srv, body)).json();
      assert.equal(antwort.entries.length, SEITENGROESSE);
      assert.equal(antwort.remaining, EINTRAEGE_HINTER_DER_ERSTEN_SEITE);
    });
  }
});

test("[NIE17] offset zählt nur Stellen, ein Cursor ändert die gelieferte Seite nicht", async () => {
  await mitServer({ gesehen: true }, async (srv) => {
    const ohneCursor = await (await poll(srv, { include_seen: true, offset: SEITENGROESSE })).json();
    const mitCursor = await (
      await poll(srv, { include_seen: true, offset: SEITENGROESSE, cursor: "x" })
    ).json();
    assert.deepEqual(mitCursor, ohneCursor);
    assert.deepEqual(callIds(mitCursor), idsVon(SEITENGROESSE, EINTRAEGE_GESAMT));
  });
});
