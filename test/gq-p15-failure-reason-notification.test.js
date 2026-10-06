import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCALES, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { FAILURE_REASON_BASE_TOKENS } from "../src/telephony/failure-reason.js";
import { CAP_FAILURE_REASON, BUDGET_FAILURE_REASON } from "../src/telephony/call-lifecycle.js";
import { FAILURE_REASON_TEXTS } from "../src/i18n/failure-reason-texts.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { seedCall } from "./helpers.js";

const TARGET = "+4915112345678";
const BESTAND_BODY = Object.freeze({
  de: `${TARGET} (Status: no-answer)`,
  fr: `${TARGET} (statut : no-answer)`,
  en: `${TARGET} (status: no-answer)`,
});

for (const lang of SUPPORTED_LANGUAGES) {
  test(`GQ-P15-A1 ${lang}: ohne Grund byte-identisch zum Bestand`, () => {
    const statusBody = LOCALES[lang].postCall.statusBody;
    assert.equal(statusBody(TARGET, "no-answer"), BESTAND_BODY[lang]);
    assert.equal(statusBody(TARGET, "no-answer", null), BESTAND_BODY[lang]);
    assert.equal(statusBody(TARGET, "no-answer", undefined), BESTAND_BODY[lang]);
  });

  test(`GQ-P15-A2 ${lang}: bekanntes Token traegt Label + Sprach-Phrase`, () => {
    const statusBody = LOCALES[lang].postCall.statusBody;
    const { reasonLabel, phrases } = FAILURE_REASON_TEXTS[lang];
    const body = statusBody(TARGET, "no-answer", "no-answer");
    assert.ok(body.includes(reasonLabel), `${lang}: Body traegt nicht das reasonLabel`);
    assert.ok(body.includes(phrases["no-answer"]), `${lang}: Body traegt nicht die Phrase`);
    assert.notEqual(phrases["no-answer"], "no-answer");
    if (lang !== "en") {
      assert.notEqual(phrases["no-answer"], FAILURE_REASON_TEXTS.en.phrases["no-answer"]);
    }
  });

  test(`GQ-P15-A3 ${lang}: no-answer vs. busy erzeugen verschiedene, unterscheidbare Bodies`, () => {
    const statusBody = LOCALES[lang].postCall.statusBody;
    const noAnswerBody = statusBody(TARGET, "no-answer", "no-answer");
    const busyBody = statusBody(TARGET, "busy", "busy");
    assert.notEqual(noAnswerBody, busyBody);
    assert.notEqual(noAnswerBody, BESTAND_BODY[lang]);
    assert.notEqual(busyBody, BESTAND_BODY[lang]);
  });

  test(`GQ-P15-A4 ${lang}: fremdes/gefaehrliches Token faellt auf Bestandstext zurueck`, () => {
    const statusBody = LOCALES[lang].postCall.statusBody;
    for (const token of ["wormhole-collapse", "constructor", "toString"]) {
      const body = statusBody(TARGET, "no-answer", token);
      assert.equal(body, BESTAND_BODY[lang]);
      assert.ok(!body.includes(token), `${lang}: Body enthaelt das rohe Token "${token}"`);
    }
  });

  test(`GQ-P15-A5 ${lang}: SIP-Detail (failed:603) erscheint nicht im Nutzertext`, () => {
    const statusBody = LOCALES[lang].postCall.statusBody;
    const body = statusBody(TARGET, "failed", "failed:603");
    assert.ok(body.includes(FAILURE_REASON_TEXTS[lang].phrases.failed));
    assert.ok(!body.includes("603"), `${lang}: Body enthaelt das SIP-Detail 603`);
  });
}

function fehlendePhrasen(token) {
  return SUPPORTED_LANGUAGES.filter((lang) => {
    const phrase = FAILURE_REASON_TEXTS[lang].phrases[token];
    return !(typeof phrase === "string" && phrase.length > 0);
  });
}

const REAL_BASE_TOKENS = () => new Set([...FAILURE_REASON_BASE_TOKENS, CAP_FAILURE_REASON, BUDGET_FAILURE_REASON]);

