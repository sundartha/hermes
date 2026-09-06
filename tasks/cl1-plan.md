Alles gelesen (Spec, Umbrella-Plan, clean-code.md, echter `master`-Code + alle Call-Sites). Hier ist der Umsetzungsplan.

---

# Umsetzungsplan CL1 — Kuendigung darf keinen ausweglosen Zustand hinterlassen

**Reihenfolge:** B1+B2 (inkl. geteiltem Schreib-Helfer) → B3 → B4 → B5. Jeder Baustein ist einzeln lauffähig und testbar.

## 0. Am Code geprüfte Vorentscheidungen (Spec verlangt: nicht raten)

| Frage (Spec B2) | Befund am Code | Entscheidung |
|---|---|---|
| Akzeptiert `setTenantSubscription` `null` im Patch? | `state-ops.js` setzt selektiv per `!== undefined`: `if (subscriptionId !== undefined) tenant.stripeSubscriptionId = subscriptionId;` → **`null` wird geschrieben**, nicht verworfen. `tenantSubscription()` liest `?? null`. pg-Flush: `t.stripeSubscriptionId ?? null` in den UPSERT-Params, Spalte ist nullable; `rowToTenant` lässt das Feld bei NULL weg → Reader liefert `null`. json-Backend mutiert dieselbe reine Ops-Funktion. **Beide Backends tragen `null`.** | kein Setter-Umbau nötig |
| `planSlug` mit-leeren? | `planSlug: null` ⇒ `deriveTenantBudgetFromPlan` Fall (1) = NO-OP (bestehende Decke bleibt), und `showTiles = !sub.planSlug` (BillingIsland) würde nach einer späteren Reaktivierung die Tarif-Kacheln einblenden. Für die Aussperrung ist **allein `subscriptionId`** ursächlich (`hasActiveSubscription` liest nur dieses Feld). | **planSlug bleibt stehen.** Kleinster Blast-Radius, Owner-Entscheidung „geparkt" (Historie bleibt), SCOPE-Regel. |
| `cancelAtPeriodEnd` mit-leeren? | Wird im SUSPEND-Zweig **vor** jeder Mutation gelesen (`endedViaCancellation`) — ein Löschen wäre hier gefahrlos, **aber**: schlägt `attemptContractEndCleanup` fehl, bevor `setContractEndCleanupPending` die Marker setzt, ist ein redelivertes `deleted` die letzte Retry-Chance; ohne den Vermerk liefe sie ins Leere (fail-open). | **bleibt stehen.** Der stale-Vermerk ist ein eigener Bestandsbefund (nicht Teil der Aussperrungs-Kette) → im Report benennen, nicht in CL1 mitfixen. |

---

## 1. B1 + B2 — Ereignis-Typ durchreichen, Referenz nur beim echten Ende entwerten

### 1a. Neue gemeinsame Schreibstelle (kein neues File)

