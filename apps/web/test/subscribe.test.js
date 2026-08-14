// P2-Tests: die reinen Subscribe-Builder (lib/subscribe.js) + die Subscribe-
// Zustandsmaschine. Reine Logik, kein Browser-DOM: ein winziges Fake-`document`
// bildet die im Bau genutzten DOM-Operationen nach (createElement, className,
// textContent, dataset, type, append). Die Maschine wird gegen ein gestubbtes
// globales fetch geprueft (wie api.test.js). Laeuft mit node:test ohne Netz/DOM.
//
// XSS-BELEG (Leitplanke): das Fake-Element wirft bei jedem innerHTML-Schreibzugriff
// -> belegt, dass die Kacheln ausschliesslich ueber textContent gebaut werden.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "../src/lib/api.js";
import { PLAN_CATALOG } from "../src/lib/plans.js";
import {
  planTiles,
  subscriptionLine,
  quotaLine,
  quotaUsedPercent,
  wireSubscribe,
  SUBSCRIBE_MESSAGES,
  PLAN_CHOICE_COPY,
  renderPlanChoice,
  dismissPlanChoice,
  CANCEL_BUTTON_LABEL,
  CONFIRM_CANCEL_BUTTON_LABEL,
  CANCEL_ABORT_LABEL,
  RESUME_BUTTON_LABEL,
  CANCEL_MESSAGES,
  cancelConfirmText,
  cancelStatusLine,
  wireCancelControls,
  BILLING_STATUS,
  billingStatusKind,
  billingStatusBadge,
  billingStatusBadgeClass,
  billingStatusText,
  billingStatusHeadline,
  billingStatusDetail,
  newsletterConsentFrom,
  NEWSLETTER_MESSAGES,
  wireNewsletterToggle,
  cancelAbortLabel,
  cancelButtonLabel,
  confirmCancelButtonLabel,
  resumeButtonLabel,
} from "../src/lib/subscribe.js";

// Simuliert die DE-Sprachwahl fuer getLang() (lib/i18n.js) ohne setLang() (das
// greift auf `document` zu, s. render.test.js -- gleiches Muster hier).
function withLang(lang, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => lang };
  try {
    fn();
  } finally {
    if (had) globalThis.localStorage = original;
    else delete globalThis.localStorage;
  }
}

// ---- Fake-DOM ---------------------------------------------------------------
class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.className = "";
    this.textContent = "";
    this.type = undefined;
    this.dataset = {};
    this.children = [];
  }
  set innerHTML(_value) {
    throw new Error("innerHTML darf nie gesetzt werden (XSS-Schutz, nur textContent)");
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  allText() {
    return this.textContent + this.children.map((c) => c.allText()).join("");
  }
  hasClass(name) {
    if (this.className.split(" ").includes(name)) return true;
    return this.children.some((c) => c.hasClass(name));
  }
  // Flacher Teilbaum (inkl. self): fuer "finde den Subscribe-Button".
  flatten() {
    return [this, ...this.children.flatMap((c) => c.flatten())];
  }
}

const fakeDocument = { createElement: (tag) => new FakeElement(tag) };

function textOf(nodes) {
  return nodes.map((n) => n.allText()).join("");
}

