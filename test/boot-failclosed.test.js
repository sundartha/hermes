// P2/OT-4 AC4: Der Boot EHRT das assertConfig-Ergebnis. Bei ungueltiger Safety-/
// Pflicht-Config startet der Dienst GAR NICHT (kein app.listen, kein /voice, kein
// /mcp) - er verweigert mit klarer Diagnose und exit(1). Lieber kein Dienst als ein
// Dienst ohne Gates (fail-closed). Kindprozess-Tests: Exit-Code + stderr/stdout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startServerExpectExit } from "./helpers.js";
import { eurToCents } from "../src/config.js";
import { planCapInertFindings } from "../src/boot-guard.js";
import { CATALOG_SLUGS } from "../src/plans.js";
import { planCapCents } from "../src/billing/plan-caps.js";

// LCT P6 Gegenprobe (j1): kohaerenter MAX_BUDGET_EUR-Wert - hoch genug (3000 ct), dass die
// hoechste abgeleitete Plan-Decke (business=900 ct) darunter bleibt. EINE Quelle fuer den
// Env-Override UND die Kohaerenz-Gegenpruefung (kein zweites Literal, G5).
const GEGENPROBE_BUDGET_EUR = 30;

// Muss dem config.js-Fallback von VOICE_CAP_RATE_CENTS_PER_MIN (EUR-Cent/min) entsprechen: die
// Gegenprobe setzt KEINEN Kurs-Override, der Server leitet die Plan-Decken also mit genau
// diesem Fallback ab. 6 = auf die naechste Ganzzahl aufgerundete 5,4 ct/min (Muster env-docs).
const VOICE_CAP_RATE_CENTS_PER_MIN_FALLBACK = 6;

