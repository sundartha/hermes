// KS-P3a: die Worst-Case-Reserve EINES Anrufs muss unter die KLEINSTE Plan-Decke passen -
// sonst faellt ein Tenant mit diesem Plan schon beim ERSTEN Anruf ins Reserve-Gate (402).
// Seit KS-P5a kuerzt sich der Satz aus der Ungleichung heraus (Decke und Reserve skalieren
// beide mit voiceTariffDefaultCents). Seit KS-P3 (a) faellt zusaetzlich die Gespraechsdauer
// heraus: die Reserve deckt ein festes Vorlauffenster (RESERVE_LEAD_MINUTES). Geprueft wird
// damit die Katalog-Kopffreiheit gegen dieses Fenster - unabhaengig davon, wie lange ein
// Gespraech dauern darf.
//
// Reine, arg-injizierte Wahrheitstabelle (Muster test/spend-cap-coherence.test.js): kein
// Spawn, kein pglite, KEINE process.env-Manipulation - damit immun gegen eine lokale .env
// und gegen jede kuenftige BASE_ENV-Drift.
//
// Die Testnamen tragen BEWUSST keinen i18n-Katalog-Praefix: dies ist Regressionsschutz und
// gehoert in `npm test`, wo Rot etwas heisst - nicht in `test:gates`, wo Rot erlaubt ist.
import { test } from "node:test";
import assert from "node:assert/strict";

import { planCapReserveFindings, PLAN_CAP_FINDING } from "../src/boot-guard.js";
import { planCapCents } from "../src/billing/plan-caps.js";
import { CATALOG_SLUGS } from "../src/plans.js";
import { RESERVE_LEAD_MINUTES } from "../src/store/defaults.js";

// Drei Saetze, unter denen der Dienst real starten koennen muss: 0 = der Pin der Testsuite
// (BASE_ENV), 30 = der heute ausgelieferte Live-Satz, 300 = der Stand davor. Die Invariante
// ist satzunabhaengig - eine Decke, die nur bei einem Satz traegt, ist keine.
const BOOKING_RATES_CENTS_PER_MIN = Object.freeze([0, 30, 300]);

// Stub-Decken der Wahrheitstabelle (b): der kleinere Wert ist der, den die Meldung nennen
// MUSS, der groessere der, den sie NICHT nennen darf.
// KS-P3 (a): die Reserve ist Satz * RESERVE_LEAD_MINUTES - die Gespraechsdauer geht nicht
// mehr ein. Die Stub-Zahlen werden aus der Konstanten HERGELEITET statt gepinnt, damit eine
// kuenftige Kalibrierung des Vorlauffensters diesen Test nicht falsch-rot faerbt.
const STUB_SMALLEST_CAP_CENTS = 300;
const STUB_LARGER_CAP_CENTS = 900;
const STUB_TARIFF_CENTS = 400; // -> Reserve 400 * 2 = 800 ct > kleinste Stub-Decke 300 ct
const STUB_RESERVE_CENTS = STUB_TARIFF_CENTS * RESERVE_LEAD_MINUTES;

// Grenzfall (c): 10 ct/min * 2 = 20 ct Reserve.
const BOUNDARY_TARIFF_CENTS = 10;
const BOUNDARY_RESERVE_CENTS = BOUNDARY_TARIFF_CENTS * RESERVE_LEAD_MINUTES;

// Ein Slug ohne Kopffreiheit-Eintrag - planCapCents wirft dafuer (fail-closed).
const SLUG_WITHOUT_HEADROOM = "enterprise";

// Bildet den Wurf von planCapCents nach, ohne die echte config/plan-caps zu koppeln: der
// Guard soll JEDEN Wurf des injizierten capForSlug fangen, unabhaengig von der Ursache
// (Parity zu test/plan-cap-unclamped.test.js (j4)).
function capForSlugThatThrows(caps) {
  return (slug) => {
    if (!Object.hasOwn(caps, slug)) {
      throw new Error(`planCapCents: unbekannter Plan-Slug '${slug}'`);
    }
    return caps[slug];
  };
}

// ---- (a) Gegenprobe mit den ECHTEN Boot-Eingaben --------------------------------------
test("KS-P3a: der ausgelieferte Katalog traegt die Worst-Case-Reserve - bei jedem Satz", () => {
  for (const rate of BOOKING_RATES_CENTS_PER_MIN) {
    assert.deepEqual(
      planCapReserveFindings({
        slugs: CATALOG_SLUGS,
        capForSlug: (slug) => planCapCents(slug, { voiceTariffDefaultCents: rate }),
        maxTariffCents: rate,
      }),
      [],
      `Satz ${rate} ct/min: der ausgelieferte Katalog muss die Worst-Case-Reserve tragen`,
    );
  }
});

