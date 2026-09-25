// ---- IEP-P2: Sofortannahme statt Klingeln (kein answerOnBridge) -----------------------------
// Gegenrichtung zu IEX-A4, wie im Kopf der Vorgaengerfassung vorgesehen (Dateiname bleibt, damit
// die Git-Historie dieser Zusicherung an einer Stelle liegt). Die Uebergabe traegt KEIN
// answerOnBridge mehr: das <Dial> ist das erste Verb und beantwortet das Bein sofort. Waehrend der
// Dial-Wartezeit laeuft unser Begruessungslaut als audioUrl - kein Verb davor, also keine
// Dial-Verschiebung. Die Literale stehen hier, nicht aus Konstanten abgeleitet (sonst bestuende
// ein Flip seinen eigenen Test).
// Namen beginnen mit "IEP-P2-<n>: " - trifft weder i18nCatalogPattern noch abnahmePattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EL_BEGRUESSUNGSLAUT_PFAD,
  elBegruessungslautUrl,
  elUebergabeDirektiven,
} from "../src/elevenlabs/inbound-rueckfall.js";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";
import { quelltexteUnter } from "./helpers.js";

const XML_PRAEFIX = `<?xml version="1.0" encoding="UTF-8"?><Response>`;
const PUBLIC_URL = "https://agent.test";
const DID = "+4930123456789";
const BINDUNGS_TOKEN = "0123456789abcdef0123456789abcdef";
const TEST_MAX_DAUER_S = 900;
const SPRECH_VERBEN = Object.freeze(["<Say", "<Play", "<Gather"]);
const LAUT_URL = "https://agent.test/brand/hermes-begruessungslaut.wav";
const OHNE_FUELLUNG = Object.freeze([null, undefined, ""]);
const EINMAL = 1;

function uebergabeXml(begruessungslautUrl) {
  return renderDirectives(
    elUebergabeDirektiven({
      call: { id: "call_a4", to: DID, streamToken: BINDUNGS_TOKEN, maxDurationS: TEST_MAX_DAUER_S },
      zugang: { username: "hermes-sip", password: "pw-geheim" },
      publicUrl: PUBLIC_URL,
      begruessungslautUrl,
    }),
  );
}

test("IEP-P2-1: ohne Fuellung - Dial ist das erste Verb, ohne answerOnBridge", () => {
  const xml = uebergabeXml(null);
  assert.ok(xml.startsWith(`${XML_PRAEFIX}<Dial callerId=`), xml);
  assert.ok(!xml.includes("answerOnBridge"), xml);
  assert.ok(xml.indexOf("</Dial>") < xml.indexOf("<Redirect"), "Redirect folgt dem Dial");
});

test("IEP-P2-2: mit Fuellung - audioUrl am Dial, weiterhin erstes Verb, kein answerOnBridge", () => {
  const xml = uebergabeXml(LAUT_URL);
  assert.ok(xml.startsWith(`${XML_PRAEFIX}<Dial audioUrl="${LAUT_URL}" callerId=`), xml);
  assert.ok(!xml.includes("answerOnBridge"), xml);
  assert.equal(xml.split("audioUrl=").length - 1, EINMAL);
  assert.ok(!/<Sip[^>]*audioUrl/.test(xml), "audioUrl sitzt nie am Sip");
});

test("IEP-P2-3: beide Varianten ohne jedes Sprech-Verb - der alte Pflichtsatz kommt nicht zurueck", () => {
  for (const xml of [uebergabeXml(null), uebergabeXml(LAUT_URL)]) {
    for (const verb of SPRECH_VERBEN) assert.ok(!xml.includes(verb), `${verb} in ${xml}`);
  }
});

test("IEP-P2-4: Fuellung aus -> TeXML byte-gleich zur Form ohne Fuellung", () => {
  const golden = uebergabeXml(null);
  for (const leer of OHNE_FUELLUNG) {
    assert.equal(uebergabeXml(leer), golden, `begruessungslautUrl=${JSON.stringify(leer)}`);
  }
});

test("IEP-P2-5: Pfad und URL des Lauts kommen aus EINER Quelle", () => {
  assert.equal(elBegruessungslautUrl(PUBLIC_URL), `${PUBLIC_URL}${EL_BEGRUESSUNGSLAUT_PFAD}`);
  const traeger = quelltexteUnter("src")
    .filter(([, inhalt]) => inhalt.includes(`"${EL_BEGRUESSUNGSLAUT_PFAD}"`))
    .map(([datei]) => datei);
  assert.deepEqual(traeger, ["src/elevenlabs/inbound-rueckfall.js"]);
});
