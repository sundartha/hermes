// P2/OT-4 AC4: Der Boot EHRT das assertConfig-Ergebnis. Bei ungueltiger Safety-/
// Pflicht-Config startet der Dienst GAR NICHT (kein app.listen, kein /voice, kein
// /mcp) - er verweigert mit klarer Diagnose und exit(1). Lieber kein Dienst als ein
// Dienst ohne Gates (fail-closed). Kindprozess-Tests: Exit-Code + stderr/stdout.
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

// C-P5: die Boot-Pflicht auf TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN ist gefallen (kein
// Codepfad liest sie seit C-P4). Leer GESETZT, nicht bloss ungesetzt: dotenv fuellt nur
// ungesetzte Variablen - eine lokale .env wuerde sie sonst still nachliefern.
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

// Uebergangszustand: Render traegt die Keys noch. Ein gesetzter, ungelesener Key MUSS
// harmlos bleiben - sonst legt der naechste Neustart den Live-Dienst still.
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

// OUT-05-EL (Owner-Auftrag 15.08.2026, Aufgabe 1): dasselbe Boot-Refusal-Muster fuer den
// EL-Anrufstart-Gegenstueck von FAKE_ORIGINATE.
test("OUT-05-EL: FAKE_ORIGINATE_ELEVENLABS=true ohne SKIP_TWILIO_SIGNATURE_CHECK -> Boot verweigert (exit 1)", async () => {
  const { code, output } = await startServerExpectExit({
    env: { FAKE_ORIGINATE_ELEVENLABS: "true", SKIP_TWILIO_SIGNATURE_CHECK: "false" },
  });
  assert.equal(code, 1, `erwartet exit 1, Output:\n${output}`);
  assert.match(output, /FAKE_ORIGINATE_ELEVENLABS/);
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
});

// ---- P3 (Boot-Guards Konfig-Kohaerenz/Modellpreise) -------------------------------

// KS-P9/E10 (frueher T-P3-10, GEDREHT): eine Tenant-Default-Decke UEBER der Plattform-Zahl
// war Klausel A und damit fatal ("Tenant-Achse inert"). Ohne Sperrwirkung der Plattform-Achse
// ist sie nur noch eine grosszuegige Tenant-Decke - der Boot muss durchlaufen.
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

// T-P3-11 (Merge-Gate): die in BASE_ENV gepinnten Werte (MAX_BUDGET_EUR=30 seit LCT P6,
// DEFAULT_TENANT_BUDGET_CENTS=0, VOICE_TARIFF_DEFAULT_CENTS=0, CLAUDE_MODEL/
// PRECALL_BRIEFING_MODEL beide bepreist) muessen weiterhin gruen booten - byte-identisch
// bis auf die eine A0-Konfig-Warnung (Sentinel 0 ist dokumentiertes Bestandsverhalten)
// plus die seit P8 unbedingte Deckungs-WARN (0 Calls -> 0% < 80%); die A0-Zeile bleibt
// die einzige `DEFAULT_TENANT_BUDGET_CENTS=0`-Warnung.
//
// Seit B4a ist dieser Test zugleich die GEGENPROBE zum Boot-Abbruch (B4A-BOOT-1..3): ohne
// ihn belegten jene Tests nur, dass der Server ueberhaupt nie startet.
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

// T-P3-12 (P7/GAP-32 GEDREHT): eine Konfiguration, unter der die Tenant-Decke nicht einmal
// die Vorab-Reserve EINES Anrufs traegt, bootete bis P6 mit einer folgenlosen
// Klausel-B-Warnung durch - waehrend der Dienst fuer jedes Ziel ohne gemessenen
// Inlandssatz faktisch abgeschaltet war. Seit dem Flip bricht genau das den Start ab. Das
// ist zugleich der Beweis, dass der Flip greift: ein Boot mit absichtlich inkohaerenten
// Werten startet nicht.
//
// KS-P3 (a): die Reserve ist Satz * 2 Vorlauf-Minuten (nicht mehr Satz * angefangene
// Minuten der Maximaldauer). Die frueheren Testwerte 600/300 sind damit KOHAERENT
// geworden (300*2 = 600, kein Ueberschuss) - die Werte wandern auf 500/300 (Reserve 600 >
// Decke 500), die Aussage des Tests bleibt Wort fuer Wort dieselbe.
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

