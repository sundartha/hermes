import { test } from "node:test";
import assert from "node:assert/strict";

import { planCapReserveFindings, PLAN_CAP_FINDING } from "../src/boot-guard.js";
import { planCapCents } from "../src/billing/plan-caps.js";
import { CATALOG_SLUGS } from "../src/plans.js";
import { RESERVE_LEAD_MINUTES } from "../src/store/defaults.js";

const BOOKING_RATES_CENTS_PER_MIN = Object.freeze([0, 30, 300]);

const STUB_SMALLEST_CAP_CENTS = 300;
const STUB_LARGER_CAP_CENTS = 900;
const STUB_TARIFF_CENTS = 400;
const STUB_RESERVE_CENTS = STUB_TARIFF_CENTS * RESERVE_LEAD_MINUTES;

const BOUNDARY_TARIFF_CENTS = 10;
const BOUNDARY_RESERVE_CENTS = BOUNDARY_TARIFF_CENTS * RESERVE_LEAD_MINUTES;

const SLUG_WITHOUT_HEADROOM = "enterprise";

function capForSlugThatThrows(caps) {
  return (slug) => {
    if (!Object.hasOwn(caps, slug)) {
      throw new Error(`planCapCents: unbekannter Plan-Slug '${slug}'`);
    }
    return caps[slug];
  };
}

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