test("T-P2-06: NaN-Budget (MAX_BUDGET_EUR=acht) -> Boot verweigert (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({ env: { MAX_BUDGET_EUR: "acht" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /\[boot\] Start abgebrochen/);
  assert.match(output, /MAX_BUDGET_EUR/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("T-P2-07: fehlender TWILIO_AUTH_TOKEN -> Boot verweigert (exit 1), nennt Var", async () => {
  const { code, output } = await startServerExpectExit({ env: { TWILIO_AUTH_TOKEN: "" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /TWILIO_AUTH_TOKEN/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("Boot-Guard: keine aktive Nummer im Store -> Boot verweigert (exit 1), nennt CLI", async () => {
  // ownerNumber: null -> Spawn-Store OHNE aktive Nummer (Opt-out vom Auto-Seed der
  // Helper). Config ist gueltig -> der Refusal faellt NICHT in assertConfig, sondern in
  // den tenant-agnostischen Nummer-Boot-Guard (P2b, Ersatz fuer die TWILIO_NUMBER-Pflicht).
  const { code, output } = await startServerExpectExit({ ownerNumber: null });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /Keine aktive Nummer im Store/);
  assert.match(output, /bootstrap-tenant/, "verweist actionable aufs Bootstrap-CLI");
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("T-P2-08: vollstaendige Config bootet -> GET /healthz 200 (kein Fehl-Refusal)", async () => {
  // LCT P6: kein MAX_BUDGET_EUR-Override mehr hier - BASE_ENV traegt bereits 30 (musste
  // damals mit der alten BASE_ENV=8 uebereinstimmen, ist seit P6 redundant).
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

// ---- P3 (Boot-Guards Konfig-Kohaerenz/Modellpreise) -------------------------------

// T-P3-10: MAX_BUDGET_EUR=30 (BASE_ENV, LCT P6) -> platformSpendCapCents=3000. Eine
// Tenant-Default-Decke >= 3000 ist die Tenant-Achse inert (Klausel A) - echter
// Schutzverlust. Rot vor dem P3-Fix: damals bootete diese Konstellation durch (kein
// Kohaerenz-Guard existierte).
test("T-P3-10: DEFAULT_TENANT_BUDGET_CENTS=5000 gegen MAX_BUDGET_EUR=30 -> Boot verweigert (exit 1)", async () => {
  const { code, output } = await startServerExpectExit({
    env: { DEFAULT_TENANT_BUDGET_CENTS: "5000" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /Start abgebrochen/);
  assert.match(output, /DEFAULT_TENANT_BUDGET_CENTS/);
  assert.match(output, /MAX_BUDGET_EUR/);
  assert.match(output, /5000/);
  assert.match(output, /3000/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

// T-P3-11 (Merge-Gate): die in BASE_ENV gepinnten Werte (MAX_BUDGET_EUR=30 seit LCT P6,
// DEFAULT_TENANT_BUDGET_CENTS=0, VOICE_TARIFF_DEFAULT_CENTS=0, CLAUDE_MODEL/
// PRECALL_BRIEFING_MODEL beide bepreist) muessen weiterhin gruen booten - byte-identisch
// bis auf die eine A0-Konfig-Warnung (Sentinel 0 ist dokumentiertes Bestandsverhalten)
// plus die seit P8 unbedingte Deckungs-WARN (0 Calls -> 0% < 80%); die A0-Zeile bleibt
// die einzige `DEFAULT_TENANT_BUDGET_CENTS=0`-Warnung.
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

// T-P3-12: die AUSGELIEFERTE Beispiel-Konfiguration (.env.example/render.yaml nach der
// P3-Korrektur: DEFAULT_TENANT_BUDGET_CENTS=600, VOICE_TARIFF_DEFAULT_CENTS=300) bootet
// gruen, feuert aber die Klausel-B-Warnung inkl. Audit-Zeile (600 < 300*5=1500).
test("T-P3-12: ausgelieferte Beispiel-Konfig (600/300) bootet gruen, Klausel-B-Warnung + Audit", async () => {
  const srv = await startServer({
    env: { DEFAULT_TENANT_BUDGET_CENTS: "600", VOICE_TARIFF_DEFAULT_CENTS: "300" },
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.match(srv.stdout, /\[boot\] Konfig-Warnung: .*max_duration_s=120/);
    assert.match(srv.stdout, /\[audit\] boot_konfig_warnung ip=system grund=worst_case_unaffordable/);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
    assert.doesNotMatch(srv.stdout, /DEFAULT_TENANT_BUDGET_CENTS=0/);
  } finally {
    await srv.stop();
  }
});

// T-P3-13 (Review-Fix Runde 1, Merge-Gate; LCT P6 GEDREHT): ECHTER Spawn OHNE jeden
// Override fuer DEFAULT_TENANT_BUDGET_CENTS/MAX_BUDGET_EUR - der numEnv-CODE-FALLBACK
// greift also exakt wie auf einem Host, der beide Vars nie setzt. `undefined` in env
// ueberschreibt den BASE_ENV-Pin auf dieselbe Var und wird von child_process.spawn aus der
// Kind-Env entfernt (nicht als String "undefined" gesetzt) - process.env sieht die Var
// damit als echt ABWESEND, genau wie ein Host ohne diese Env-Zeilen.
//
// P7 hat den Fallback angehoben (MAX_BUDGET_EUR 8->30, DEFAULT_TENANT_BUDGET_CENTS
// 600->1500) - genau die Folge-Phase, auf die der P6-Stand hier verwies. Der reine
// CODE-Fallback ist damit auf BEIDEN Achsen kohaerent: die abgeleitete Business-Decke
// (900 ct) liegt unter platformSpendCapCents=3000 (kein plan_cap_inert) UND die
// Tenant-Decke traegt die Worst-Case-Reserve (kein worst_case_unaffordable, seit P7 fatal).
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

// (j1, LCT P6) Erste Linie, fatal am Boot OHNE jede tenant_budget-Zeile (frischer Deploy,
// erster Kunde noch nicht da) - explizit ueber MAX_BUDGET_EUR statt ueber den CODE-Fallback
// (Gegenstueck zu T-P3-13, hier via Env statt via Abwesenheit). Gegenprobe: MAX_BUDGET_EUR=30
// (BASE_ENV-Wert) bootet gruen, kein Fatal.
test("LCT P6 (j1): MAX_BUDGET_EUR=8 -> plan_cap_inert (business), Boot verweigert (exit 1)", async () => {
  const { code, output } = await startServerExpectExit({ env: { MAX_BUDGET_EUR: "8" } });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /Start abgebrochen/);
  assert.match(output, /business/);
  assert.match(output, /800/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

test("LCT P6 (j1 Gegenprobe): MAX_BUDGET_EUR=30 bootet gruen (kein plan_cap_inert)", async () => {
  const srv = await startServer({ env: { MAX_BUDGET_EUR: String(GEGENPROBE_BUDGET_EUR) } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
  } finally {
    await srv.stop();
  }
  // Echte Kohaerenz-Pruefung statt toter stdout-Regex: boot.js druckt finding.message, NIE
  // finding.code 'plan_cap_inert' - eine /plan_cap_inert/-Assertion gegen stdout war fuer jedes
  // Ergebnis wahr und pruefte nichts. Direkt gegen den Guard (Muster env-docs): bei
  // MAX_BUDGET_EUR=30 liegt die hoechste abgeleitete Plan-Decke (business=900 ct) unter
  // platformSpendCapCents=3000 -> planCapInertFindings ist leer, GENAU das laesst den Boot
  // oben gruen durchlaufen.
  const inertFindings = planCapInertFindings({
    slugs: CATALOG_SLUGS,
    platformCapCents: eurToCents(GEGENPROBE_BUDGET_EUR),
    capForSlug: (slug) => planCapCents(slug, { voiceCapRateCentsPerMin: VOICE_CAP_RATE_CENTS_PER_MIN_FALLBACK }),
  });
  assert.deepEqual(
    inertFindings,
    [],
    `MAX_BUDGET_EUR=${GEGENPROBE_BUDGET_EUR} muss kohaerent sein (kein plan_cap_inert): ${JSON.stringify(inertFindings)}`,
  );
});
