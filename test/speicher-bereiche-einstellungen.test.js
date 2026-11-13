import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../src/store.js";

const MANDANT = "tenant-bereiche-1";
const ANRUF = "call_bereiche_1";

function attrappe() {
  const aufrufe = [];
  const speicher = {
    resolveProfile: (tenantId) => {
      aufrufe.push(["resolveProfile", tenantId]);
      return { allowLookup: true };
    },
    setProfile: (tenantId, tier) => {
      aufrufe.push(["setProfile", tenantId, tier]);
      return { changed: ["a", "b"] };
    },
    updateSettings: (tenantId, patch) => {
      aufrufe.push(["updateSettings", tenantId, patch]);
      return { settings: { x: 1 }, changed: ["x"], geschrieben: Promise.resolve(true) };
    },
    recordCostProfile: (callId, profil) => {
      aufrufe.push(["recordCostProfile", callId, profil]);
    },
  };
  return { speicher, aufrufe };
}

test("Einstellungen/Profile: jede Bereichsfunktion liefert ein Promise mit dem Ergebnis der Speicherfunktion", async () => {
  const { speicher, aufrufe } = attrappe();
  const bereiche = speicherBereiche(speicher);
  const profil = bereiche.einstellungen.resolveProfile(MANDANT);
  assert.ok(profil instanceof Promise);
  assert.deepEqual(await profil, { allowLookup: true });
  assert.deepEqual(await bereiche.einstellungen.setProfile(MANDANT, "pro"), { changed: ["a", "b"] });
  const ergebnis = await bereiche.einstellungen.updateSettings(MANDANT, { k: "v" });
  assert.deepEqual(ergebnis.settings, { x: 1 });
  assert.deepEqual(ergebnis.changed, ["x"]);
  assert.equal(await ergebnis.geschrieben, true);
  assert.equal(await bereiche.einstellungen.recordCostProfile(ANRUF, "el"), undefined);
  assert.deepEqual(aufrufe, [
    ["resolveProfile", MANDANT],
    ["setProfile", MANDANT, "pro"],
    ["updateSettings", MANDANT, { k: "v" }],
    ["recordCostProfile", ANRUF, "el"],
  ]);
});

test("Einstellungen/Profile: Speicherfunktionen werden erst beim Aufruf gelesen", async () => {
  const { speicher } = attrappe();
  const bereiche = speicherBereiche(speicher);
  speicher.resolveProfile = () => ({ spaet: true });
  assert.deepEqual(await bereiche.einstellungen.resolveProfile(MANDANT), { spaet: true });
});

test("Einstellungen/Profile: ein Wurf der Speicherfunktion wird zur Ablehnung", async () => {
  const { speicher } = attrappe();
  speicher.recordCostProfile = () => {
    throw new Error("unbekanntes Kostenprofil");
  };
  await assert.rejects(speicherBereiche(speicher).einstellungen.recordCostProfile(ANRUF, "x"), /unbekanntes Kostenprofil/);
});
