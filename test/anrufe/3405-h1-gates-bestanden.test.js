import { test } from "node:test";
import assert from "node:assert/strict";

const lade = () => import("../../src/telephony/gates-bestanden.ts").catch(() => ({}));

const ABLEHNUNG = { status: 403, body: { error: "nein" }, audit: { event: "e", grund: "g", detail: "d" } };
const ctx = { to: "+491711234567" };
const bestehen = (name, aufrufe) => ({ name, run: async () => { aufrufe.push(name); return null; } });
const ablehnen = (name, aufrufe) => ({ name, run: async () => { aufrufe.push(name); return ABLEHNUNG; } });
const werfen = (name, aufrufe) => ({ name, run: async () => { aufrufe.push(name); throw new Error("kaputt"); } });

test("fuehreToreAus stellt den Nachweis nur nach allen bestandenen Toren aus", async () => {
  const { fuehreToreAus, GatesBestanden } = await lade();
  assert.equal(typeof fuehreToreAus, "function");
  const aufrufe = [];
  const ergebnis = await fuehreToreAus([bestehen("a", aufrufe), bestehen("b", aufrufe)], ctx, () => ABLEHNUNG);
  assert.ok(ergebnis instanceof GatesBestanden);
  assert.equal(ergebnis.gilt, true);
  assert.deepEqual(aufrufe, ["a", "b"]);
});

test("fuehreToreAus ohne Tore stellt den Nachweis aus", async () => {
  const { fuehreToreAus, GatesBestanden } = await lade();
  assert.ok((await fuehreToreAus([], ctx, () => ABLEHNUNG)) instanceof GatesBestanden);
});

test("fuehreToreAus gibt die erste Ablehnung zurueck und fragt keine weiteren Tore", async () => {
  const { fuehreToreAus } = await lade();
  const aufrufe = [];
  const ergebnis = await fuehreToreAus(
    [bestehen("a", aufrufe), ablehnen("b", aufrufe), bestehen("c", aufrufe)],
    ctx,
    () => assert.fail("kein Torfehler"),
  );
  assert.equal(ergebnis, ABLEHNUNG);
  assert.deepEqual(aufrufe, ["a", "b"]);
});

test("fuehreToreAus uebersetzt einen Torfehler ueber den Rueckruf und stoppt", async () => {
  const { fuehreToreAus } = await lade();
  const aufrufe = [];
  const gemeldet = [];
  const ergebnis = await fuehreToreAus([werfen("a", aufrufe), bestehen("b", aufrufe)], ctx, (tor, c, fehler) => {
    gemeldet.push([tor.name, c, fehler.message]);
    return ABLEHNUNG;
  });
  assert.equal(ergebnis, ABLEHNUNG);
  assert.deepEqual(aufrufe, ["a"]);
  assert.deepEqual(gemeldet, [["a", ctx, "kaputt"]]);
});

test("der Nachweis laesst sich ausserhalb des Moduls nicht erzeugen", async () => {
  const { GatesBestanden } = await lade();
  assert.equal(typeof GatesBestanden, "function");
  assert.deepEqual(Object.getOwnPropertyNames(GatesBestanden).sort(), ["length", "name", "prototype"]);
  assert.deepEqual(Object.keys(await lade()).sort(), ["GatesBestanden", "fuehreToreAus"]);
});

test("das Erzeugen des Nachweises von aussen wirft, mit und ohne fremden Schluessel", async () => {
  const { GatesBestanden } = await lade();
  assert.equal(typeof GatesBestanden, "function");
  assert.throws(() => new GatesBestanden(), TypeError);
  assert.throws(() => new GatesBestanden(Symbol("gates-bestanden")), TypeError);
  assert.throws(() => Reflect.construct(GatesBestanden, []), TypeError);
  assert.throws(() => Reflect.construct(GatesBestanden, [Symbol.for("gates-bestanden")]), TypeError);
});
