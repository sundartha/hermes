import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir } from "../helpers.js";

const TENANT = "t_zustand_einstellungen";
const FREMDER_TENANT = "t_zustand_fremd";

let speicher;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  speicher = await import("../../src/store.js");
});

test("updateSettings übernimmt nur bekannte Felder passenden Typs und meldet die geänderten", () => {
  const unbekannt = speicher.updateSettings(TENANT, { gibtEsNicht: 1 });
  assert.deepEqual(unbekannt.changed, []);
  assert.equal("gibtEsNicht" in unbekannt.settings, false);
  assert.deepEqual(speicher.updateSettings(TENANT, { greeting: 5 }).changed, []);
  assert.deepEqual(speicher.updateSettings(TENANT, null).changed, []);
  const sprache = speicher.updateSettings(TENANT, { language: "DE" });
  assert.deepEqual(sprache.changed, ["language"]);
  assert.equal(sprache.settings.language, "de");
  assert.deepEqual(speicher.updateSettings(TENANT, { language: "de" }).changed, []);
  assert.equal(speicher.updateSettings(TENANT, { language: "" }).settings.language, null);
  assert.deepEqual(speicher.updateSettings(TENANT, { language: "klingonisch" }).changed, []);
  assert.equal(speicher.load().settings[TENANT].language, null);
  assert.deepEqual(speicher.updateSettings(TENANT, { greeting: "Hallo, hier ist die Praxis." }).changed, []);
});

test("Profile: ohne gespeichertes Profil Standard, setzen, auflisten, löschen", () => {
  assert.equal(speicher.resolveProfile(FREMDER_TENANT).allowCalendar, false);
  const gesetzt = speicher.setProfile(FREMDER_TENANT, { allowCalendar: true, unbekannt: 1 });
  assert.deepEqual(gesetzt.changed, ["allowCalendar"]);
  assert.deepEqual(gesetzt.profile, { allowCalendar: true });
  const erweitert = speicher.setProfile(FREMDER_TENANT, { allowLookup: true });
  assert.equal(erweitert.profile.allowCalendar, true);
  assert.equal(speicher.resolveProfile(FREMDER_TENANT).allowLookup, true);
  assert.equal(FREMDER_TENANT in speicher.listProfiles(), true);
  assert.equal(speicher.deleteProfile(FREMDER_TENANT), true);
  assert.equal(FREMDER_TENANT in speicher.listProfiles(), false);
  assert.equal(speicher.deleteProfile(FREMDER_TENANT), false);
  assert.equal(speicher.resolveProfile(null).allowCalendar, false);
});

test("Anmeldung zu Mandant: leere Angaben ändern nichts, Zuordnung wird aufgelöst", () => {
  speicher.bindSubToTenant("", TENANT);
  speicher.bindSubToTenant("sub-zustand-x", "");
  assert.equal(speicher.resolveTenant("sub-zustand-x"), null);
  speicher.bindSubToTenant("sub-zustand-x", TENANT);
  assert.equal(speicher.resolveTenant("sub-zustand-x"), TENANT);
  assert.equal(speicher.resolveTenant("sub-zustand-y"), null);
  assert.equal(speicher.resolveTenant(""), null);
});