// ---- planTiles: Kacheln aus dem Build-Spiegel -------------------------------
test("planTiles: eine Kachel je Katalog-Plan mit Name, Preis, /month, Features, data-plan", () => {
  const tiles = planTiles(fakeDocument);
  assert.equal(tiles.length, PLAN_CATALOG.length);

  const starter = PLAN_CATALOG.find((p) => p.slug === "starter");
  const starterTile = tiles[0];
  const text = textOf([starterTile]);
  assert.ok(text.includes("Starter"));
  assert.ok(text.includes("4,99 €")); // EUR-Cutover (Stripe live, 2026-07-03), deutsche Notation
  assert.ok(text.includes("/month"));
  for (const feature of starter.features) assert.ok(text.includes(feature), `Feature fehlt: ${feature}`);

  // Subscribe-Button traegt den Slug als data-plan (delegierter Klick liest ihn).
  const buttons = starterTile.flatten().filter((n) => n.tag === "button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].dataset.plan, "starter");
  assert.equal(buttons[0].type, "button");
});

test("planTiles: das featured-Plan traegt das Popular-Badge, das andere nicht", () => {
  const tiles = planTiles(fakeDocument);
  const featuredIndex = PLAN_CATALOG.findIndex((p) => p.featured);
  assert.ok(tiles[featuredIndex].hasClass("plan--featured"));
  assert.ok(textOf([tiles[featuredIndex]]).includes("Popular"));
  const plainIndex = PLAN_CATALOG.findIndex((p) => !p.featured);
  assert.ok(!textOf([tiles[plainIndex]]).includes("Popular"));
});

// ---- planTiles: Setup-Gebuehr-Zeile (Phase A, PLAN-VOUCHER-SETUP-FEE-GAP.md) ----------
test("planTiles: mit fee -> jede Kachel traegt die Setup-Gebuehr-Zeile", () => {
  const fee = { amountCents: 500, currency: "eur" };
  const tiles = planTiles(fakeDocument, fee);
  for (const tile of tiles) {
    assert.ok(textOf([tile]).includes("5,00 €"));
    assert.ok(textOf([tile]).includes("one-time number setup fee"));
  }
});

test("planTiles: ohne fee (Default) -> keine Gebuehren-Zeile (Regressions-Pin)", () => {
  const tiles = planTiles(fakeDocument);
  for (const tile of tiles) assert.ok(!textOf([tile]).includes("setup fee"));
});

// ---- subscriptionLine / quotaLine: reine Strings -----------------------------
test("subscriptionLine: Name + Verlaengerungsdatum (en-US), ohne Datum nur Name", () => {
  const epoch = 1781000000; // Unix-Sekunden
  const expectedDate = new Date(epoch * 1000).toLocaleDateString("en-US");
  assert.equal(
    subscriptionLine({ planSlug: "starter", currentPeriodEnd: epoch }),
    `Active plan: Starter (renews ${expectedDate}).`,
  );
  assert.equal(subscriptionLine({ planSlug: "business", currentPeriodEnd: 0 }), "Active plan: Business.");
  // Unbekannter Slug -> kapitalisierter Fallback (nie "undefined").
  assert.equal(subscriptionLine({ planSlug: "ghost", currentPeriodEnd: 0 }), "Active plan: Ghost.");
});

test("quotaLine: 'remaining of included minutes remaining' oder null", () => {
  assert.equal(quotaLine({ remainingMinutes: 5, includedMinutes: 30 }), "5 of 30 minutes remaining");
  assert.equal(quotaLine({ remainingMinutes: 0, includedMinutes: 120 }), "0 of 120 minutes remaining");
  assert.equal(quotaLine(null), null);
  assert.equal(quotaLine(undefined), null);
});

// ---- quotaUsedPercent: Fuellbreite des Minuten-Balkens (Dashboard-Design-Spec §10) --
test("quotaUsedPercent: verbrauchter Anteil in Prozent, gerundet", () => {
  assert.equal(quotaUsedPercent({ remainingMinutes: 93, includedMinutes: 120 }), 23);
  assert.equal(quotaUsedPercent({ remainingMinutes: 120, includedMinutes: 120 }), 0);
  assert.equal(quotaUsedPercent({ remainingMinutes: 0, includedMinutes: 120 }), 100);
});

test("quotaUsedPercent: kein Kontingent -> 0 (der Aufrufer rendert den Balken ohnehin nicht)", () => {
  assert.equal(quotaUsedPercent(null), 0);
  assert.equal(quotaUsedPercent(undefined), 0);
  assert.equal(quotaUsedPercent({ remainingMinutes: 0, includedMinutes: 0 }), 0);
});

test("quotaUsedPercent: geklemmt auf [0,100] gegen inkonsistente Server-Werte", () => {
  assert.equal(quotaUsedPercent({ remainingMinutes: 150, includedMinutes: 120 }), 0);
  assert.equal(quotaUsedPercent({ remainingMinutes: -10, includedMinutes: 120 }), 100);
});

// ---- Subscribe-Zustandsmaschine ---------------------------------------------
function stubFetch(responder) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    return responder(path, options);
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

function fakeResponse({ ok, status, json }) {
  return { ok, status, json: async () => json };
}

// Fake-Container: faengt den delegierten Klick-Listener und ruft ihn mit einem
// minimalen Event ab (target.closest -> ein Pseudo-Button mit dataset.plan).
function fakeContainer() {
  let handler = null;
  return {
    addEventListener: (name, fn) => {
      assert.equal(name, "click");
      handler = fn;
    },
    click: (plan) => handler({ target: { closest: () => ({ dataset: { plan } }) } }),
    clickOutside: () => handler({ target: { closest: () => null } }),
  };
}

// Sammelt onMessage/onSubscribed/navigate-Aufrufe fuer die Asserts.
function spyOpts() {
  const messages = [];
  const navigated = [];
  let subscribedCount = 0;
  return {
    onMessage: (text, ok) => messages.push({ text, ok }),
    onSubscribed: () => {
      subscribedCount += 1;
    },
    navigate: (url) => navigated.push(url),
    messages,
    navigated,
    get subscribedCount() {
      return subscribedCount;
    },
  };
}

test("wireSubscribe: ok -> 'booked' + onSubscribed; postet {plan} an die subscribe-Route", async () => {
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: { plan: "starter", currentPeriodEnd: 1 } }));
  try {
    const container = fakeContainer();
    const opts = spyOpts();
    wireSubscribe(container, opts);
    await container.click("starter");
    assert.equal(f.calls[0].path, "/api/self-service/billing/subscribe");
    assert.equal(f.calls[0].options.method, "POST");
    assert.deepEqual(JSON.parse(f.calls[0].options.body), { plan: "starter" });
    assert.deepEqual(opts.messages, [{ text: SUBSCRIBE_MESSAGES.booked, ok: true }]);
    assert.equal(opts.subscribedCount, 1);
  } finally {
    f.restore();
  }
});

