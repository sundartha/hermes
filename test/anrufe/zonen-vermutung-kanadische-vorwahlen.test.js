import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { TELNYX_TEST_OWNER_NUMBER, seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";

const HTTP_OK = 200;
const AUFTRAGGEBER_ZONE = "Europe/Berlin";

const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_p011",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_p011",
  ELEVENLABS_API_KEY: "el-p011-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});

const ZONEN = Object.freeze({
  eastern: { kennung: "America/New_York", name: "Eastern time" },
  central: { kennung: "America/Chicago", name: "Central time" },
  mountain: { kennung: "America/Denver", name: "Mountain time" },
  pacific: { kennung: "America/Los_Angeles", name: "Pacific time" },
});

const vorwahlen = (liste) => liste.split(" ");

const KANADISCHE_VORWAHLEN = Object.freeze({
  eastern: vorwahlen(
    "416 647 437 942 905 289 365 742 613 343 753 519 226 548 382 705 249 683 " +
      "514 438 263 450 579 354 819 873 468",
  ),
  central: vorwahlen("204 431 584"),
  mountain: vorwahlen("780"),
  pacific: vorwahlen("604"),
});

const AUSGELASSENE_VORWAHLEN = Object.freeze(
  vorwahlen(
    "807 418 581 367 250 778 236 672 257 403 587 825 368 867 306 474 639 902 782 506 428 709 879",
  ),
);

const NEW_YORK_SATZ =
  '\nThe person you are calling is probably in the America/New_York time zone. That is an assumption derived from their area code, it is not confirmed, and it may be wrong. Before you name any specific time, confirm it in one short sentence, for example: "I have you down as Eastern time - is that right?" Once they have confirmed it, convert every time you agree between those two zones and say which zone you mean.';

const OHNE_ZONE_SATZ =
  '\nYou do not know which time zone the person you are calling is in, and you must not guess one. Never name an absolute time while the zone is unknown - no specific time, no clock time. Stay vague instead ("tomorrow morning") and let them name the exact time; then repeat it back together with the time zone they used.';

const nummerMit = (vorwahl) => `+1${vorwahl}5550147`;

const dynamischeVariablen = (start) =>
  start.body.conversation_initiation_client_data?.dynamic_variables ?? {};

async function zoneBeimAnrufstart({ srv, anbieter }, nummer) {
  const vorher = anbieter.starts().length;
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: nummer, objective: `Termin vereinbaren (P011 ${nummer})` }),
  });
  const antwort = await res.text();
  assert.equal(
    res.status,
    HTTP_OK,
    `Vorbedingung: der Anruf an ${nummer} muss starten: ${antwort}`,
  );
  const starts = anbieter.starts();
  assert.equal(starts.length, vorher + 1, `Vorbedingung: genau ein Anrufstart fuer ${nummer}`);
  const start = starts.at(-1);
  assert.equal(start.body.to_number, nummer, "Vorbedingung: gewaehlt wurde die Zielnummer");
  return dynamischeVariablen(start).callee_timezone;
}

async function starteAnrufweg() {
  const anbieter = await starteAnrufstartAttrappe();
  const srv = await startServer({
    env: { ...EL_WEG, ELEVENLABS_API_BASE: anbieter.url },
    seed: seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", timezone: AUFTRAGGEBER_ZONE }],
    }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  return {
    zone: (nummer) => zoneBeimAnrufstart({ srv, anbieter }, nummer),
    stoppen: async () => {
      await srv.stop();
      await anbieter.schliessen();
    },
  };
}

async function pruefeVermutung(weg, nummer, zone) {
  const { kennung, name } = ZONEN[zone];
  const text = await weg.zone(nummer);
  const vermutung = `probably in the ${kennung} time zone`;
  const bestaetigung = `I have you down as ${name} - is that right?`;
  assert.ok(
    String(text).includes(vermutung),
    `${nummer}: callee_timezone nennt nicht „${vermutung}“: ${text}`,
  );
  assert.ok(
    String(text).includes(bestaetigung),
    `${nummer}: callee_timezone fragt nicht „${bestaetigung}“: ${text}`,
  );
}

let weg;

before(async () => {
  weg = await starteAnrufweg();
});

after(async () => {
  await weg?.stoppen();
});

test("S1: Toronto 416 bekommt die Vermutung Eastern", async () => {
  await pruefeVermutung(weg, "+14165550147", "eastern");
});

test("S2: Winnipeg 204 bekommt die Vermutung Central", async () => {
  await pruefeVermutung(weg, "+12045550147", "central");
});

test("S3: Edmonton 780 bekommt die Vermutung Mountain", async () => {
  await pruefeVermutung(weg, "+17805550147", "mountain");
});

test("S4: Vancouver 604 bekommt die Vermutung Pacific", async () => {
  await pruefeVermutung(weg, "+16045550147", "pacific");
});

test("S5: jede der 32 kanadischen Vorwahlen bekommt die Vermutung ihrer Zone", async () => {
  const anzahl = Object.values(KANADISCHE_VORWAHLEN).flat().length;
  assert.equal(anzahl, 32, "Vorbedingung: die Liste umfasst 32 Vorwahlen");
  const eigenerWeg = await starteAnrufweg();
  try {
    for (const [zone, liste] of Object.entries(KANADISCHE_VORWAHLEN)) {
      for (const vorwahl of liste) await pruefeVermutung(eigenerWeg, nummerMit(vorwahl), zone);
    }
  } finally {
    await eigenerWeg.stoppen();
  }
});

test("B1: die US-Vorwahl 212 behaelt ihren Satz zeichengleich", async () => {
  assert.equal(await weg.zone("+12125550147"), NEW_YORK_SATZ);
});

test("B2: eine Nummer ohne bekannte Vorwahl behaelt den Satz ohne Zone zeichengleich", async () => {
  assert.equal(await weg.zone("+15555550147"), OHNE_ZONE_SATZ);
});

test("B3: die 23 ausgelassenen kanadischen Vorwahlen bekommen keine Vermutung", async () => {
  assert.equal(AUSGELASSENE_VORWAHLEN.length, 23, "Vorbedingung: 23 ausgelassene Vorwahlen");
  for (const vorwahl of AUSGELASSENE_VORWAHLEN) {
    assert.equal(
      await weg.zone(nummerMit(vorwahl)),
      OHNE_ZONE_SATZ,
      `${vorwahl}: callee_timezone weicht vom Satz ohne Zone ab`,
    );
  }
});
