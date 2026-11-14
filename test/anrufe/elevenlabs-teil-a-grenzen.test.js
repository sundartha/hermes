import { test } from "node:test";
import assert from "node:assert/strict";
import { findeB1Treffer } from "../../src/elevenlabs/b1-doppelankaendigung.js";
import { medienwegAus, medienwegZeilen } from "../../src/elevenlabs/medienweg.js";
import {
  BEENDE_VERSUCH,
  ENDE_ANKER,
  FRIST_ANKER,
  nachlaufPolitikFuer,
  pollDarfWirken,
} from "../../src/elevenlabs/nachlauf-politik.ts";
import { spokenTimezoneName, timezoneHypothesisForNumber } from "../../src/elevenlabs/nanp-area-codes.js";
import { callTimeContext, calleeTimezone, todayIn } from "../../src/elevenlabs/time-context.ts";

const agent = (message) => ({ role: "agent", message });
const treffer = (text) => findeB1Treffer([agent(text)]);

const FUNKTIONSWOERTER = (
  "aber als auch auf aus bei bin bis dann das dass dem den der des die dich dir doch ein eine einem " +
  "einen einer euch euer fur fuer hat habe haben hier ich ihm ihn ihnen ihr ihre ist kann kein keine " +
  "man mein meine mit nach nicht noch nun nur oder sich sie sind somit uber ueber uns unser und vom von " +
  "vor war wird wir wirst wohl zum zur the and but for with this that these those you your will shall " +
  "have has had been being are was were not here there then when what which who whom whose why how all " +
  "any both each few more most other some such than too very can just should now its his her him she " +
  "they them their ours our out off over under again once into from about les une des est sont suis " +
  "vous ils elles nous leur leurs mais donc car comme tout tous toute toutes pas plus tres ici alors " +
  "chez avec sans sous sur dans pour par que qui quoi son ses mon tes mes cet cette ces ait ont avais " +
  "etre avoir"
).split(" ");

const LEIT_CUES = {
  de: ["gut", "klar", "okay", "ok", "gerne", "gern", "natuerlich", "sicher"],
  en: ["sure", "okay", "ok", "certainly", "absolutely", "perfect", "great", "glad"],
  fr: ["bien", "certainement", "volontiers", "parfait", "absolument"],
};

test("Doppelankuendigung: jedes Funktionswort zaehlt nicht als gemeinsamer Inhalt", () => {
  for (const wort of FUNKTIONSWOERTER) {
    const text = `Gut, hut ${wort}. Klar, hut ${wort}.`;
    assert.deepEqual(treffer(text), [], wort);
  }
  assert.deepEqual(treffer("Gut, hut inhalt. Klar, hut inhalt."), [{ zeile: 0, cues: ["gut", "klar"] }]);
});

test("Doppelankuendigung: jeder Leit-Cue wird als erster und als zweiter Satzanfang erkannt", () => {
  for (const cue of Object.values(LEIT_CUES).flat()) {
    const anderer = cue === "gut" ? "klar" : "gut";
    assert.deepEqual(treffer(`${cue}, hut mut. ${anderer}, hut mut.`), [{ zeile: 0, cues: [cue, anderer] }], cue);
    assert.deepEqual(treffer(`${anderer}, hut mut. ${cue.toUpperCase()}, hut mut.`), [{ zeile: 0, cues: [anderer, cue] }], cue);
  }
  assert.deepEqual(treffer("Hallo hut mut. Gut hut mut."), []);
  assert.deepEqual(treffer("Gut hut mut. Hallo hut mut."), []);
  assert.deepEqual(treffer("Gut, hut. Gut, hut."), [{ zeile: 0, cues: ["gut", "gut"] }]);
});

test("Doppelankuendigung: Schwelle liegt bei zwei gemeinsamen Inhaltswoertern ab drei Buchstaben", () => {
  assert.deepEqual(treffer("Gut, hut. Klar, hut."), []);
  assert.deepEqual(treffer("Gut, hut mut. Klar, hut mut."), [{ zeile: 0, cues: ["gut", "klar"] }]);
  assert.deepEqual(treffer("Gut, hu mu. Klar, hu mu."), []);
  assert.deepEqual(treffer("Gut, hut hu mu. Klar, hut hu mu."), []);
  assert.deepEqual(treffer("Gut, 123 456. Klar, 123 456."), []);
  assert.deepEqual(treffer("Gut, 1234 hut. Klar, 1234 hut."), []);
  assert.deepEqual(treffer("Gut, abc1 hut. Klar, abc1 hut."), [{ zeile: 0, cues: ["gut", "klar"] }]);
  assert.deepEqual(treffer("Gut, Hut, Mut! Klar, hut; mut."), [{ zeile: 0, cues: ["gut", "klar"] }]);
});