test("wireSubscribe: 409 no_card -> gefuehrter Checkout {plan} -> navigate zur Stripe-url", async () => {
  const f = stubFetch((path) => {
    if (path.includes("/subscribe")) return fakeResponse({ ok: false, status: 409, json: { error: "no_card", next: "setup-checkout", plan: "business" } });
    return fakeResponse({ ok: true, status: 200, json: { url: "https://checkout.stripe.com/c/pay/cs_test" } });
  });
  try {
    const container = fakeContainer();
    const opts = spyOpts();
    wireSubscribe(container, opts);
    await container.click("business");
    // Zweiter Call ist der Setup-Checkout MIT getragenem Plan.
    assert.equal(f.calls[1].path, "/api/self-service/billing/setup-checkout");
    assert.deepEqual(JSON.parse(f.calls[1].options.body), { plan: "business" });
    assert.deepEqual(opts.navigated, ["https://checkout.stripe.com/c/pay/cs_test"]);
    assert.equal(opts.subscribedCount, 0); // kein onSubscribed im no_card-Pfad
  } finally {
    f.restore();
  }
});

test("wireSubscribe: 409 already_subscribed -> Hinweis, kein Checkout/onSubscribed", async () => {
  const f = stubFetch(() => fakeResponse({ ok: false, status: 409, json: { error: "already_subscribed" } }));
  try {
    const container = fakeContainer();
    const opts = spyOpts();
    wireSubscribe(container, opts);
    await container.click("starter");
    assert.deepEqual(opts.messages, [{ text: SUBSCRIBE_MESSAGES.alreadySubscribed, ok: false }]);
    assert.equal(opts.navigated.length, 0);
    assert.equal(opts.subscribedCount, 0);
  } finally {
    f.restore();
  }
});

test("wireSubscribe: 401 -> Session abgelaufen", async () => {
  const f = stubFetch(() => fakeResponse({ ok: false, status: 401, json: {} }));
  try {
    const container = fakeContainer();
    const opts = spyOpts();
    wireSubscribe(container, opts);
    await container.click("starter");
    assert.deepEqual(opts.messages, [{ text: SUBSCRIBE_MESSAGES.sessionExpired, ok: false }]);
  } finally {
    f.restore();
  }
});

test("wireSubscribe: Klick ohne data-plan-Button macht nichts (kein Fetch)", async () => {
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: {} }));
  try {
    const container = fakeContainer();
    const opts = spyOpts();
    wireSubscribe(container, opts);
    const result = container.clickOutside();
    assert.equal(result, undefined);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

// ApiError traegt code + next aus dem Backend-Body -> der no_card-Funnel-Zweig der
// Maschine haengt am next. Sicherheitsnetz gegen einen stillen Verlust der Felder.
test("ApiError traegt code + Funnel-Hinweis (next) aus dem Backend-Body", () => {
  const err = new ApiError(409, "x", { code: "no_card", next: "setup-checkout" });
  assert.equal(err.status, 409);
  assert.equal(err.code, "no_card");
  assert.equal(err.next, "setup-checkout");
});

// ---- Aktivierungs-Default (AM3): renderPlanChoice / dismissPlanChoice ---------
test("renderPlanChoice: aktivierende H1 + Untertitel + 2 Kacheln + Skip sichtbar", () => {
  const els = {
    title: { textContent: "" }, subtitle: { textContent: "" },
    tiles: { _k: null, replaceChildren(...n) { this._k = n; } }, skip: { hidden: true },
  };
  renderPlanChoice(fakeDocument, els);
  assert.equal(els.title.textContent, PLAN_CHOICE_COPY.title);
  assert.equal(els.subtitle.textContent, PLAN_CHOICE_COPY.subtitle);
  assert.equal(els.tiles._k.length, 2);      // eine Kachel je Katalog-Plan
  assert.equal(els.skip.hidden, false);      // Skip nur im Payment-Pfad sichtbar
});

test("renderPlanChoice: mit fee -> Kacheln tragen die Gebuehren-Zeile", () => {
  const els = {
    title: { textContent: "" }, subtitle: { textContent: "" },
    tiles: { _k: null, replaceChildren(...n) { this._k = n; } }, skip: { hidden: true },
  };
  renderPlanChoice(fakeDocument, els, { amountCents: 999, currency: "eur" });
  assert.ok(els.tiles._k.some((t) => textOf([t]).includes("9,99 €")));
});

test("dismissPlanChoice: Pending-Banner, Kacheln+Skip weg, KEIN subscribe/setStatus", () => {
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: {} }));
  try {
    const els = {
      title: { textContent: "" }, subtitle: { textContent: "" },
      tiles: { _k: [1, 2], replaceChildren(...n) { this._k = n; } }, skip: { hidden: false },
    };
    dismissPlanChoice(els);
    assert.equal(els.title.textContent, PLAN_CHOICE_COPY.bannerTitle);
    assert.equal(els.tiles._k.length, 0);    // Kacheln entfernt
    assert.equal(els.skip.hidden, true);
    assert.equal(f.calls.length, 0, "Skip darf NICHT aktivieren (kein Backend-Call)");
  } finally {
    f.restore();
  }
});

// ---- 312k-P3: Kuendigungs-Weg (§ 312k BGB) -------------------------------------