`src/billing/subscribe.js` — direkt **unter** `hasActiveSubscription` (dort lebt die Lesekante desselben Feldes; G17 „wo würde jemand das suchen"):

```js
// CL1-B2: das Gegenstueck zu hasActiveSubscription - die EINE Stelle, die die
// gespeicherte Abo-Referenz entwertet. Genau das Feld, das die Lesekante darueber
// prueft, und NUR dieses: planSlug bleibt (Historie/Budget-Ableitung, Owner-
// Entscheidung "geparkt"), cancelAtPeriodEnd bleibt (der Vertragsende-Retry im
// Webhook liest ihn). Kein No-Op-Risiko und kein Wurf: ist nichts gespeichert
// (auch bei unbekanntem Tenant liefert tenantSubscription null), passiert nichts -
// setTenantSubscription wuerde fuer einen unbekannten Tenant werfen, und der
// SUSPEND-Zweig hat kein try/catch ueber sich. Idempotent (zweiter Aufruf = No-Op).
// Nebeneffekt (Store-Schreibung) im Namen (N7).
export function clearSubscriptionReference(store, tenant) {
  if (!hasActiveSubscription(store, tenant)) return;
  store.setTenantSubscription(tenant, { subscriptionId: null });
}
```

Zyklus geprüft: `subscribe.js` importiert (transitiv) nie `webhook.js` → die neue Kante `webhook.js → subscribe.js` ist zyklenfrei.

### 1b. `src/billing/webhook.js`

**Edit 1 — Import (zu den bestehenden Imports oben):**
```js
import { clearSubscriptionReference } from "./subscribe.js";
```

**Edit 2 — neue Konstante, direkt unter dem `WEBHOOK_ACTION`-Block:**
```js
// CL1-B1: WARUM suspendiert wird. Beide Ereignisse falten weiter auf action=suspend
// (WELCHE Events suspendieren, aendert sich NICHT) - aber der SUSPEND-Zweig muss
// unterscheiden koennen, ob das Stripe-Abo noch EXISTIERT: nach deleted ist die
// gespeicherte sub_-Referenz tot, im Dunning lebt sie weiter (Doppelabbuchungs-
// Schutz). Die Unterscheidung faellt HIER, in der reinen Interpretation - der
// Effekt-Zweig wertet das Roh-Event NICHT erneut aus (G5/G23: eine Auswertungsstelle).
export const SUSPEND_REASON = Object.freeze({
  SUBSCRIPTION_DELETED: "subscription_deleted", // Abo bei Stripe beendet -> Referenz ist tot
  PAYMENT_FAILED: "payment_failed",             // Dunning -> Abo lebt, Referenz bleibt
});
```

**Edit 3 — `interpretStripeEvent`, DELETED-Zweig:**
```js
    case SUBSCRIPTION_EVENT.DELETED:
      return {
        action: WEBHOOK_ACTION.SUSPEND,
        suspendReason: SUSPEND_REASON.SUBSCRIPTION_DELETED,
        tenantRef: tenantRefOf(object),
        subscriptionId: object.id ?? null,
      };
```

**Edit 4 — PAYMENT_FAILED-Zweig** (Kommentar unverändert lassen, nur das Feld ergänzen):
```js
      return {
        action: WEBHOOK_ACTION.SUSPEND,
        suspendReason: SUSPEND_REASON.PAYMENT_FAILED,
        tenantRef: tenantRefOf(object),
        subscriptionId: object.subscription ?? null,
      };
```

**Edit 5 — Destrukturierung in `applyStripeWebhook`:**
```js
  const {
    action, tenantRef, subscriptionId, planSlug, currentPeriodEnd, currentPeriodStart,
    customerId, paymentMethodId, cancelAtPeriodEnd, suspendReason,
  } = interpreted;
```

**Edit 6 — SUSPEND-Zweig.** Vorher:
```js
  await sessions.invalidateByTenant(tenant);
  audit("stripe_webhook_suspend", req, `tenant=${tenant}`);
```
Nachher:
```js
  await sessions.invalidateByTenant(tenant);
  // CL1-B2 (Geld-Invariante): NUR das echte Vertragsende entwertet die Abo-Referenz.
  // Nach customer.subscription.deleted existiert bei Stripe kein Abo mehr - bliebe die
  // sub_-Referenz stehen, behauptete sie dauerhaft "es gibt ein Abo" und der Kunde kaeme
  // weder ins Dashboard (status=suspended -> 403) noch zu einem neuen Abo
  // (hasActiveSubscription -> 409 already_subscribed): ein Zustand ohne Ausgang.
  // Bei invoice.payment_failed wird an den Abo-Referenzen NICHTS geaendert - dort LEBT
  // das Stripe-Abo weiter; eine geleerte Referenz liesse denselben Kunden ein ZWEITES
  // Abo kaufen (Doppelabbuchung). Das Gate hasActiveSubscription bleibt unveraendert.
  const subscriptionEnded = suspendReason === SUSPEND_REASON.SUBSCRIPTION_DELETED;
  if (subscriptionEnded) clearSubscriptionReference(store, tenant);
  audit(
    "stripe_webhook_suspend",
    req,
    `tenant=${tenant} reason=${suspendReason} subscription_ref=${subscriptionEnded ? "cleared" : "kept"}`,
  );
```

Position ist bewusst **nach** dem vollzogenen Suspend und **nach** `endedViaCancellation` (das oben unverändert vor jeder Mutation gelesen wird) und **vor** `attemptContractEndCleanup` (das die Abo-Felder nicht liest — Reihenfolge behavioral neutral, aber die Audit-Zeile beschreibt so den bereits vollzogenen Zustand).

Nebenwirkung, bewusst und harmlos: `setTenantSubscription` triggert in beiden Store-Wrappern `deriveTenantBudgetFromPlan` — mit unverändertem `planSlug` schreibt sie dieselbe Decke erneut (idempotent).

---

## 2. B3 — Bestandsdaten heilen (Reconcile gegen Stripe)

### 2a. Selektor: `src/store/state-ops.js`

Direkt **unter** `tenantsForStripeReconcile` (Nachbarschaft = lesbarer Kontrast):

```js
// ---- CL1-B3: Bestandsheiler fuer TOTE Abo-Referenzen ----
// Selektor fuer reconcileStaleSubscriptions (billing/stale-subscription-reconcile.js):
// Tenants, die eine Abo-Referenz TRAGEN, aber NICHT aktiv sind. Das ist die
// Kandidatenmenge des Aussperrungs-Befunds (status=suspended + stehengebliebene
// stripeSubscriptionId -> 403 im Dashboard UND 409 beim Neu-Abo).
// Bewusst NICHT dieselbe Menge wie tenantsForStripeReconcile darueber: der beantwortet
// "darf ich noch sperren?" (Abo da, NICHT suspendiert -> verlorener Webhook), dieser
// hier "ist die Referenz tot?" (Abo-Referenz da, NICHT aktiv). Gegenlaeufige Fragen,
// gegenlaeufige Wirkung - deshalb zwei Selektoren statt eines Flag-Arguments (F3/G15).
// REIN + IO-frei (mutiert s NICHT). Wer die Referenz wirklich verliert, entscheidet
// ausschliesslich Stripe (kein Blind-Update, s. Executor).
export function tenantsForStaleSubscriptionReconcile(s) {
  return tenantsOf(s).filter((t) => t.stripeSubscriptionId && t.status !== TENANT_STATUS.ACTIVE);
}
```
(`TENANT_STATUS` und `tenantsOf` sind in der Datei bereits vorhanden/verwendet.)

### 2b. Neue Datei: `src/billing/stale-subscription-reconcile.js`

```js
// CL1-B3: Bestandsheiler fuer TOTE Stripe-Abo-Referenzen. Der Code-Fix (B1/B2) wirkt
// nur auf kuenftige Ereignisse; Datensaetze, die den Aussperrungs-Zustand bereits
// tragen (status != active PLUS gesetzte stripeSubscriptionId), heilt niemand von
// selbst. Dieser Lauf fragt fuer jeden Kandidaten AKTIV bei Stripe nach und entwertet
// die Referenz NUR, wenn Stripe das Abo als beendet meldet.
//
// KEIN BLIND-UPDATE (die teuerste Fehlentscheidung dieses Bausteins): verloere ein
// Tenant mit LEBENDEM Abo seine Referenz, buchte Stripe weiter ab, waehrend Kuendigen
// und Resume unmoeglich wuerden. Deshalb fail-closed in jede Richtung: unbekannter/
// fehlender Status, jeder andere Status und JEDER API-/Netzfehler lassen den Tenant
// unveraendert (der naechste Lauf prueft erneut).
//
// Muster backfill-profiles.js: testbarer Kern (DIP, alle IO-Seams injiziert), Dry-Run
// als Default, strukturierter Report; das Skript daneben (scripts/reconcile-stale-
// subscriptions.js) ist nur Verdrahtung. Schreibt ueber DIESELBE Stelle wie der
// Webhook-Zweig (clearSubscriptionReference, G5) - keine zweite Entwertungs-Logik,
// die driften koennte.
import { clearSubscriptionReference } from "./subscribe.js";
import { tenantsForStaleSubscriptionReconcile } from "../store/state-ops.js";

// Stripe-Status, die eine TOTE Referenz beweisen (kein Magic-String, G25).
// Bewusst eine ANDERE Menge als HEALING_STRIPE_STATUS in stripe-reconcile.js: dort
// geht es ums SPERREN (ein nie bestaetigtes incomplete_expired hat nie ein Gate
// geoeffnet, ein Fehl-Suspend waere teuer), hier nur um die Frage, ob die gespeicherte
// Referenz noch etwas bezeichnet - und ein incomplete_expired bezeichnet nichts mehr.
const DEAD_SUBSCRIPTION_STATUS = Object.freeze(new Set(["canceled", "incomplete_expired"]));

// Report-Gruende (kein Magic-String, G25).
export const STALE_SUB_OUTCOME = Object.freeze({
  CLEARED: "cleared", // Stripe meldet beendet -> Referenz entwertet (nur bei apply)
  ALIVE: "alive", // Stripe meldet ein lebendes/unklares Abo -> unveraendert
  LOOKUP_FAILED: "lookup_failed", // Stripe unerreichbar/Fehler -> unveraendert (fail-closed)
});

// Ein Lauf. apply=false (Default) = reiner Trockenlauf: es wird gefragt und berichtet,
// aber NICHTS geschrieben. Wirft NIE pro Tenant (ein unerreichbares Stripe darf den
// Lauf nicht reissen). Liefert einen PII-freien Report (nur interne Tenant-ids + der
// opake Stripe-Status). Nebeneffekt (Store-Schreibung) NUR bei apply -> N7.
export async function reconcileStaleSubscriptions({ store, billing, apply = false, logger = console }) {
  const candidates = tenantsForStaleSubscriptionReconcile(store.load());
  const report = { apply, scanned: candidates.length, cleared: [], alive: [], errors: [] };
  for (const tenant of candidates) {
    let status;
    try {
      ({ status } = await billing.retrieveSubscription(tenant.stripeSubscriptionId));
    } catch (err) {
      // PII-/Key-frei (Regel 4): interne Tenant-id + Adapter-Meldung (die traegt
      // Status+Operation, nie den Stripe-Key oder Kundendaten).
      logger.warn(`[stale-subs] Statusabfrage fehlgeschlagen tenant=${tenant.id}: ${err.message}`);
      report.errors.push({ id: tenant.id, reason: STALE_SUB_OUTCOME.LOOKUP_FAILED });
      continue;
    }
    if (!DEAD_SUBSCRIPTION_STATUS.has(status)) {
      report.alive.push({ id: tenant.id, status: status ?? null });
      continue;
    }
    report.cleared.push({ id: tenant.id, status });
    if (apply) clearSubscriptionReference(store, tenant.id);
  }
  return report;
}
```

> **Bewusst akzeptiert und im Report zu nennen:** ein HTTP 404 („Subscription existiert nicht mehr") ist am Adapter heute nicht typisiert (`assertOk` wirft mit Status in der Message) — den Status aus einer Fehler-Message zu parsen wäre brüchig (C2/G26). Deshalb zählt 404 wie jeder andere Fehler als `lookup_failed` → **Tenant unverändert**. Das ist strikt fail-closed und deckt den Praxisfall trotzdem: Stripe löscht gekündigte Subscriptions nicht, sondern liefert sie mit `status=canceled`.

### 2c. Neue Datei: `scripts/reconcile-stale-subscriptions.js`

Spiegelt `scripts/backfill-plan-profiles.js` 1:1 (G11):

```js
#!/usr/bin/env node
// CL1-B3: heilt Bestands-Tenants mit TOTER Stripe-Abo-Referenz (status != active +
// gesetzte stripeSubscriptionId -> Dashboard 403 UND Neu-Abo 409, kein Ausweg).
// Trockenlauf ist Default; --apply schreibt. NUR pg (die realen Datensaetze leben
// dort); json = sauberer No-Op. Muster scripts/backfill-plan-profiles.js.
// Aufruf: node scripts/reconcile-stale-subscriptions.js [--apply]
import { config } from "../src/config.js";
import * as store from "../src/store.js";

const apply = process.argv.includes("--apply");

if (config.store.storeBackend !== "pg") {
  console.log("[stale-subs] json-Backend: No-Op (keine Bestandsdaten lokal).");
  process.exit(0);
}
// Ohne Stripe-Secret gibt es nichts zu fragen - lauter Abbruch statt eines Laufs, der
// jeden Tenant als "lookup_failed" meldet und wie ein Befund aussieht. Secret nie loggen.
if (!config.billing.stripeSecretKey) {
  console.error("[stale-subs] STRIPE_SECRET_KEY fehlt - ohne Stripe-Abfrage kein Abgleich.");
  process.exit(1);
}

const { createPortalRunner } = await import("../src/portal-pool.js");
const { stripeBilling } = await import("../src/billing/stripe.js");
const { reconcileStaleSubscriptions } = await import("../src/billing/stale-subscription-reconcile.js");

const runner = await createPortalRunner();
const r = await reconcileStaleSubscriptions({ store, billing: stripeBilling, apply });
if (apply) await store.save(); // PFLICHT: pg-Flush abwarten (Muster backfill/bootstrap-tenant)

console.log(
  `[stale-subs] mode=${apply ? "APPLY" : "DRY-RUN"} scanned=${r.scanned} ` +
    `cleared=${r.cleared.length} alive=${r.alive.length} errors=${r.errors.length}`,
);
for (const c of r.cleared) console.log(`  clear ${c.id} (stripe=${c.status})`);
for (const a of r.alive) console.log(`  keep  ${a.id} (stripe=${a.status})`);
for (const e of r.errors) console.log(`  skip  ${e.id} (${e.reason})`);

await runner._pool.end();
process.exit(0);
```

**`package.json`** — additiv neben `outbound:drift`:
```json
    "reconcile:stale-subs": "node scripts/reconcile-stale-subscriptions.js",
```
(Keine neue Dependency, keine neue Env-Variable → `config.js`/`.env.example`/`render.yaml` bleiben unberührt.)

---

## 3. B4 — Sackgasse „Vielleicht später" schließen

Befund am Code: `dismissPlanChoice` leert die Kacheln **und** versteckt den einzigen Knopf (`els.skip.hidden = true`) → Region ohne jedes Bedienelement. (Der „Sign out"-Knopf der AuthIsland ist im PENDING-Zustand sichtbar — der Ausweg *aus dem Zustand zurück zur Plan-Auswahl* fehlt komplett.)

**Design:** zwei einander ausschließende Knöpfe statt eines umbeschrifteten. Grund: `applyStaticTranslations` überschreibt bei jedem Sprachwechsel `textContent` jedes `[data-i18n]`-Knotens — ein zur Laufzeit umbeschrifteter Knopf verlöre seine Beschriftung. Zwei Knoten mit je eigenem statischem Schlüssel sind gegen diesen Mechanismus immun und brauchen **keinen** zusätzlichen Modul-Zustand.

**`apps/web/src/lib/subscribe.js`** — beide Funktionen (Kommentare mit anpassen, der alte „Einbahn"-Kommentar wird sonst falsch, C2):

```js
// Rahmt die suspended-Region als prominente Plan-Auswahl: aktivierende H1, erklaerender
// Untertitel, Plan-Kacheln aus dem Build-Spiegel, sichtbarer Skip-Link. REIN DOM (doc + els),
// kein Netz. els = { title, subtitle, tiles, skip, restore }. Von den beiden Knoepfen ist
// IMMER genau einer sichtbar (CL1-B4). fee (Phase A) optional, an planTiles durchgereicht
// (numberSetupFeeFrom, null -> keine Gebuehren-Zeile). NUR bei PAYMENT_ENABLED aufgerufen
// (Aufrufer-Guard) -> ohne Payment byte-identisch.
export function renderPlanChoice(doc, els, fee = null) {
  els.title.textContent = planChoiceText("title");
  els.subtitle.textContent = planChoiceText("subtitle");
  els.tiles.replaceChildren(...planTiles(doc, fee));
  els.skip.hidden = false;
  els.restore.hidden = true;
}

// "Maybe later": blendet die Plan-Auswahl aus, zeigt das ruhige Pending-Banner. REIN DOM,
// ruft KEIN subscribe/setStatus (Invariante AM3: aktiviert nichts, /state bleibt 403).
// CL1-B4: der Zustand behaelt einen Ausgang - der Skip-Knopf weicht dem Rueckweg zur
// Plan-Auswahl. Vorher blieb eine Ansicht ohne Link, Knopf oder Retry zurueck; einziger
// Rueckweg war ein manueller Reload, der nirgends angeboten wurde.
export function dismissPlanChoice(els) {
  els.title.textContent = planChoiceText("bannerTitle");
  els.subtitle.textContent = planChoiceText("bannerText");
  els.tiles.replaceChildren();
  els.skip.hidden = true;
  els.restore.hidden = false;
}
```

**`apps/web/src/pages/app/index.astro`** — Markup, direkt unter `#pending-skip`:
```html
    <!-- CL1-B4: Ausgang aus dem "Maybe later"-Zustand. Gegenstueck zu #pending-skip -
         genau einer der beiden ist sichtbar, damit die Region nie ohne Bedienelement
         dasteht. Gleiche ruhige Optik (.plan-skip), kein zweiter CTA. -->
    <button id="pending-restore" class="plan-skip" type="button" hidden data-i18n="pendingRestore">Show plans</button>
```

Skript-Teil — `pendingEls` ergänzen und einen Listener anhängen:
```js
  const pendingEls = {
    title: document.getElementById("pending-title"),
    subtitle: pendingTextEl,
    tiles: pendingTilesEl,
    skip: document.getElementById("pending-skip"),
    restore: document.getElementById("pending-restore"),
  };
```
```js
  pendingEls.skip.addEventListener("click", () => dismissPlanChoice(pendingEls));
  // CL1-B4: zurueck zur Plan-Auswahl. renderPending() holt den Billing-Status frisch,
  // statt Preis/Gebuehr zwischenzuspeichern - kein zusaetzlicher Modul-Zustand.
  pendingEls.restore.addEventListener("click", () => renderPending());
```

**`apps/web/src/lib/i18n.js`** — je eine Zeile direkt unter `pendingSkip` in **beiden** Wörterbüchern:
```js
    pendingRestore: "Show plans",
```
```js
    pendingRestore: "Tarife anzeigen",
```
Kein CSS-Edit (`.plan-skip` wird wiederverwendet). Kein Eintrag in `PLAN_CHOICE_COPY`/`_DE` → die Paritätsprüfung in `test/dashboard-i18n-surface.test.js` bleibt unberührt.

---

## 4. B5 — verwaiste `account`-Zeile / mehrdeutiger Lookup

**`src/web-auth.js`** — reines Prädikat oberhalb von `makeAccounts` (neben `selectAccountAuth`), unit-testbar ohne DB:

```js
// CL1-B5: Auswahlregel fuer accountByTenant. Der Vertragsende-Cleanup loescht den
// WorkOS-User, laesst dessen account-Zeile aber stehen; kehrt der Kunde zurueck,
// haengt der Email-Dedup einen zweiten sub auf denselben Tenant. Zwei Zeilen hiessen
// bisher pauschal "mehrdeutig -> null", und email-abhaengige Funktionen (Dashboard-
// Prefill, Newsletter-Empfaenger, Kuendigungsbestaetigung) degradierten still.
// Regel: JUENGSTE Zeile gewinnt, solange ALLE Zeilen dieselbe Email tragen - dann ist
// die Empfaengerfrage gar nicht mehrdeutig, egal wie viele subs es gibt. Tragen sie
// UNTERSCHIEDLICHE Emails, bleibt es fail-closed bei null (nicht raten, B2C-1:1).
// rows kommt vom Aufrufer bereits absteigend nach created_at sortiert (juengste zuerst).
// Verglichen wird ueber normalizeEmail - dieselbe Identitaets-Definition wie im
// Login-Dedup (G5), kein zweiter Email-Vergleichsbegriff.
export function newestAccountIfUnanimousEmail(rows) {
  if (rows.length === 0) return null;
  const [newest] = rows;
  const email = normalizeEmail(newest.email);
  if (!rows.every((row) => normalizeEmail(row.email) === email)) return null;
  return { sub: newest.sub, email: newest.email };
}
```

**`accountByTenant`** — vorher:
```js
        const { rows } = await c.query(
          `SELECT sub, email FROM account WHERE tenant_id = $1 LIMIT 2`,
          [tenantId],
        );
        return rows.length === 1 ? rows[0] : null;
```
nachher:
```js
        // ORDER BY created_at DESC = juengste Zeile zuerst (sub ASC nur als stabiler
        // Tie-Break bei identischem Zeitstempel - deterministisch statt Zufalls-
        // reihenfolge). KEIN LIMIT mehr: die Einstimmigkeitsregel muss JEDE Zeile des
        // Tenants sehen; ein LIMIT koennte Einstimmigkeit behaupten, die nicht gilt
        // (fail-open). Ein Tenant hat eine Handvoll Accounts, keine Liste.
        const { rows } = await c.query(
          `SELECT sub, email FROM account WHERE tenant_id = $1 ORDER BY created_at DESC, sub ASC`,
          [tenantId],
        );
        return newestAccountIfUnanimousEmail(rows);
```
Kopfkommentar der Methode entsprechend nachziehen (heute steht dort „>1 (mehrdeutig) → null" — nach dem Edit falsch, C2).

**Sicherheits-Einordnung (kein `PLAN-SECURITY.md`-Eintrag nötig):** kein Auth-Pfad, kein Gate. Alle Aufrufer (`self-service-routes.js` Prefill + Newsletter-Duplikatprüfung, `mail-summary.js`, `mail-not-placed.js`, `cancellation-mail.js`) nutzen das Ergebnis als Empfänger-/Anzeigeadresse. Unter der Einstimmigkeitsregel ist die zurückgegebene Adresse identisch mit der jeder anderen Zeile — es entsteht **keine neue Empfängerklasse**.

---

## 5. Tests

### Neu: `test/cl1-cancel-lockout.test.js` (B1/B2 + Spec-Tests 1–4)
Zwei Ebenen, offline (F.I.R.S.T.), Muster `312k-p1-cancel-scheduled.test.js` + `312k-p3-self-service-cancel.test.js`:

1. `interpretStripeEvent(deleted)` → `action=SUSPEND`, `suspendReason=SUBSCRIPTION_DELETED`; `interpretStripeEvent(payment_failed)` → `PAYMENT_FAILED`.
2. **Spec-Test 1** `applyStripeWebhook(deleted)` mit aufzeichnenden Fakes (`tenantSubscription` liefert eine gesetzte `subscriptionId`) → `setStatus(suspended)` **und** genau ein `setTenantSubscription(tenant, { subscriptionId: null })`; **kein** `planSlug`/`cancelAtPeriodEnd` im Patch.
3. **Spec-Test 2** `applyStripeWebhook(payment_failed)`, gleicher Fake → `setStatus(suspended)`, `calls.subscription` **leer** (Doppelabbuchungs-Schutz).
4. Store-Roundtrip über `state-ops`: `setTenantSubscription(s, t, { subscriptionId: null })` → `tenantSubscription(s, t).subscriptionId === null`, `planSlug` unverändert (beweist, dass der Setter `null` trägt).
5. Idempotenz: zweites `deleted` (anderes `event.id`) → kein zweiter Patch (Referenz bereits leer → `clearSubscriptionReference` No-Op).
6. **Spec-Tests 3+4, Routen-Ebene** (pglite + express, echter Store, echte Routen — Harness aus `bk2-checkout-return-plan.test.js`): Tenant mit Abo seeden → `applyStripeWebhook(deleted)` gegen den **echten** Store-Facade → `POST /api/self-service/billing/setup-checkout {plan:"starter"}` antwortet **200** (nicht 409). Gegenprobe: derselbe Aufbau mit `payment_failed` → **409 `already_subscribed`**.

### Neu: `test/cl1-b3-stale-subscription-reconcile.test.js` (Spec-Test 5)
Reine Units mit Fake-Store/Fake-Billing (kein Netz):
- Selektor: `{Abo + suspended}` drin, `{Abo + active}` draußen, `{kein Abo + suspended}` draußen.
- Stripe `canceled` + `apply:true` → genau ein `setTenantSubscription(t,{subscriptionId:null})`, Report `cleared`.
- Stripe `active` (lebendes Abo) → **kein** Schreibaufruf, Report `alive`.
- `incomplete_expired` → `cleared`.
- `status: null` (Feld fehlt) → **kein** Schreibaufruf.
- Trockenlauf (Default): Kandidat steht im Report `cleared`, Schreibaufrufe **0**.
- `retrieveSubscription` wirft → kein Schreibaufruf, `errors.length === 1`, Lauf endet regulär (kein Wurf).

### Neu: `test/cl1-b4-plan-choice-exit.test.js` (B4)
Fake-`els` (schlichte Objekte) + Mini-Fake-`doc` (`createElement` → `{ dataset:{}, append(){} }`, das reicht für `el()`/`planTiles`) — keine neue Dependency:
- `dismissPlanChoice(els)` → `els.skip.hidden === true` **und** `els.restore.hidden === false` („kein Zustand ohne Bedienelement").
- `renderPlanChoice(fakeDoc, els)` → `skip.hidden === false`, `restore.hidden === true` (die beiden schließen einander aus).
- Zyklus `render → dismiss → render` stellt Titel/Untertitel und Kacheln wieder her.

### Angepasst: `test/web-auth-pg.test.js` (Spec-Test 6, additiv)
- Reine Unit für `newestAccountIfUnanimousEmail`: `[]` → null; eine Zeile → sie selbst; zwei Zeilen **gleicher** Email → die erste (jüngste); zwei Zeilen **unterschiedlicher** Email → null.
- pglite-Integration: zwei `account`-Zeilen auf `t_u1` mit **derselben** Email; `created_at` per `db.query("UPDATE account SET created_at = $1 WHERE sub = $2")` auf feste Werte setzen (deterministisch, nicht auf `now()`-Auflösung verlassen) → `accountByTenant("t_u1")` liefert den **jüngeren** sub.
- Der Bestandsfall im vorhandenen Test (`u1@x` vs. `u2@x`, unterschiedliche Emails → null) bleibt **unverändert grün** — keine Assertion-Änderung dort.

### Angepasst: `test/stripe-reconcile-sweep.test.js` (Pflicht, sonst rot)
Der `fakeStore` dort liefert eine **truthy** `subscriptionId` und fährt ein echtes `deleted` durch `applyStripeWebhookSerialized` → die neue Schreibkante wird erreicht. Ein Seam ergänzen:
```js
    setTenantSubscription: (tenantId, patch) => {
      const t = findTenant(tenantId);
      if (t && patch.subscriptionId !== undefined) t.stripeSubscriptionId = patch.subscriptionId;
      return t ?? null;
    },
```
Bestehende Assertions bleiben unverändert.

### Angepasst: `test/312k-p1-cancel-scheduled.test.js` (nur Namen/Kommentar, C2)
Alle drei Assertions dort bleiben **grün** (ihr Fake meldet keine gespeicherte `subscriptionId` → `clearSubscriptionReference` ist No-Op). Der Testname „SUSPEND patcht keine Abo-Felder — unveraendert durch diese Phase" behauptet nach CL1 aber etwas Falsches. Umbenennen auf: `"312k-P1 Test 3: customer.subscription.deleted bleibt SUSPEND (kein gespeichertes Abo -> nichts zu entwerten, s. CL1-B2)"` — keine Assertion-Änderung.

> **Nicht angepasst und weiterhin grün** (am Fake geprüft): `w5-billing-revoke`, `p3-payment-webhook`, `312k-p4-contract-end-cleanup`, `stripe-webhook-race`, `stripe-webhook-signature` — deren Fake-Stores liefern keine gespeicherte `subscriptionId`, die neue Kante ist dort No-Op.

---

## 6. Deterministisch prüfbares Ergebnis

```bash
# 1. Syntax jeder berührten JS-Datei
node --check src/billing/webhook.js
node --check src/billing/subscribe.js
node --check src/billing/stale-subscription-reconcile.js
node --check src/store/state-ops.js
node --check src/web-auth.js
node --check scripts/reconcile-stale-subscriptions.js
node --check apps/web/src/lib/subscribe.js
node --check apps/web/src/lib/i18n.js
# erwartet: keine Ausgabe, Exit 0 (je Datei)

# 2. Neue Tests einzeln (schneller Fokus-Lauf)
node --test test/cl1-cancel-lockout.test.js test/cl1-b3-stale-subscription-reconcile.test.js \
            test/cl1-b4-plan-choice-exit.test.js test/web-auth-pg.test.js
# erwartet: "# fail 0", Exit 0

# 3. Vollständige Regressionssuite (einmal am Ende)
npm test
# erwartet: Exit 0, "# fail 0"; Testzahl = Bestand + neue Faelle (keine Bank-Verschiebung:
# kein neuer Test traegt ein Katalog-Praefix (^(DID|E2E|FMT|GAP|...)-[0-9]) oder ABNAHME-)
npm run test:gates
# erwartet: unveraendert zum Stand vor der Phase (CL1 legt keinen Katalogtest an)

# 4. Trockenlauf des Bestandsheilers, lokal (json-Backend)
node scripts/reconcile-stale-subscriptions.js
# erwartet exakt: "[stale-subs] json-Backend: No-Op (keine Bestandsdaten lokal)." Exit 0

# 5. Smoke lokal
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start &
curl -s -o /dev/null -w '%{http_code}\n' localhost:3999/healthz                      # 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:3999/api/self-service/state       # 401 (ohne Session, fail-closed)
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3999/api/self-service/billing/setup-checkout  # 401
```

**Fachliche Abnahme (der eigentliche Beweis, in `test/cl1-cancel-lockout.test.js` automatisiert):**
`deleted` → `status=suspended` **und** `subscriptionId === null` **und** `setup-checkout` ≠ 409 · `payment_failed` → `subscriptionId` unverändert **und** `setup-checkout` = 409 `already_subscribed`.

---

## 7. Blast-Radius

| Datei | Art |
|---|---|
| `src/billing/webhook.js` | 6 Edits (Import, Konstante, 2 Interpretations-Zweige, Destrukturierung, SUSPEND-Zweig) |
| `src/billing/subscribe.js` | +1 exportierte Funktion (Lesekante unverändert) |
| `src/billing/stale-subscription-reconcile.js` | **neu** |
| `src/store/state-ops.js` | +1 reiner Selektor |
| `src/web-auth.js` | +1 reines Prädikat, `accountByTenant`-Query + Rückgabe |
| `scripts/reconcile-stale-subscriptions.js` | **neu** |
| `package.json` | +1 npm-Script |
| `apps/web/src/lib/subscribe.js` | 2 Funktionen (je +1 Zeile) + Kommentare |
| `apps/web/src/lib/i18n.js` | +2 Zeilen (EN/DE) |
| `apps/web/src/pages/app/index.astro` | +1 Knopf, +1 `els`-Feld, +1 Listener |
| Tests | 3 neu, 3 angepasst (1× Seam, 1× additiv, 1× Name) |

**Unangetastet:** `hasActiveSubscription` (kein Umbau auf `status`), das active-only-Gate von `approve`, kein `closed`-Status, kein Billing-Portal, keine neue Route, keine neue Env-Variable, keine neue npm-Dependency, kein Safety-Gate, kein Auth-Pfad, `disclosureSentence` unberührt.