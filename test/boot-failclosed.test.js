import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, startServer, startServerExpectExit } from "./helpers.js";
import { planCapUnderivableFindings } from "../src/boot-guard.js";
import { CATALOG_SLUGS } from "../src/plans.js";
import { planCapCents } from "../src/billing/plan-caps.js";

test("T-P2-06: NaN-Budget (MAX_BUDGET_EUR=acht) -> Boot verweigert (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({ env: { MAX_BUDGET_EUR: "acht" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /\[boot\] Start abgebrochen/);
  assert.match(output, /MAX_BUDGET_EUR/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("T-P2-07: leere TWILIO_*-Env verhindert den Boot NICHT mehr -> GET /healthz 200", async () => {
  const srv = await startServer({
    env: { TWILIO_ACCOUNT_SID: "", TWILIO_AUTH_TOKEN: "", TWILIO_EDGE: "" },
  });
  try {
    assert.equal((await fetch(`${srv.localUrl}/healthz`)).status, 200);
    assert.doesNotMatch(srv.stdout, /Boot wird verweigert/);
  } finally {
    await srv.stop();
  }
});

test("T-P2-07b: gesetzte TWILIO_*-Env bootet unveraendert -> GET /healthz 200", async () => {
  const srv = await startServer({
    env: {
      TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
      TWILIO_AUTH_TOKEN: "test-twilio-auth-token",
      TWILIO_EDGE: "frankfurt",
    },
  });
  try {
    assert.equal((await fetch(`${srv.localUrl}/healthz`)).status, 200);
    assert.doesNotMatch(srv.stdout, /Boot wird verweigert/);
  } finally {
    await srv.stop();
  }
});

test("Boot-Guard: keine aktive Nummer im Store -> Boot verweigert (exit 1), nennt CLI", async () => {
  const { code, output } = await startServerExpectExit({ ownerNumber: null });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /Keine aktive Nummer im Store/);
  assert.match(output, /bootstrap-tenant/, "verweist actionable aufs Bootstrap-CLI");
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("T-P2-08: vollstaendige Config bootet -> GET /healthz 200 (kein Fehl-Refusal)", async () => {
  const srv = await startServer({});
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200, "saubere Config muss unveraendert booten");
  } finally {
    await srv.stop();
  }
});

test("OUT-05 F2: FAKE_ORIGINATE=true ohne SKIP_TWILIO_SIGNATURE_CHECK -> Boot verweigert (exit 1)", async () => {
  const { code, output } = await startServerExpectExit({
    env: { FAKE_ORIGINATE: "true", SKIP_TWILIO_SIGNATURE_CHECK: "false" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /FAKE_ORIGINATE/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("OUT-05-EL: FAKE_ORIGINATE_ELEVENLABS=true ohne SKIP_TWILIO_SIGNATURE_CHECK -> Boot verweigert (exit 1)", async () => {
  const { code, output } = await startServerExpectExit({
    env: { FAKE_ORIGINATE_ELEVENLABS: "true", SKIP_TWILIO_SIGNATURE_CHECK: "false" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /FAKE_ORIGINATE_ELEVENLABS/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("KS-P9: DEFAULT_TENANT_BUDGET_CENTS=5000 ueber MAX_BUDGET_EUR=30 bootet gruen", async () => {
  const srv = await startServer({ env: { DEFAULT_TENANT_BUDGET_CENTS: "5000" } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
  } finally {
    await srv.stop();
  }
});

test("T-P3-11: BASE_ENV (Default=0) bootet gruen, genau eine A0-Konfig-Warnung (plus die seit P8 unbedingte Deckungs-WARN)", async () => {
  const srv = await startServer({});
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    const warnLines = srv.stdout
      .split("\n")
      .filter((l) => /\[boot\] Konfig-Warnung: .*DEFAULT_TENANT_BUDGET_CENTS=0/.test(l));
    assert.equal(warnLines.length, 1, `erwartet genau eine A0-Zeile, Output:\n${srv.stdout}`);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
    assert.doesNotMatch(srv.stdout, /max_duration_s=/, "Klausel B darf bei Default 0 nicht feuern");
    assert.doesNotMatch(
      srv.stdout,
      /ohne Preis in modelPricesUsd/,
      "BASE_ENV pinnt claude-haiku-4-5 + claude-sonnet-5, beide bepreist",
    );
  } finally {
    await srv.stop();
  }
});

test("T-P3-12: inkohaerente Werte (500/300) brechen den Start ab und nennen den Zielwert", async () => {
  const { code, output } = await startServerExpectExit({
    env: { DEFAULT_TENANT_BUDGET_CENTS: "500", VOICE_TARIFF_DEFAULT_CENTS: "300" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /Start abgebrochen/);
  assert.match(output, /DEFAULT_TENANT_BUDGET_CENTS=500/);
  assert.match(output, /VOICE_TARIFF_DEFAULT_CENTS=300/);
  assert.match(output, /mindestens 600/, "Betreiber muss den Zielwert ohne Raten ablesen koennen");
  assert.doesNotMatch(output, /Gateway laeuft/);
});

test("T-P3-13: reiner CODE-Fallback (MAX_BUDGET_EUR/DEFAULT_TENANT_BUDGET_CENTS ungesetzt) bootet seit P7 gruen", async () => {
  const srv = await startServer({
    env: { DEFAULT_TENANT_BUDGET_CENTS: undefined, MAX_BUDGET_EUR: undefined },
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
    assert.doesNotMatch(
      srv.stdout,
      /max_duration_s=/,
      "Klausel B (worst_case_unaffordable) darf der CODE-Fallback nicht mehr ausloesen",
    );
  } finally {
    await srv.stop();
  }
});

test("KS-P9: MAX_BUDGET_EUR=8 unter der Business-Plan-Decke bootet gruen (kein plan_cap_inert mehr)", async () => {
  const srv = await startServer({ env: { MAX_BUDGET_EUR: "8" } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
  } finally {
    await srv.stop();
  }
  assert.deepEqual(
    planCapUnderivableFindings({
      slugs: CATALOG_SLUGS,
      capForSlug: (slug) => planCapCents(slug, { voiceTariffDefaultCents: Number(BASE_ENV.VOICE_TARIFF_DEFAULT_CENTS) }),
    }),
    [],
  );
});

test("KS-P3a: Boot mit dem Live-Satz (30 ct/min) bleibt gruen - Plan-Decken tragen die Reserve", async () => {
  const srv = await startServer({ env: { VOICE_TARIFF_DEFAULT_CENTS: "30" } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
    assert.doesNotMatch(srv.stdout, /Plan-Decke/, "kein Plan-Decken-Befund bei kohaerenter Konfiguration");
  } finally {
    await srv.stop();
  }
});

const UNPRICED_MODEL = "modell-ohne-preis";

test("B4A-BOOT-1: CLAUDE_MODEL ohne Preisstaffel -> Boot bricht ab (exit 1), nennt die ID", async () => {
  const { code, output } = await startServerExpectExit({ env: { CLAUDE_MODEL: UNPRICED_MODEL } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, new RegExp(`\\[boot\\] Start abgebrochen: Modell\\(e\\) ohne Preis in modelPricesUsd: ${UNPRICED_MODEL}`));
  assert.doesNotMatch(output, /Gateway laeuft/, "kein offener Port");
});

test("B4A-BOOT-2: PRECALL_BRIEFING_MODEL ohne Preisstaffel bricht ab - AUCH bei abgeschaltetem Briefing", async () => {
  const { code, output } = await startServerExpectExit({
    env: { PRECALL_BRIEFING_MODEL: "briefing-ohne-preis", PRECALL_BRIEFING_ENABLED: "false" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /briefing-ohne-preis/);
  assert.doesNotMatch(output, /Gateway laeuft/, "kein offener Port");
});

test("B4A-BOOT-3: eine DATIERTE Snapshot-ID ist ein anderer Schluessel -> Boot bricht ab", async () => {
  const { code, output } = await startServerExpectExit({
    env: { CLAUDE_MODEL: "claude-haiku-4-5-20251001" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /claude-haiku-4-5-20251001/);
});

test("B4A-BOOT-5: die ausgelieferte Konfiguration startet und nennt im Banner ihre Preisstaffeln", async () => {
  const srv = await startServer({});
  try {
    assert.equal((await fetch(`${srv.localUrl}/healthz`)).status, 200);
    assert.match(
      srv.stdout,
      /^ {2}Preisstaffeln: claude-haiku-4-5 ab \d{4}-\d{2}-\d{2} \(naechste: .+\) \| claude-sonnet-5 ab \d{4}-\d{2}-\d{2}/m,
      "welche Staffel dieser PROZESS faehrt, muss am Log ablesbar sein",
    );
  } finally {
    await srv.stop();
  }
});