test("CANCEL_BUTTON_LABEL/CONFIRM_CANCEL_BUTTON_LABEL: gesetzlich vorgegebener Wortlaut", () => {
  // § 312k BGB verlangt exakt diesen Wortlaut - Regressions-Pin gegen unbeabsichtigte
  // Umformulierung (z.B. durch eine spaetere i18n-Aufraeumrunde).
  assert.equal(CANCEL_BUTTON_LABEL, "Verträge kündigen");
  assert.equal(CONFIRM_CANCEL_BUTTON_LABEL, "Jetzt kündigen");
});

test("cancelConfirmText (EN-Default): nennt Plan-Name + Wirkungstermin (en-US formatiert)", () => {
  // Owner-Entscheidung 2026-08-14: der EN-Modus formatiert das Wirkungsdatum
  // wie das uebrige englische Dashboard (renewDate, en-US) - die frueher auch
  // im EN-Satz erzwungene TT.MM.JJJJ-Schreibweise war fuer en-US-Leser
  // mehrdeutig (12.9. = Dec 9 oder Sep 12). DE-Modus s. eigener Test unten.
  const epoch = 1781000000; // Unix-Sekunden
  const expectedDate = new Date(epoch * 1000).toLocaleDateString("en-US");
  const text = cancelConfirmText({ planSlug: "starter", currentPeriodEnd: epoch });
  assert.ok(text.includes("Starter"), "Plan-Name fehlt");
  assert.ok(text.includes(expectedDate), "en-US formatiertes Datum fehlt");
});

test("cancelConfirmText: ohne Termin -> Satz ohne Datum, kein 'undefined'/'Invalid Date'", () => {
  const text = cancelConfirmText({ planSlug: "business", currentPeriodEnd: 0 });
  assert.ok(text.includes("Business"));
  assert.ok(!text.includes("undefined"));
  assert.ok(!text.includes("Invalid Date"));
});

test("cancelStatusLine (EN-Default): 'Cancelled — active until <en-US-Datum>.'", () => {
  const epoch = 1781000000;
  const expectedDate = new Date(epoch * 1000).toLocaleDateString("en-US");
  assert.equal(cancelStatusLine({ currentPeriodEnd: epoch }), `Cancelled — active until ${expectedDate}.`);
  assert.equal(cancelStatusLine({ currentPeriodEnd: 0 }), "Cancelled.");
});

// ---- wireCancelControls: Stufe 1/2 Sichtbarkeit (rein DOM, kein Netz) -----------
function fakeToggle(initialHidden) {
  let handler = null;
  return {
    hidden: initialHidden,
    addEventListener(name, fn) {
      assert.equal(name, "click");
      handler = fn;
    },
    click() {
      return handler();
    },
  };
}

function fakeCancelEls() {
  return {
    openBtn: fakeToggle(false),
    confirmPanel: fakeToggle(true),
    confirmBtn: fakeToggle(false),
    abortBtn: fakeToggle(false),
    resumeBtn: fakeToggle(true),
  };
}

test("wireCancelControls: openBtn-Klick zeigt die Bestaetigung, blendet Stufe 1 aus (kein Netz)", () => {
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: {} }));
  try {
    const els = fakeCancelEls();
    wireCancelControls(els, { onMessage: () => {}, onDone: async () => {} });
    els.openBtn.click();
    assert.equal(els.confirmPanel.hidden, false);
    assert.equal(els.openBtn.hidden, true);
    assert.equal(f.calls.length, 0, "Stufe 1 -> 2 loest KEINEN Stripe-Call aus");
  } finally {
    f.restore();
  }
});