test("Doppelankuendigung: Satzgrenzen sind Punkt, Ausrufe- und Fragezeichen mit Leerraum sowie Zeilenumbruch", () => {
  const erwartet = [{ zeile: 0, cues: ["gut", "klar"] }];
  assert.deepEqual(treffer("Gut, hut mut! Klar, hut mut?"), erwartet);
  assert.deepEqual(treffer("Gut, hut mut?   Klar, hut mut."), erwartet);
  assert.deepEqual(treffer("Gut, hut mut\nKlar, hut mut"), erwartet);
  assert.deepEqual(treffer("Gut, hut mut\n\n\nKlar, hut mut"), erwartet);
  assert.deepEqual(treffer("Gut, hut mut.Klar, hut mut."), []);
  assert.deepEqual(treffer("Gut, hut mut, Klar, hut mut."), []);
  assert.deepEqual(treffer("Gut, hut mut; Klar, hut mut."), []);
});

test("Doppelankuendigung: Audio-Marken von 1 bis 40 Zeichen werden durch Leerraum ersetzt", () => {
  const erwartet = [{ zeile: 0, cues: ["gut", "klar"] }];
  assert.deepEqual(treffer(`Gut, hut mut. [${"a".repeat(40)}] Klar, hut mut.`), erwartet);
  assert.deepEqual(treffer("Gut, hut mut. [a] Klar, hut mut."), erwartet);
  assert.deepEqual(treffer(`Gut, hut mut. [${"a".repeat(41)}] Klar, hut mut.`), []);
  assert.deepEqual(treffer("Gut, hut mut. [] Klar, hut mut."), []);
  assert.deepEqual(treffer("Gut, hut mut. [ab\ncd] Klar, hut mut."), []);
  assert.deepEqual(treffer("Gut, hut[x]mut. Klar, hut mut."), erwartet);
  assert.deepEqual(treffer("Gut, [x]hut mut. Klar, hut mut."), erwartet);
});

test("Doppelankuendigung: Suche geht nach einem Fehlpaar weiter, je Zeile hoechstens ein Treffer", () => {
  assert.deepEqual(treffer("Gut, aaa. Klar, hut mut. Gut, hut mut."), [{ zeile: 0, cues: ["klar", "gut"] }]);
  assert.deepEqual(treffer("Hallo hut. Gut, hut mut. Klar, hut mut."), [{ zeile: 0, cues: ["gut", "klar"] }]);
  assert.deepEqual(treffer("Gut, hut mut. Klar, hut mut. Sure, hut mut."), [{ zeile: 0, cues: ["gut", "klar"] }]);
  const paar = "Gut, hut mut. Klar, hut mut.";
  assert.deepEqual(findeB1Treffer([null, agent(paar), { role: "user", message: paar }, agent(""), agent(paar)]), [
    { zeile: 1, cues: ["gut", "klar"] },
    { zeile: 4, cues: ["gut", "klar"] },
  ]);
  assert.deepEqual(findeB1Treffer(null), []);
  assert.deepEqual(findeB1Treffer(undefined), []);
  assert.deepEqual(treffer("Gut."), []);
});

const mitSid = (callSid, zusatz = {}) => ({ metadata: { phone_call: { call_sid: callSid, ...zusatz } } });
const zeilen = (conversation, erwartet) => medienwegZeilen({ conversation, callId: "c1", conversationId: "v1", erwartet });

test("Medienweg: Praefix entscheidet nur bei genauem Anfang mit Unterstrich", () => {
  const tabelle = [
    ["SCL_abc", "livekit"],
    ["otb_abc", "sipgo"],
    ["SCLabc", "unbekannt"],
    ["scl_abc", "unbekannt"],
    ["xSCL_abc", "unbekannt"],
    ["otb", "unbekannt"],
    ["abc", "unbekannt"],
  ];
  for (const [sid, weg] of tabelle) assert.equal(medienwegAus(mitSid(sid)), weg, sid);
  for (const sid of ["", 5, null, undefined, {}]) assert.equal(medienwegAus(mitSid(sid)), null, String(sid));
  for (const gespraech of [undefined, null, {}, { metadata: {} }, { metadata: { phone_call: null } }])
    assert.equal(medienwegAus(gespraech), null);
});

