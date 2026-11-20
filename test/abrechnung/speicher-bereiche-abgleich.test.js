import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store.js";
import { makePgStoreMitSperre, makePgTestStore } from "../pg-helpers.js";

const JETZT_MS = Date.parse("2026-11-14T12:00:00.000Z");

const { store: echterSpeicher, db, runner } = await makePgTestStore();

async function speicherMit(markerListe) {
  await db.query("DELETE FROM outage_alert");
  for (const { code, closedAt } of markerListe) {
    await db.query(
      `INSERT INTO outage_alert (id, code, first_seen_at, last_seen_at, closed_at)
       VALUES ($1, $2, $3, $3, $4)`,
      [`otg_${code}`, code, "2026-11-14T08:00:00.000Z", closedAt ?? null],
    );
  }
  return echterSpeicher;
}

const marker = (code, felder = {}) => ({ code, ...felder });

async function schliessZeiten() {
  const { rows } = await db.query("SELECT closed_at FROM outage_alert ORDER BY id");
  return rows.map(({ closed_at: closedAt }) => (closedAt ? closedAt.toISOString() : null));
}

const iso = (ms) => new Date(ms).toISOString();

test("abgleich: die drei Kandidatenlisten liefern je ihre Mandanten als Promise und lesen load erst beim Aufruf", async () => {
  const zustand = {
    tenants: [
      { id: "t_stripe", status: "active", stripeSubscriptionId: "sub_1" },
      { id: "t_alt", status: "suspended", stripeSubscriptionId: "sub_2", suspendedAt: "2026-11-01T00:00:00.000Z" },
      { id: "t_karte", status: "active", stripePaymentMethodId: "pm_1" },
      { id: "t_karte_mit_typ", status: "active", stripePaymentMethodId: "pm_2", stripePaymentMethodType: "card" },
      { id: "t_leer", status: "active" },
    ],
  };
  const speicher = {};
  const { abgleich } = speicherBereiche(speicher);
  speicher.load = () => zustand;
  const stripe = abgleich.stripeKandidaten();
  assert.ok(stripe instanceof Promise);
  assert.deepEqual((await stripe).map(({ id }) => id), ["t_stripe"]);
  assert.deepEqual((await abgleich.veralteteAboKandidaten()).map(({ id }) => id), ["t_alt"]);
  assert.deepEqual((await abgleich.zahlartTypKandidaten()).map(({ id }) => id), ["t_karte"]);
  speicher.load = () => {
    throw new Error("kaputt");
  };
  await assert.rejects(abgleich.stripeKandidaten(), /kaputt/);
});

test("ausfall: offeneMarkerSchliessen schliesst nur offene Marker, die das Urteil trifft, und zaehlt sie", async () => {
  const speicher = await speicherMit([
    marker("treffer:offen"),
    marker("andere:offen"),
    marker("treffer:zu", { closedAt: "2026-11-14T09:00:00.000Z" }),
  ]);
  const gefragt = [];
  const antwort = speicherBereiche(speicher).ausfall.offeneMarkerSchliessen({
    istZuSchliessen: (code) => {
      gefragt.push(code);
      return code.startsWith("treffer:");
    },
    nowMs: JETZT_MS,
  });
  assert.ok(antwort instanceof Promise);
  assert.equal(await antwort, 1);
  assert.deepEqual(await schliessZeiten(), [null, iso(JETZT_MS), "2026-11-14T09:00:00.000Z"]);
  assert.deepEqual(gefragt.sort(), ["andere:offen", "treffer:offen"]);
});

test("ausfall: offeneMarkerSchliessen ohne Treffer liefert 0 und laesst alles offen", async () => {
  const speicher = await speicherMit([marker("a"), marker("b")]);
  const anzahl = await speicherBereiche(speicher).ausfall.offeneMarkerSchliessen({
    istZuSchliessen: () => false,
    nowMs: JETZT_MS,
  });
  assert.equal(anzahl, 0);
  assert.deepEqual(await schliessZeiten(), [null, null]);
});

test("ausfall: offeneMarkerSchliessen wirft den Fehler der Datenbank weiter und schliesst dann nichts", async (t) => {
  t.mock.method(console, "error", () => {});
  await speicherMit([marker("treffer")]);
  const kaputtesRunner = {
    withClient: (fn) =>
      runner.withClient((client) =>
        fn({
          query: async () => {
            throw new Error("kaputt");
          },
          exec: client.exec,
        }),
      ),
  };
  const speicher = makePgStoreMitSperre(kaputtesRunner);
  await assert.rejects(
    speicherBereiche(speicher).ausfall.offeneMarkerSchliessen({ istZuSchliessen: () => true, nowMs: JETZT_MS }),
    /kaputt/,
  );
  assert.deepEqual(await schliessZeiten(), [null]);
});