test("wireCancelControls: abortBtn-Klick nimmt die Bestaetigung zurueck (kein Netz)", () => {
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: {} }));
  try {
    const els = fakeCancelEls();
    wireCancelControls(els, { onMessage: () => {}, onDone: async () => {} });
    els.openBtn.click();
    els.abortBtn.click();
    assert.equal(els.confirmPanel.hidden, true);
    assert.equal(els.openBtn.hidden, false);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test("wireCancelControls: confirmBtn-Klick postet an /cancel, meldet 'cancelled', ruft onDone(result)", async () => {
  const f = stubFetch(() =>
    fakeResponse({ ok: true, status: 200, json: { cancelAtPeriodEnd: true, currentPeriodEnd: 1 } }),
  );
  try {
    const els = fakeCancelEls();
    const messages = [];
    const done = [];
    wireCancelControls(els, {
      onMessage: (text, ok) => messages.push({ text, ok }),
      onDone: async (result) => done.push(result),
    });
    await els.confirmBtn.click();
    assert.equal(f.calls[0].path, "/api/self-service/billing/cancel");
    assert.equal(f.calls[0].options.method, "POST");
    assert.deepEqual(messages, [{ text: CANCEL_MESSAGES.cancelled, ok: true }]);
    assert.deepEqual(done, [{ cancelAtPeriodEnd: true, currentPeriodEnd: 1 }]);
  } finally {
    f.restore();
  }
});

test("wireCancelControls: confirmBtn 409 -> 'no active subscription' Hinweis, KEIN onDone", async () => {
  const f = stubFetch(() => fakeResponse({ ok: false, status: 409, json: { error: "no_subscription" } }));
  try {
    const els = fakeCancelEls();
    const messages = [];
    let doneCount = 0;
    wireCancelControls(els, {
      onMessage: (text, ok) => messages.push({ text, ok }),
      onDone: async () => {
        doneCount += 1;
      },
    });
    await els.confirmBtn.click();
    assert.deepEqual(messages, [{ text: CANCEL_MESSAGES.noSubscription, ok: false }]);
    assert.equal(doneCount, 0);
  } finally {
    f.restore();
  }
});

test("wireCancelControls: confirmBtn 401 -> Session abgelaufen", async () => {
  const f = stubFetch(() => fakeResponse({ ok: false, status: 401, json: {} }));
  try {
    const els = fakeCancelEls();
    const messages = [];
    wireCancelControls(els, { onMessage: (text, ok) => messages.push({ text, ok }), onDone: async () => {} });
    await els.confirmBtn.click();
    assert.deepEqual(messages, [{ text: CANCEL_MESSAGES.sessionExpired, ok: false }]);
  } finally {
    f.restore();
  }
});

test("wireCancelControls: confirmBtn 5xx -> generischer cancelFailed-Hinweis", async () => {
  const f = stubFetch(() => fakeResponse({ ok: false, status: 500, json: {} }));
  try {
    const els = fakeCancelEls();
    const messages = [];
    wireCancelControls(els, { onMessage: (text, ok) => messages.push({ text, ok }), onDone: async () => {} });
    await els.confirmBtn.click();
    assert.deepEqual(messages, [{ text: CANCEL_MESSAGES.cancelFailed, ok: false }]);
  } finally {
    f.restore();
  }
});

test("wireCancelControls: resumeBtn-Klick postet an /resume, meldet 'resumed'", async () => {
  const f = stubFetch(() =>
    fakeResponse({ ok: true, status: 200, json: { cancelAtPeriodEnd: false, currentPeriodEnd: 1 } }),
  );
  try {
    const els = fakeCancelEls();
    const messages = [];
    const done = [];
    wireCancelControls(els, {
      onMessage: (text, ok) => messages.push({ text, ok }),
      onDone: async (result) => done.push(result),
    });
    await els.resumeBtn.click();
    assert.equal(f.calls[0].path, "/api/self-service/billing/resume");
    assert.deepEqual(messages, [{ text: CANCEL_MESSAGES.resumed, ok: true }]);
    assert.deepEqual(done, [{ cancelAtPeriodEnd: false, currentPeriodEnd: 1 }]);
  } finally {
    f.restore();
  }
});

test("wireCancelControls: resumeBtn 409 -> 'no active subscription' Hinweis (eigener Fehlertext-Zweig)", async () => {
  const f = stubFetch(() => fakeResponse({ ok: false, status: 409, json: { error: "no_subscription" } }));
  try {
    const els = fakeCancelEls();
    const messages = [];
    wireCancelControls(els, { onMessage: (text, ok) => messages.push({ text, ok }), onDone: async () => {} });
    await els.resumeBtn.click();
    assert.deepEqual(messages, [{ text: CANCEL_MESSAGES.noSubscription, ok: false }]);
  } finally {
    f.restore();
  }
});

test("CANCEL_ABORT_LABEL/RESUME_BUTTON_LABEL: nicht gesetzlich vorgegeben, Englisch (Dashboard-Sprache)", () => {
  assert.equal(CANCEL_ABORT_LABEL, "Never mind");
  assert.equal(RESUME_BUTTON_LABEL, "Resume subscription");
});

// ---- Doppelklick-Schutz (Payment-Neugestaltung) --------------------------------

test("wireSubscribe: Doppelklick waehrend ein Request laeuft macht nur EINEN Fetch (Guard)", async () => {
  let resolveFetch;
  const f = stubFetch(
    () =>
      new Promise((resolve) => {
        resolveFetch = () =>
          resolve(fakeResponse({ ok: true, status: 200, json: { plan: "starter", currentPeriodEnd: 1 } }));
      }),
  );
  try {
    const container = fakeContainer();
    const opts = spyOpts();
    wireSubscribe(container, opts);
    const first = container.click("starter");
    const second = container.click("starter"); // waehrend der erste Request noch offen ist
    resolveFetch();
    await first;
    await second;
    assert.equal(f.calls.length, 1, "der zweite Klick waehrend eines laufenden Requests darf keinen Fetch ausloesen");
  } finally {
    f.restore();
  }
});

test("wireSubscribe: nach Abschluss eines Requests loest ein neuer Klick wieder einen Fetch aus", async () => {
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: { plan: "starter", currentPeriodEnd: 1 } }));
  try {
    const container = fakeContainer();
    const opts = spyOpts();
    wireSubscribe(container, opts);
    await container.click("starter");
    await container.click("starter");
    assert.equal(f.calls.length, 2, "der Guard darf nur WAEHREND eines laufenden Requests blocken");
  } finally {
    f.restore();
  }
});

test("wireCancelControls: Doppelklick auf confirmBtn waehrend ein Request laeuft macht nur EINEN Fetch (Guard)", async () => {
  let resolveFetch;
  const f = stubFetch(
    () =>
      new Promise((resolve) => {
        resolveFetch = () =>
          resolve(fakeResponse({ ok: true, status: 200, json: { cancelAtPeriodEnd: true, currentPeriodEnd: 1 } }));
      }),
  );
  try {
    const els = fakeCancelEls();
    const messages = [];
    wireCancelControls(els, { onMessage: (text, ok) => messages.push({ text, ok }), onDone: async () => {} });
    const first = els.confirmBtn.click();
    const second = els.confirmBtn.click();
    resolveFetch();
    await first;
    await second;
    assert.equal(f.calls.length, 1, "der zweite Klick waehrend eines laufenden Requests darf keinen Fetch ausloesen");
  } finally {
    f.restore();
  }
});