test("Medienweg: Logzeile mit bereinigtem, auf acht Zeichen gekuerztem Praefix und Nummernkennung", () => {
  assert.equal(
    zeilen(mitSid("SCL_xyz", { phone_number_id: "ph1" }), "").info,
    "[el-medienweg] callId=c1 conversationId=v1 weg=livekit call_sid_praefix=SCL phone_number_id=ph1",
  );
  assert.equal(
    zeilen(mitSid("a-b!cdefghijkl_x"), "").info,
    "[el-medienweg] callId=c1 conversationId=v1 weg=unbekannt call_sid_praefix=abcdefgh phone_number_id=unbekannt",
  );
  assert.equal(zeilen(mitSid("12345678_x"), undefined).info.includes("call_sid_praefix=12345678 "), true);
  assert.equal(zeilen(mitSid("123456789_x"), undefined).info.includes("call_sid_praefix=12345678 "), true);
  assert.equal(zeilen(mitSid("abcdefghijkl"), undefined).info.includes("call_sid_praefix=abcdefgh "), true);
  assert.equal(zeilen(mitSid("otb_x", { phone_number_id: null }), undefined).info.endsWith("phone_number_id=unbekannt"), true);
  assert.equal(zeilen(mitSid("otb_x", { phone_number_id: "" }), undefined).info.endsWith("phone_number_id="), true);
});

test("Medienweg: Abweichung nennt Bezug und erwarteten Weg, nur bei gesetztem und anderem Wert", () => {
  assert.equal(
    zeilen(mitSid("otb_x"), "livekit").abweichung,
    "[el-medienweg-abweichung] callId=c1 conversationId=v1 weg=sipgo erwartet=livekit",
  );
  assert.equal(zeilen(mitSid("SCL_x"), "sipgo").abweichung, "[el-medienweg-abweichung] callId=c1 conversationId=v1 weg=livekit erwartet=sipgo");
  assert.equal(zeilen(mitSid("SCL_x"), "livekit").abweichung, null);
  assert.equal(zeilen(mitSid("SCL_x"), undefined).abweichung, null);
  assert.equal(zeilen(mitSid("SCL_x"), null).abweichung, null);
  assert.equal(zeilen(mitSid("SCL_x"), "").abweichung, null);
  assert.equal(zeilen({}, "livekit"), null);
});

const HEUTE = {
  ankerNachziehen: true,
  anbieterZusammenfassung: true,
  naechsteSchritteAlsAufgabe: true,
  beendeVersuch: "el",
  fristAnker: "anbieter_cap",
  endeAnker: "jetzt",
  frischPruefenNachAbruf: false,
};
const INBOUND = {
  ankerNachziehen: false,
  anbieterZusammenfassung: false,
  naechsteSchritteAlsAufgabe: false,
  beendeVersuch: "traeger",
  fristAnker: "nachlauf_start",
  endeAnker: "carrier_ende",
  frischPruefenNachAbruf: true,
};
const OUTBOUND = { ...INBOUND, anbieterZusammenfassung: true, naechsteSchritteAlsAufgabe: true };
const IN_EL = "telnyx_inbound_el_convai";
const OUT_EL = "telnyx_outbound_el_convai";

test("Nachlauf-Politik: Werte der Konstanten und die Politik je Anruf", () => {
  assert.deepEqual({ ...BEENDE_VERSUCH }, { EL: "el", TRAEGER: "traeger" });
  assert.deepEqual({ ...FRIST_ANKER }, { ANBIETER_CAP: "anbieter_cap", NACHLAUF_START: "nachlauf_start" });
  assert.deepEqual({ ...ENDE_ANKER }, { JETZT: "jetzt", CARRIER_ENDE: "carrier_ende" });
  const faelle = [
    [{ costProfile: OUT_EL }, OUTBOUND],
    [{ costProfile: OUT_EL, answeredAt: "2026-01-01T00:00:00Z" }, OUTBOUND],
    [{ costProfile: OUT_EL, answeredAt: "2026-01-01T00:00:00Z", elFallbackAt: "x" }, OUTBOUND],
    [{ costProfile: IN_EL }, INBOUND],
    [{ costProfile: IN_EL, elevenlabsConversationId: "v" }, INBOUND],
    [{ costProfile: IN_EL, elFallbackAt: "x" }, INBOUND],
    [{ costProfile: "telnyx_inbound_budget" }, HEUTE],
    [{}, HEUTE],
    [undefined, HEUTE],
  ];
  for (const [anruf, erwartet] of faelle) assert.deepEqual({ ...nachlaufPolitikFuer(anruf) }, erwartet, JSON.stringify(anruf));
});