// T-P3-13 (Review-Fix Runde 1, Merge-Gate; LCT P6 GEDREHT): ECHTER Spawn OHNE jeden
// Override fuer DEFAULT_TENANT_BUDGET_CENTS/MAX_BUDGET_EUR - der numEnv-CODE-FALLBACK
// greift also exakt wie auf einem Host, der beide Vars nie setzt. `undefined` in env
// ueberschreibt den BASE_ENV-Pin auf dieselbe Var und wird von child_process.spawn aus der
// Kind-Env entfernt (nicht als String "undefined" gesetzt) - process.env sieht die Var
// damit als echt ABWESEND, genau wie ein Host ohne diese Env-Zeilen.
//
// P7 hat den Fallback angehoben (MAX_BUDGET_EUR 8->30, DEFAULT_TENANT_BUDGET_CENTS
// 600->1500) - genau die Folge-Phase, auf die der P6-Stand hier verwies. Der reine
// CODE-Fallback traegt damit die Worst-Case-Reserve unter der Tenant-Decke (kein
// worst_case_unaffordable, seit P7 fatal). Die frueher hier mitgepruefte zweite Achse
// (abgeleitete Plan-Decke gegen die Plattform-Zahl) ist mit KS-P9/E10 entfallen.
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

// KS-P9/E10 (frueher LCT P6 (j1), GEDREHT): eine abgeleitete Plan-Decke UEBER der
// Plattform-Zahl war `plan_cap_inert` und riss den Boot ab (MAX_BUDGET_EUR=8 gegen
// business=900 ct). Seit KS-P9 ist MAX_BUDGET_EUR nur noch Warnschwelle - derselbe Vektor
// muss gruen booten. Was FATAL bleibt, prueft der zweite Teil: ein Katalog-Slug ohne
// ableitbare Decke (planCapUnderivableFindings) - hier direkt gegen den Guard, weil boot.js
// finding.message druckt, nie finding.code.
test("KS-P9: MAX_BUDGET_EUR=8 unter der Business-Plan-Decke bootet gruen (kein plan_cap_inert mehr)", async () => {
  const srv = await startServer({ env: { MAX_BUDGET_EUR: "8" } });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
  } finally {
    await srv.stop();
  }
  // Gegenprobe am verbliebenen Guard: JEDE Katalog-Decke bleibt ableitbar - genau das
  // laesst den Boot oben durchlaufen (und ein fehlender Kopffreiheit-Eintrag waere weiter
  // fatal, s. test/plan-cap-unclamped.test.js (j4)).
  assert.deepEqual(
    planCapUnderivableFindings({
      slugs: CATALOG_SLUGS,
      // KS-P5a: die Decke folgt dem BUCHUNGSSATZ. Der Wert kommt aus DERSELBEN Quelle, mit
      // der der Spawn-Server oben bootet (BASE_ENV), statt aus einer handgepflegten
      // Spiegelzahl (G5/G25) - sonst prueft die Gegenprobe eine andere Konfiguration als
      // der gemessene Boot.
      capForSlug: (slug) => planCapCents(slug, { voiceTariffDefaultCents: Number(BASE_ENV.VOICE_TARIFF_DEFAULT_CENTS) }),
    }),
    [],
  );
});

// KS-P3a: die neue Boot-Linie (kleinste Plan-Decke gegen die Worst-Case-Reserve) laeuft mit
// dem LIVE-Satz. Die uebrige Spawn-Suite faehrt VOICE_TARIFF_DEFAULT_CENTS=0 (Decken 0,
// Reserve 0) - dort waere der Guard trivial still. Bei 30 ct/min sind die Decken 1500/4500
// und die Reserve seit KS-P3 (a) 30*2=60: kohaerent, also gruener Boot. Der feuernde Zweig
// ist ueber Env NICHT erreichbar (RESERVE_LEAD_MINUTES ist eine Code-Konstante, der Satz
// kuerzt sich aus der Ungleichung heraus) - er ist in
// test/ks-p3a-plan-cap-reserve-guard.test.js abgedeckt.
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

// ---- B4a: Boot-Abbruch bei unbepreistem Modell (und seine Nicht-Ausloeser) -----------
//
// Ein Dienst, der nicht startet, nimmt keine Anrufe an. Die Ausloeser-Liste ist deshalb
// ABSCHLIESSEND: genau die zwei konfigurierten Modelle (claudeModel, briefingModel). Jeder
// benannte NICHT-Ausloeser bekommt hier seinen eigenen Beleg - sonst weitet der naechste
// Umbau den Abbruch still aus. Die Gegenprobe "ohne die Fehlkonfiguration startet der
// Dienst" liefert T-P3-11 oben plus B4A-BOOT-5 unten.
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
    // Banner-Zeile im Stil ihrer Nachbarn (eingerueckt, ohne [boot]-Praefix - die Praefixe
    // tragen nur die Guard-Meldungen davor).
    assert.match(
      srv.stdout,
      /^ {2}Preisstaffeln: claude-haiku-4-5 ab \d{4}-\d{2}-\d{2} \(naechste: .+\) \| claude-sonnet-5 ab \d{4}-\d{2}-\d{2}/m,
      "welche Staffel dieser PROZESS faehrt, muss am Log ablesbar sein",
    );
  } finally {
    await srv.stop();
  }
});