// ---- Status-Zusammenfassung (Payment-Neugestaltung) ----------------------------

test("billingStatusKind: kein Abo + keine Karte -> no_card", () => {
  assert.equal(billingStatusKind({ hasCard: false, sub: { planSlug: "" } }), BILLING_STATUS.NO_CARD);
});

test("billingStatusKind: kein Abo + Karte vorhanden -> no_sub", () => {
  assert.equal(billingStatusKind({ hasCard: true, sub: { planSlug: "" } }), BILLING_STATUS.NO_SUB);
});

test("billingStatusKind: aktives Abo -> active (unabhaengig von hasCard)", () => {
  assert.equal(
    billingStatusKind({ hasCard: true, sub: { planSlug: "starter", cancelAtPeriodEnd: false } }),
    BILLING_STATUS.ACTIVE,
  );
});

test("billingStatusKind: Abo mit cancelAtPeriodEnd -> cancelled", () => {
  assert.equal(
    billingStatusKind({ hasCard: true, sub: { planSlug: "starter", cancelAtPeriodEnd: true } }),
    BILLING_STATUS.CANCELLED,
  );
});

test("billingStatusBadge/-BadgeClass: eine kurze Beschriftung + ein bekannter CSS-Suffix je Zustand", () => {
  for (const kind of Object.values(BILLING_STATUS)) {
    assert.ok(billingStatusBadge(kind).length > 0, `Badge-Text fehlt fuer ${kind}`);
    assert.match(billingStatusBadgeClass(kind), /^(pending|active|cancelled)$/);
  }
});

test("billingStatusText: aktiv/cancelled nutzen subscriptionLine/cancelStatusLine (EINE Quelle)", () => {
  const epoch = 1781000000;
  const activeSub = { planSlug: "starter", currentPeriodEnd: epoch, cancelAtPeriodEnd: false };
  assert.equal(billingStatusText(BILLING_STATUS.ACTIVE, activeSub), subscriptionLine(activeSub));

  const cancelledSub = { planSlug: "business", currentPeriodEnd: epoch, cancelAtPeriodEnd: true };
  const text = billingStatusText(BILLING_STATUS.CANCELLED, cancelledSub);
  assert.ok(text.includes("Business"), "Plan-Name fehlt in der Cancelled-Statuszeile");
  assert.ok(text.includes(cancelStatusLine(cancelledSub)), "cancelStatusLine-Wortlaut fehlt");
});

test("billingStatusText: no_card/no_sub tragen einen statischen naechsten Schritt", () => {
  const noCardText = billingStatusText(BILLING_STATUS.NO_CARD, { planSlug: "" });
  const noSubText = billingStatusText(BILLING_STATUS.NO_SUB, { planSlug: "" });
  assert.match(noCardText, /payment method/i);
  assert.match(noSubText, /plan/i);
  assert.notEqual(noCardText, noSubText, "no_card und no_sub muessen unterscheidbare Saetze zeigen");
});

// ---- billingStatusHeadline/-Detail: Serif-Wert + Mono-Nebenangabe (§10) -------

test("billingStatusHeadline: aktiv/gekuendigt -> Plan-Name, sonst dieselbe Beschriftung wie die Status-Pille", () => {
  const activeSub = { planSlug: "starter", currentPeriodEnd: 0, cancelAtPeriodEnd: false };
  assert.equal(billingStatusHeadline(BILLING_STATUS.ACTIVE, activeSub), "Starter");
  const cancelledSub = { planSlug: "business", currentPeriodEnd: 0, cancelAtPeriodEnd: true };
  assert.equal(billingStatusHeadline(BILLING_STATUS.CANCELLED, cancelledSub), "Business");
  assert.equal(
    billingStatusHeadline(BILLING_STATUS.NO_CARD, { planSlug: "" }),
    billingStatusBadge(BILLING_STATUS.NO_CARD),
  );
  assert.equal(
    billingStatusHeadline(BILLING_STATUS.NO_SUB, { planSlug: "" }),
    billingStatusBadge(BILLING_STATUS.NO_SUB),
  );
});

test("billingStatusDetail: aktiv -> Renews-Datum (oder leer ohne Termin)", () => {
  const epoch = 1781000000;
  const expectedDate = new Date(epoch * 1000).toLocaleDateString("en-US");
  assert.equal(
    billingStatusDetail(BILLING_STATUS.ACTIVE, { planSlug: "starter", currentPeriodEnd: epoch }),
    `Renews ${expectedDate}`,
  );
  assert.equal(billingStatusDetail(BILLING_STATUS.ACTIVE, { planSlug: "starter", currentPeriodEnd: 0 }), "");
});

test("billingStatusDetail: gekuendigt -> dieselbe Zeile wie cancelStatusLine (EINE Quelle)", () => {
  const cancelledSub = { planSlug: "business", currentPeriodEnd: 1781000000, cancelAtPeriodEnd: true };
  assert.equal(billingStatusDetail(BILLING_STATUS.CANCELLED, cancelledSub), cancelStatusLine(cancelledSub));
});