test("Nachlauf-Politik: Abruf wirkt nur bei aktivem Anruf ohne Rueckfall", () => {
  const faelle = [
    [{ status: "active" }, true],
    [{ status: "active", costProfile: IN_EL }, true],
    [{ status: "active", costProfile: IN_EL, elevenlabsConversationId: "v" }, true],
    [{ status: "active", costProfile: OUT_EL, answeredAt: "t" }, true],
    [{ status: "active", costProfile: OUT_EL }, true],
    [{ status: "active", costProfile: IN_EL, elFallbackAt: "x" }, false],
    [{ status: "active", costProfile: OUT_EL, answeredAt: "t", elFallbackAt: "x" }, false],
    [{ status: "completed" }, false],
    [{ status: "completed", costProfile: IN_EL }, false],
    [{}, false],
    [undefined, false],
  ];
  for (const [anruf, erwartet] of faelle) assert.equal(pollDarfWirken(anruf), erwartet, JSON.stringify(anruf));
});

const VORWAHLEN = {
  "America/New_York": "212 518 201 973 215 814 203 860 617 413 401 603 802 207 302 202 301 667 703 276 304 681 704 252 803 864 404 478 216 740 313 989 305 904 416 683 514 468",
  "America/Chicago": "312 618 414 920 612 507 515 712 314 417 501 870 504 985 601 662 205 334 214 405 580 402 531 913 316 204 584",
  "America/Denver": "303 719 801 435 505 575 307 406 780",
  "America/Phoenix": "602 520",
  "America/Los_Angeles": "213 530 206 509 503 971 702 725 604",
  "Pacific/Honolulu": "808",
};

test("Zonenvermutung: Vorwahlen der Staaten und Provinzen landen in ihrer Zone", () => {
  for (const [zone, liste] of Object.entries(VORWAHLEN))
    for (const vorwahl of liste.split(" ")) {
      assert.equal(timezoneHypothesisForNumber(`+1${vorwahl}5550143`), zone, vorwahl);
    }
});

test("Zonenvermutung: ohne Plus-Eins-Nummer oder bekannte Vorwahl bleibt sie leer", () => {
  for (const eingabe of ["+1999555014", "+44212555014", "12125550143", "+1", "", null, undefined, 12125550143, "+2125550143"])
    assert.equal(timezoneHypothesisForNumber(eingabe), "", String(eingabe));
  assert.equal(timezoneHypothesisForNumber("+1212"), "America/New_York");
  assert.equal(timezoneHypothesisForNumber("+12"), "");
  assert.equal(timezoneHypothesisForNumber("+121"), "");
  assert.equal(timezoneHypothesisForNumber("+1 212"), "");
});

test("Zonenname: gesprochener Name je Zone, unbekannte Zone bleibt unveraendert", () => {
  const tabelle = [
    ["America/New_York", "Eastern time"],
    ["America/Chicago", "Central time"],
    ["America/Denver", "Mountain time"],
    ["America/Phoenix", "Arizona time"],
    ["America/Los_Angeles", "Pacific time"],
    ["Pacific/Honolulu", "Hawaii time"],
    ["Europe/Berlin", "Europe/Berlin"],
  ];
  for (const [zone, name] of tabelle) assert.equal(spokenTimezoneName(zone), name);
});

test("Zeitkontext: Datum in der Zone des Auftraggebers, Vermutung nur ohne feste Zone", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 0, 1, 23, 30) });
  assert.equal(todayIn("Asia/Tokyo"), "Friday, 2 January 2026");
  assert.equal(todayIn("America/Los_Angeles"), "Thursday, 1 January 2026");
  const mitFesterZone = callTimeContext({ tenantTimezone: "Asia/Tokyo", callee: "+4915123456789" });
  assert.deepEqual(mitFesterZone, {
    ownerZone: "Asia/Tokyo",
    calleeZone: "Europe/Berlin",
    calleeZoneHypothesis: "",
    today: "Friday, 2 January 2026",
  });
  const nordamerika = callTimeContext({ tenantTimezone: "America/Los_Angeles", callee: "+15125550143" });
  assert.deepEqual(nordamerika, {
    ownerZone: "America/Los_Angeles",
    calleeZone: "",
    calleeZoneHypothesis: "America/Chicago",
    today: "Thursday, 1 January 2026",
  });
  assert.equal(calleeTimezone("+15125550143"), "");
  assert.equal(calleeTimezone(undefined), "");
});
