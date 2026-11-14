import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store.js";

const NOW_MS = Date.parse("2026-11-14T08:00:00.000Z");
const OFFEN_MS = 60_000;

function zustand() {
  return {
    tenants: [
      { id: "t_a", defaultLanguage: "fr", country: "FR", ownerName: "" },
      { id: "t_b", ownerName: "Vorhanden Schon" },
    ],
    numbers: [{ tenantId: "t_a", status: "active", language: "es" }],
    settings: {},
    calls: [],
  };
}

function speicherMit(state) {
  const speicherungen = [];
  const speicher = {
    load: () => state,
    save: () => speicherungen.push("save"),
    withStoreLock: (arbeit) => {
      speicherungen.push("sperre");
      return arbeit();
    },
  };
  return { speicher, speicherungen };
}

test("mandant: tenantLanguage liefert die Sprache aus dem Zustand als Promise", async () => {
  const state = zustand();
  const { speicher } = speicherMit(state);
  const bereiche = speicherBereiche(speicher);
  const antwort = bereiche.mandant.tenantLanguage("t_a");
  assert.ok(antwort instanceof Promise);
  assert.equal(await antwort, "es");
  state.settings.t_a = { language: "it" };
  assert.equal(await bereiche.mandant.tenantLanguage("t_a"), "it");
  assert.equal(await bereiche.mandant.tenantLanguage("t_b"), "de");
});

test("mandant: tenantGeo liefert Land und Sprache des Mandanten, ohne Mandanten null", async () => {
  const { speicher } = speicherMit(zustand());
  const bereiche = speicherBereiche(speicher);
  const antwort = bereiche.mandant.tenantGeo("t_a");
  assert.ok(antwort instanceof Promise);
  assert.deepEqual(await antwort, { country: "FR", defaultLanguage: "fr" });
  assert.deepEqual(await bereiche.mandant.tenantGeo("t_x"), { country: null, defaultLanguage: null });
});

test("mandant: identitaetSetzen traegt den Namen unter der Sperre ein und speichert nur bei Aenderung", async () => {
  const state = zustand();
  const { speicher, speicherungen } = speicherMit(state);
  const bereiche = speicherBereiche(speicher);
  const antwort = bereiche.mandant.identitaetSetzen("t_a", { firstName: "Ada", lastName: "Lovelace" });
  assert.ok(antwort instanceof Promise);
  await antwort;
  assert.equal(state.tenants[0].ownerName, "Ada Lovelace");
  assert.deepEqual(speicherungen, ["sperre", "save"]);
  await bereiche.mandant.identitaetSetzen("t_a", { firstName: "Neu", lastName: "Name" });
  await bereiche.mandant.identitaetSetzen("t_b", { firstName: "Neu", lastName: "Name" });
  assert.equal(state.tenants[0].ownerName, "Ada Lovelace");
  assert.equal(state.tenants[1].ownerName, "Vorhanden Schon");
  assert.deepEqual(speicherungen, ["sperre", "save", "sperre", "sperre"]);
});

test("mandant: ein Wurf der Sperre wird zur Ablehnung der Bereichsfunktion", async () => {
  const { speicher } = speicherMit(zustand());
  speicher.withStoreLock = () => {
    throw new Error("sperre kaputt");
  };
  await assert.rejects(
    speicherBereiche(speicher).mandant.identitaetSetzen("t_a", { firstName: "Ada" }),
    /sperre kaputt/,
  );
});

function anrufMit(consults) {
  return { id: "c_1", status: "active", answeredAt: "2026-11-14T07:00:00.000Z", consults };
}

test("rueckfrage: verwaisteSchliessen laesst offene Rueckfragen verfallen und speichert genau einmal", async () => {
  const state = zustand();
  state.calls.push(
    anrufMit([
      { id: "q_1", status: "open", askedAt: "2026-11-14T07:30:00.000Z" },
      { id: "q_2", status: "answered", askedAt: "2026-11-14T07:31:00.000Z" },
    ]),
  );
  const { speicher, speicherungen } = speicherMit(state);
  const antwort = speicherBereiche(speicher).rueckfrage.verwaisteSchliessen("c_1", {
    nowMs: NOW_MS,
    openMs: OFFEN_MS,
  });
  assert.ok(antwort instanceof Promise);
  await antwort;
  assert.deepEqual(
    state.calls[0].consults.map((consult) => consult.status),
    ["expired", "answered"],
  );
  assert.deepEqual(speicherungen, ["save"]);
});

test("rueckfrage: verwaisteSchliessen speichert nicht, wenn nichts offen ist oder der Anruf fehlt", async () => {
  const state = zustand();
  state.calls.push(anrufMit([{ id: "q_2", status: "answered", askedAt: "2026-11-14T07:31:00.000Z" }]));
  const { speicher, speicherungen } = speicherMit(state);
  const bereiche = speicherBereiche(speicher);
  await bereiche.rueckfrage.verwaisteSchliessen("c_1", { nowMs: NOW_MS, openMs: OFFEN_MS });
  await bereiche.rueckfrage.verwaisteSchliessen("c_fehlt", { nowMs: NOW_MS, openMs: OFFEN_MS });
  assert.deepEqual(speicherungen, []);
});