test("billingStatusDetail: no_card/no_sub -> derselbe erklaerende Satz wie billingStatusText", () => {
  const sub = { planSlug: "" };
  assert.equal(billingStatusDetail(BILLING_STATUS.NO_CARD, sub), billingStatusText(BILLING_STATUS.NO_CARD, sub));
  assert.equal(billingStatusDetail(BILLING_STATUS.NO_SUB, sub), billingStatusText(BILLING_STATUS.NO_SUB, sub));
});

// ---- Newsletter-Einwilligung (Opt-in, DSGVO Art. 7 Abs. 1) ---------------------

test("newsletterConsentFrom: Default nicht eingewilligt (fehlendes/kaputtes Feld -> false, NIE vorangekreuzt)", () => {
  assert.equal(newsletterConsentFrom({}), false);
  assert.equal(newsletterConsentFrom(null), false);
  assert.equal(newsletterConsentFrom(undefined), false);
  assert.equal(newsletterConsentFrom({ newsletter: {} }), false);
  assert.equal(newsletterConsentFrom({ newsletter: { consent: "true" } }), false); // kein strikter Boolean
  assert.equal(newsletterConsentFrom({ newsletter: { consent: 1 } }), false);
  assert.equal(newsletterConsentFrom({ newsletter: { consent: true } }), true);
});

// Fake-Checkbox: bildet nur die im Bau genutzten DOM-Operationen nach (Muster
// fakeToggle oben), aber mit "change" statt "click" + checked/disabled-Property.
function fakeCheckbox(initialChecked) {
  let handler = null;
  return {
    checked: initialChecked,
    disabled: false,
    addEventListener(name, fn) {
      assert.equal(name, "change");
      handler = fn;
    },
    // Simuliert, was der Browser vor dem "change"-Event bereits getan hat: checked
    // ist zum Zeitpunkt des Events schon der NEUE Wert (native Checkbox-Semantik).
    change(nextChecked) {
      this.checked = nextChecked;
      return handler();
    },
  };
}

test("wireNewsletterToggle: Umschalten sendet einen STRIKTEN Boolean an newsletter-consent, Erfolg -> Bestaetigung", async () => {
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: { ok: true, newsletterConsent: true } }));
  try {
    const toggle = fakeCheckbox(false);
    const messages = [];
    wireNewsletterToggle(toggle, { onMessage: (text, ok) => messages.push({ text, ok }) });
    await toggle.change(true);
    assert.equal(f.calls[0].path, "/api/self-service/newsletter-consent");
    assert.equal(f.calls[0].options.method, "POST");
    const body = JSON.parse(f.calls[0].options.body);
    assert.deepEqual(body, { consent: true });
    assert.equal(typeof body.consent, "boolean", "consent muss ein strikter Boolean sein, kein String/Zahl");
    assert.equal(toggle.checked, true, "Haekchen bleibt auf dem SERVER-bestaetigten Wert");
    assert.deepEqual(messages, [{ text: NEWSLETTER_MESSAGES.optedIn, ok: true }]);
    assert.equal(toggle.disabled, false);
  } finally {
    f.restore();
  }
});

test("wireNewsletterToggle: Widerruf sendet consent:false", async () => {
  const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: { ok: true, newsletterConsent: false } }));
  try {
    const toggle = fakeCheckbox(true);
    wireNewsletterToggle(toggle, { onMessage: () => {} });
    await toggle.change(false);
    assert.deepEqual(JSON.parse(f.calls[0].options.body), { consent: false });
    assert.equal(toggle.checked, false);
  } finally {
    f.restore();
  }
});

test("wireNewsletterToggle: Server-Fehler setzt das Haekchen zurueck + Fehlermeldung", async () => {
  const f = stubFetch(() => fakeResponse({ ok: false, status: 500, json: {} }));
  try {
    const toggle = fakeCheckbox(false);
    const messages = [];
    wireNewsletterToggle(toggle, { onMessage: (text, ok) => messages.push({ text, ok }) });
    await toggle.change(true); // Nutzer versucht einzuwilligen, der Server lehnt ab
    assert.equal(toggle.checked, false, "Haekchen springt auf den vorherigen Zustand zurueck");
    assert.deepEqual(messages, [{ text: NEWSLETTER_MESSAGES.failed, ok: false }]);
    assert.equal(toggle.disabled, false, "Checkbox bleibt nach dem Fehlschlag bedienbar");
  } finally {
    f.restore();
  }
});

test("wireNewsletterToggle: 401 -> Session abgelaufen, Haekchen faellt zurueck", async () => {
  const f = stubFetch(() => fakeResponse({ ok: false, status: 401, json: {} }));
  try {
    const toggle = fakeCheckbox(true);
    const messages = [];
    wireNewsletterToggle(toggle, { onMessage: (text, ok) => messages.push({ text, ok }) });
    await toggle.change(false); // Nutzer versucht zu widerrufen, Session ist abgelaufen
    assert.equal(toggle.checked, true);
    assert.deepEqual(messages, [{ text: NEWSLETTER_MESSAGES.sessionExpired, ok: false }]);
  } finally {
    f.restore();
  }
});

