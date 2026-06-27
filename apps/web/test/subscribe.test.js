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
  wireSubscribe,
  SUBSCRIBE_MESSAGES,
  PLAN_CHOICE_COPY,
  renderPlanChoice,
  dismissPlanChoice,
} from "../src/lib/subscribe.js";

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
  assert.ok(text.includes("$4.99"));
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
    if (path.includes("/subscribe")) return fakeResponse({ ok: false, status: 409, json: { error: "no_card" } });
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

// ApiError wird mit dem Backend-Code getragen (no_card) -> der no_card-Zweig der
// Maschine haengt genau daran. Sicherheitsnetz gegen einen stillen Code-Verlust.
test("ApiError traegt den optionalen Backend-Code", () => {
  const err = new ApiError(409, "x", "no_card");
  assert.equal(err.status, 409);
  assert.equal(err.code, "no_card");
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
