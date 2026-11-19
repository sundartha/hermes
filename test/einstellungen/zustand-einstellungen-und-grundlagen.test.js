import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tenantsOf,
  getCall,
  settingsFor,
  calendarFor,
  updateSettings,
  resolveProfile,
  setProfile,
  deleteProfile,
  listProfiles,
  bindSubToTenant,
  resolveTenant,
} from "../../src/store/state-ops.js";

const TENANT = "t1";

test("Mandantenliste fehlt oder ist null: leere Liste, sonst die gespeicherte", () => {
  assert.deepEqual(tenantsOf({}), []);
  assert.deepEqual(tenantsOf({ tenants: null }), []);
  const liste = [{ id: TENANT }];
  assert.equal(tenantsOf({ tenants: liste }), liste);
});

test("Anruf wird über id oder Anbieter-Kennung gefunden, sonst null", () => {
  const anruf = { id: "c1", twilioSid: "CA1" };
  const state = { calls: [anruf] };
  assert.equal(getCall(state, "c1"), anruf);
  assert.equal(getCall(state, "CA1"), anruf);
  assert.equal(getCall(state, "nix"), null);
});

test("Einstellungen und Kalender werden je Mandant einmal angelegt und danach wiederverwendet", () => {
  const state = { settings: {}, calendar: {} };
  const einstellungen = settingsFor(state, TENANT);
  assert.equal(settingsFor(state, TENANT), einstellungen);
  assert.equal(state.settings[TENANT], einstellungen);
  const kalender = calendarFor(state, TENANT);
  assert.deepEqual(kalender, []);
  assert.equal(calendarFor(state, TENANT), kalender);
});

test("updateSettings übernimmt nur bekannte Felder passenden Typs und meldet die geänderten", () => {
  const state = { settings: {} };
  const vorher = { ...settingsFor(state, TENANT) };
  const unbekannt = updateSettings(state, TENANT, { gibtEsNicht: 1 });
  assert.deepEqual(unbekannt.changed, []);
  assert.deepEqual(unbekannt.settings, vorher);
  const falscherTyp = updateSettings(state, TENANT, { greeting: 5 });
  assert.deepEqual(falscherTyp.changed, []);
  const ohnePatch = updateSettings(state, TENANT, null);
  assert.deepEqual(ohnePatch.changed, []);
  const sprache = updateSettings(state, TENANT, { language: "DE" });
  assert.deepEqual(sprache.changed, ["language"]);
  assert.equal(sprache.settings.language, "de");
  assert.deepEqual(updateSettings(state, TENANT, { language: "de" }).changed, []);
  assert.deepEqual(updateSettings(state, TENANT, { language: "" }).settings.language, null);
  assert.deepEqual(updateSettings(state, TENANT, { language: "klingonisch" }).changed, []);
  assert.equal(state.settings[TENANT].language, null);
  assert.deepEqual(updateSettings(state, TENANT, { greeting: "Hallo, hier ist die Praxis." }).changed, []);
});

test("Profile: ohne gespeichertes Profil Standard, setzen, auflisten, löschen", () => {
  const state = { profiles: {} };
  assert.equal(resolveProfile(state, TENANT).allowCalendar, false);
  const gesetzt = setProfile(state, TENANT, { allowCalendar: true, unbekannt: 1 });
  assert.deepEqual(gesetzt.changed, ["allowCalendar"]);
  assert.deepEqual(gesetzt.profile, { allowCalendar: true });
  assert.equal(setProfile(state, TENANT, { allowLookup: true }).profile.allowCalendar, true);
  assert.equal(resolveProfile(state, TENANT).allowLookup, true);
  assert.equal(listProfiles(state), state.profiles);
  assert.equal(deleteProfile(state, TENANT), true);
  assert.equal(TENANT in state.profiles, false);
  assert.equal(deleteProfile(state, TENANT), false);
  assert.equal(resolveProfile(state, null).allowCalendar, false);
});

test("Anmeldung zu Mandant: Zuordnung hat Vorrang vor idpSubject, leere Angaben ändern nichts", () => {
  const state = { tenants: [{ id: TENANT, idpSubject: "sub-a" }] };
  assert.equal(resolveTenant(state, "sub-a"), TENANT);
  assert.equal(resolveTenant(state, "sub-x"), null);
  assert.equal(resolveTenant(state, ""), null);
  bindSubToTenant(state, "", TENANT);
  bindSubToTenant(state, "sub-x", "");
  assert.equal(state.subIndex, undefined);
  bindSubToTenant(state, "sub-x", "t2");
  assert.equal(resolveTenant(state, "sub-x"), "t2");
  bindSubToTenant(state, "sub-y", "t3");
  assert.deepEqual(state.subIndex, { "sub-x": "t2", "sub-y": "t3" });
  assert.equal(resolveTenant({}, "sub-a"), null);
});