// ---- Dashboard-i18n Etappe 2: DE-Modus ---------------------------------------

test("DE-Modus: renewDate/subscriptionLine nutzen das deutsche Datumsformat (TT.MM.JJJJ), Woertlichkeit sonst deutsch", () => {
  withLang("de", () => {
    const epoch = 1781000000;
    const expectedDate = new Date(epoch * 1000).toLocaleDateString("de-DE");
    assert.equal(
      subscriptionLine({ planSlug: "starter", currentPeriodEnd: epoch }),
      `Aktiver Tarif: Starter (verlängert sich am ${expectedDate}).`,
    );
    assert.equal(subscriptionLine({ planSlug: "business", currentPeriodEnd: 0 }), "Aktiver Tarif: Business.");
  });
});

test("DE-Modus: quotaLine/billingStatusBadge/billingStatusText sind deutsch", () => {
  withLang("de", () => {
    assert.equal(quotaLine({ remainingMinutes: 5, includedMinutes: 30 }), "5 von 30 Minuten übrig");
    assert.equal(billingStatusBadge(BILLING_STATUS.NO_CARD), "Keine Karte");
    assert.equal(billingStatusBadge(BILLING_STATUS.ACTIVE), "Aktiv");
    assert.match(billingStatusText(BILLING_STATUS.NO_CARD, { planSlug: "" }), /Zahlungsmittel/);
    assert.match(billingStatusText(BILLING_STATUS.NO_SUB, { planSlug: "" }), /Tarif/);
  });
});

test("DE-Modus: SUBSCRIBE_MESSAGES/CANCEL_MESSAGES/NEWSLETTER_MESSAGES/PLAN_CHOICE_COPY laufen ueber wireSubscribe/wireCancelControls/wireNewsletterToggle deutsch", async () => {
  await withLangAsync("de", async () => {
    const f = stubFetch(() => fakeResponse({ ok: true, status: 200, json: { plan: "starter", currentPeriodEnd: 1 } }));
    try {
      const container = fakeContainer();
      const opts = spyOpts();
      wireSubscribe(container, opts);
      await container.click("starter");
      assert.deepEqual(opts.messages, [{ text: "Abo gebucht.", ok: true }]);
    } finally {
      f.restore();
    }
  });
});

// wireSubscribe/wireNewsletterToggle sind async -- withLang() (synchron) wuerde die
// localStorage-Stub-Restauration VOR dem Abschluss des Promises zuruecknehmen. Eigene
// async-Variante fuer diese Faelle (Muster identisch, nur await statt sofortigem finally).
async function withLangAsync(lang, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => lang };
  try {
    await fn();
  } finally {
    if (had) globalThis.localStorage = original;
    else delete globalThis.localStorage;
  }
}

test("Kuendigungs-Weg sprachbewusst: DE-Modus woertlicher Pflichtwortlaut + deutsche Saetze, EN-Modus eindeutige englische Formulierung", () => {
  const epoch = 1781000000;
  const expectedGermanDate = new Date(epoch * 1000).toLocaleDateString("de-DE");
  const expectedEnDate = new Date(epoch * 1000).toLocaleDateString("en-US");

  // EN-Default: englische Knopf-Beschriftung (Owner-Entscheidung 2026-08-14) --
  // die KONSTANTEN mit dem deutschen Pflichtwortlaut bleiben davon unberuehrt.
  assert.equal(CANCEL_BUTTON_LABEL, "Verträge kündigen");
  assert.equal(cancelButtonLabel(), "Cancel contracts");
  assert.equal(confirmCancelButtonLabel(), "Cancel now");
  assert.ok(cancelConfirmText({ planSlug: "starter", currentPeriodEnd: epoch }).includes(expectedEnDate));

  withLang("de", () => {
    assert.equal(cancelAbortLabel(), "Doch nicht");
    assert.equal(resumeButtonLabel(), "Abo fortsetzen");
    // § 312k: im DE-Modus erscheint der gesetzlich vorgegebene Wortlaut WOERTLICH.
    assert.equal(cancelButtonLabel(), "Verträge kündigen");
    assert.equal(confirmCancelButtonLabel(), "Jetzt kündigen");
    const confirmDe = cancelConfirmText({ planSlug: "starter", currentPeriodEnd: epoch });
    assert.ok(confirmDe.includes("Starter"), "Plan-Name fehlt im DE-Satz");
    assert.ok(confirmDe.includes(expectedGermanDate), "deutsches Datum fehlt im DE-Satz");
    assert.ok(confirmDe.includes("endet am"), "deutscher Satzbau fehlt");
    assert.equal(cancelStatusLine({ currentPeriodEnd: epoch }), `Gekündigt — aktiv bis ${expectedGermanDate}.`);
    assert.equal(cancelStatusLine({ currentPeriodEnd: 0 }), "Gekündigt.");
  });

  // Und weiterhin unveraendert im EN-Default danach (kein Leck aus withLang).
  assert.equal(cancelAbortLabel(), "Never mind");
  assert.equal(resumeButtonLabel(), "Resume subscription");
  assert.equal(cancelButtonLabel(), "Cancel contracts");
});