// ---- (b) der feuernde Zweig ------------------------------------------------------------
test("KS-P3a: Reserve ueber der kleinsten Plan-Decke -> genau ein FATAL, nennt Slug und Zielgroessen", () => {
  const findings = planCapReserveFindings({
    slugs: CATALOG_SLUGS,
    capForSlug: capForSlugThatThrows({ starter: STUB_SMALLEST_CAP_CENTS, business: STUB_LARGER_CAP_CENTS }),
    maxTariffCents: STUB_TARIFF_CENTS,
  });
  assert.equal(findings.length, 1, `genau EIN Finding erwartet, war: ${JSON.stringify(findings)}`);
  assert.equal(findings[0].fatal, true);
  assert.equal(findings[0].code, PLAN_CAP_FINDING.PLAN_CAP_WORST_CASE_UNAFFORDABLE);
  assert.match(findings[0].message, /starter/, "nennt den Slug mit der kleinsten Decke");
  assert.match(findings[0].message, new RegExp(String(STUB_RESERVE_CENTS)), "nennt die Reserve");
  assert.doesNotMatch(
    findings[0].message,
    /business/,
    "nur das Minimum gehoert in die Meldung - der groessere Plan ist nicht der Engpass",
  );
});

// ---- (c) die Grenze: > statt >= --------------------------------------------------------
test("KS-P3a: Gleichstand ist kohaerent, ein Cent darueber nicht (Grenze)", () => {
  const atBoundary = planCapReserveFindings({
    slugs: ["starter"],
    capForSlug: capForSlugThatThrows({ starter: BOUNDARY_RESERVE_CENTS }),
    maxTariffCents: BOUNDARY_TARIFF_CENTS,
  });
  assert.deepEqual(atBoundary, [], "Reserve === Decke ist exakt bezahlbar, also kein Befund");

  const oneCentOver = planCapReserveFindings({
    slugs: ["starter"],
    capForSlug: capForSlugThatThrows({ starter: BOUNDARY_RESERVE_CENTS - 1 }),
    maxTariffCents: BOUNDARY_TARIFF_CENTS,
  });
  assert.equal(oneCentOver.length, 1, "ein Cent unter der Reserve -> FATAL");
  assert.equal(oneCentOver[0].fatal, true);
  assert.equal(oneCentOver[0].code, PLAN_CAP_FINDING.PLAN_CAP_WORST_CASE_UNAFFORDABLE);
});

// ---- (d) werfender capForSlug: wird uebersprungen, der Guard wirft NIE -----------------
test("KS-P3a: werfender capForSlug -> Slug wird uebersprungen, KEIN Wurf, uebrige Decken geprueft", () => {
  const slugs = ["starter", SLUG_WITHOUT_HEADROOM];

  let green;
  assert.doesNotThrow(() => {
    green = planCapReserveFindings({
      slugs,
      capForSlug: capForSlugThatThrows({ starter: BOUNDARY_RESERVE_CENTS }),
      maxTariffCents: BOUNDARY_TARIFF_CENTS,
    });
  });
  assert.deepEqual(green, [], "die ableitbare Starter-Decke traegt die Reserve");

  let red;
  assert.doesNotThrow(() => {
    red = planCapReserveFindings({
      slugs,
      capForSlug: capForSlugThatThrows({ starter: BOUNDARY_RESERVE_CENTS - 1 }),
      maxTariffCents: BOUNDARY_TARIFF_CENTS,
    });
  });
  assert.equal(red.length, 1, "die ableitbare Starter-Decke wird trotz des Wurfs geprueft");
  assert.match(red[0].message, /starter/);
  assert.doesNotMatch(
    red[0].message,
    new RegExp(SLUG_WITHOUT_HEADROOM),
    "der nicht ableitbare Slug gehoert planCapUnderivableFindings, nicht diesem Guard",
  );
});

// ---- (e) keine ableitbare Decke -> [] (kein zweiter Befund zur selben Sache) -----------
test("KS-P3a: keine ableitbare Decke -> [] (der Befund gehoert planCapUnderivableFindings)", () => {
  assert.deepEqual(
    planCapReserveFindings({
      slugs: [],
      capForSlug: capForSlugThatThrows({}),
      maxTariffCents: STUB_TARIFF_CENTS,
    }),
    [],
    "leere Slug-Menge: nichts zu pruefen (und kein reduce-auf-leer-Absturz)",
  );
  assert.deepEqual(
    planCapReserveFindings({
      slugs: [SLUG_WITHOUT_HEADROOM],
      capForSlug: capForSlugThatThrows({}),
      maxTariffCents: STUB_TARIFF_CENTS,
    }),
    [],
    "alle Decken unableitbar: der FATAL dazu kommt von planCapUnderivableFindings",
  );
});