test("GQ-P15-A6: jedes real erzeugte Basis-Token hat in allen Sprachen eine Phrase, paarweise verschieden", () => {
  for (const token of REAL_BASE_TOKENS()) {
    assert.equal(
      fehlendePhrasen(token).length,
      0,
      `Token "${token}" hat keine Phrase in mindestens einer Sprache`,
    );
    const perLangPhrases = SUPPORTED_LANGUAGES.map((lang) => FAILURE_REASON_TEXTS[lang].phrases[token]);
    assert.equal(
      new Set(perLangPhrases).size,
      perLangPhrases.length,
      `Token "${token}": Phrasen sind nicht paarweise verschieden (${perLangPhrases.join(" | ")})`,
    );
  }
});

test("GQ-P15-A7: fehlendePhrasen ist eine echte Positiv-Kontrolle - ein erfundenes Token faerbt sie rot", () => {
  assert.ok(
    fehlendePhrasen("kein-solches-token").length > 0,
    "der Helfer muss ein Token OHNE Phrase auch tatsaechlich finden - sonst prueft A6 nichts",
  );
  for (const token of REAL_BASE_TOKENS()) {
    assert.equal(
      fehlendePhrasen(token).length,
      0,
      `Token "${token}" hat keine Phrase in mindestens einer Sprache`,
    );
  }
});

function throwing(label) {
  return () => {
    throw new Error(`${label} haette im passiven Fruehe-Return-Zweig nicht laufen duerfen`);
  };
}

function makeHarness(notifyCapture) {
  const config = { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} };
  const store = {
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: (title, body, callId) => notifyCapture.push({ title, body, callId }),
    markBilled: () => {},
  };
  const metering = { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} };
  return makeCallFinish({
    store,
    config,
    metering,
    messaging: throwing("messaging"),
    summarizeCall: throwing("summarizeCall"),
    planSummarySms: throwing("planSummarySms"),
    audit: throwing("audit"),
  });
}

test("GQ-P15-B1: Call mit failureReason -> Notification nennt den Grund", async () => {
  const notifyCapture = [];
  const callFinish = makeHarness(notifyCapture);
  const call = seedCall({ status: "no-answer", transcript: [], failureReason: "no-answer" });

  await callFinish.finishCall(call);

  assert.equal(notifyCapture.length, 1);
  assert.equal(notifyCapture[0].title, LOCALES.de.postCall.failedTitle);
  const expected = LOCALES.de.postCall.statusBody(call.to, "no-answer", "no-answer");
  assert.equal(notifyCapture[0].body, expected);
  assert.ok(notifyCapture[0].body.includes(FAILURE_REASON_TEXTS.de.phrases["no-answer"]));
});

test("GQ-P15-B2: Call ohne failureReason -> Body byte-identisch zum Bestand (Golden Master)", async () => {
  const notifyCapture = [];
  const callFinish = makeHarness(notifyCapture);
  const call = seedCall({ status: "no-answer", transcript: [] });

  await callFinish.finishCall(call);

  assert.equal(notifyCapture[0].body, BESTAND_BODY.de);
});

test("GQ-P15-B3: Cap- und Budget-Terminalisierung erzeugen unterscheidbare Bodies", async () => {
  const capCapture = [];
  const budgetCapture = [];
  const capCall = seedCall({
    id: "call_cap",
    status: "completed",
    transcript: [],
    failureReason: CAP_FAILURE_REASON,
  });
  const budgetCall = seedCall({
    id: "call_budget",
    status: "completed",
    transcript: [],
    failureReason: BUDGET_FAILURE_REASON,
  });

  await makeHarness(capCapture).finishCall(capCall);
  await makeHarness(budgetCapture).finishCall(budgetCall);

  assert.equal(capCapture.length, 1);
  assert.equal(budgetCapture.length, 1);
  assert.notEqual(capCapture[0].body, budgetCapture[0].body);
  const bestandCompletedBody = `${capCall.to} (Status: completed)`;
  assert.notEqual(capCapture[0].body, bestandCompletedBody);
  assert.notEqual(budgetCapture[0].body, bestandCompletedBody);
});
