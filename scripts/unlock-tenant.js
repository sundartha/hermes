#!/usr/bin/env node
// Notausgang fuer einen ausgesperrten Betreiber: setzt EINEN Tenant auf active und loescht
// seinen Grace-Anker suspended_at - exakt die beiden Effekte des Admin-Handlers
// POST /api/admin/tenants/:id/approve (src/web-auth.js), nur ohne dessen Web-Gate.
//
// WARUM BEWUSST KEIN Netz-Endpunkt (Muster erase-tenant.js: Safety vor Features): der
// approve-Handler haengt selbst hinter webAuthMw, und das ist ein active-only-Gate. Ist der
// einzige Admin selbst suspended - der Normalzustand direkt nach dem Erst-Login
// (upsertOnFirstLogin legt suspended an) und erneut nach jedem invoice.payment_failed -
// antwortet ihm sein eigener Notausgang 403: er ist aus dem Ausgang ausgesperrt. Das Gate
// dafuer zu oeffnen vergroesserte die Angriffsflaeche JEDES Deployments dauerhaft, damit ein
// seltener Betriebsfall bequemer wird. Dieses Skript loest denselben Fall mit dem
// kleinstmoeglichen Schluessel: es verlangt DATABASE_URL (STORE_BACKEND=pg) - einen Faktor,
// den ein gesperrter Kunde nie besitzt, waehrend der Betreiber ihn ohnehin hat.
//
// Trockenlauf ist Default; --apply schreibt (Muster reconcile-stale-subscriptions.js).
// Aufruf: node scripts/unlock-tenant.js <tenantId> [--apply]
import { config } from "../src/config.js";
import * as store from "../src/store.js";
import { TENANT_STATUS } from "../src/store/defaults.js";
import { makeAccounts } from "../src/web-auth.js";
import { makeAuditStore } from "../src/audit-store.js";
import { createPortalRunner } from "../src/portal-pool.js";

// Audit-Identitaet des Notausgangs (G25: benannte Quelle statt Magic-String). BEWUSST ein
// EIGENER action-Wert statt des tenant_approve des Handlers: die beiden Ereignisse sind
// fachlich gleich, forensisch aber nicht - hinter tenant_approve steht immer eine
// authentifizierte Admin-Session (actorSub = req.tenant.sub), hinter dieser Zeile steht NUR
// DB-Zugriff und gar keine Session. Wer das Log liest, muss "am Web-Gate vorbei entsperrt"
// auf einen Blick von "Admin hat im Panel freigegeben" unterscheiden koennen (Muster
// release-reconcile.js: derselbe Release-Kern, getrennte Actor-Werte je Ausloeser).
// audit_log.action ist freies TEXT ohne CHECK -> kein Schema-Eingriff noetig.
const AUDIT_ACTOR = "system:unlock-tenant";
const AUDIT_ACTION = "tenant_unlock_cli";

const tenantId = process.argv[2];
const apply = process.argv.includes("--apply");

// fail-closed: ohne tenantId wird nichts gelesen und nichts geschrieben (Muster
// grant-admin.js/erase-tenant.js) - ein Skript, das ohne Ziel "irgendetwas" entsperrt,
// waere genau der Unfall, den der Notausgang verhindern soll.
if (!tenantId) {
  console.error("Aufruf: node scripts/unlock-tenant.js <tenantId> [--apply]");
  console.error("Setzt den Tenant auf active und loescht den Grace-Anker suspended_at.");
  console.error("Ohne --apply: Trockenlauf, zeigt nur den Ist-Zustand.");
  process.exit(1);
}

// Tenant-Status und Accounts sind ein pg-Konzept (accounts.setStatus schreibt die
// tenant-Zeile). Im json-Pfad gibt es weder account-Tabelle noch audit_log -> lauter Abbruch
// statt eines Laufs, der lokal "erfolgreich" meldet und am realen Lockout nichts aendert
// (Muster grant-admin.js; fail-closed, kein falscher Erfolg).
if (config.store.storeBackend !== "pg") {
  console.error(
    "[unlock-tenant] Tenant-Status/Accounts existieren nur im pg-Backend " +
      "(STORE_BACKEND=pg + DATABASE_URL). Im json-Pfad gibt es nichts zu entsperren.",
  );
  process.exit(1);
}

const runner = await createPortalRunner();
// makeAccounts ohne defaultCountry: das Signup-Geo betrifft nur upsertOnFirstLogin, dieses
// Skript nutzt ausschliesslich listTenants/setStatus (Muster grant-admin.js).
const accounts = makeAccounts(runner);
const audit = makeAuditStore(runner);

// EIN Ausgang fuer JEDEN Zweig, auch die Fehlerpfade: der Portal-Pool muss geschlossen
// werden, sonst haengt der Prozess am offenen Pool (Muster grant-admin.js). Der Store-Spiegel
// haelt zusaetzlich einen EIGENEN Pool, den die Fassade nicht herausgibt -> abschliessend
// process.exit statt sauberem Auslaufen (Muster reconcile-stale-subscriptions.js).
async function exitWith(code) {
  await runner._pool.end();
  process.exit(code);
}

// Status kommt aus der DB, nicht aus dem Spiegel: status ist das einzige accounts-owned Feld,
// das NIE geflusht wird (siehe ensureTenant in store/pg.js) - die tenant-Zeile ist die
// Autoritaet. listTenants ist genau die Sicht, die der Admin im Panel vor dem Klick sieht.
const tenant = (await accounts.listTenants()).find((row) => row.id === tenantId);
if (!tenant) {
  console.error(`[unlock-tenant] Tenant '${tenantId}' existiert nicht - nichts geaendert.`);
  await exitWith(1);
}

// Ist-Zustand aus dem hydrierten Spiegel (reine Queries, kein Write - der Trockenlauf bleibt
// wirklich trocken). Die Abo-Referenz wird NUR als gesetzt/nicht gesetzt gemeldet, nie im
// Klartext: der Notausgang ist ein Betriebswerkzeug, kein Kundendaten-Dump (Regel 4/5).
const suspendedAt = store.tenantSuspendedAt(tenantId);
const { subscriptionId, planSlug, cancelAtPeriodEnd } = store.tenantSubscription(tenantId);
console.log(`[unlock-tenant] mode=${apply ? "APPLY" : "DRY-RUN"} tenant=${tenantId}`);
console.log(
  `  status=${tenant.status} suspendedAt=${suspendedAt ?? "-"} ` +
    // mirrored: steht der Tenant im In-Memory-Spiegel dieses Prozesses? Steht er NICHT drin,
    // waere store.clearSuspendedAt ein stilles No-Op (fehlender Tenant -> changed:false) -
    // darum zieht der Apply-Pfad ihn unten per ensureTenant nach.
    `spiegel=${store.tenantExists(tenantId) ? "ja" : "nein"}`,
);
console.log(
  `  abo=${subscriptionId ? "gesetzt" : "KEINE"} plan=${planSlug ?? "-"} ` +
    `kuendigungZumPeriodenende=${cancelAtPeriodEnd ? "ja" : "nein"}`,
);

// Bereits active: kein Eingriff, kein Audit-Eintrag (idempotent, Muster approve-Handler, der
// bei einem aktiven Tenant denselben Endzustand herstellt). Exit 0 - das ist kein Fehler,
// der gewuenschte Zustand liegt bereits vor.
if (tenant.status === TENANT_STATUS.ACTIVE) {
  console.log("[unlock-tenant] bereits active - nichts zu tun.");
  await exitWith(0);
}

// closed wird VERWEIGERT. closed ist der dritte Wert in TENANT_STATUS (src/store/defaults.js)
// und bedeutet beendeter Vertrag, nicht Aussperrung: die Vertragsende-Aufraeumarbeiten geben
// die Rufnummer frei und loeschen die WorkOS-Identitaet (312k-Phase 4) - ein "entsperrter"
// closed-Tenant waere ein aktiver Datensatz ohne Nummer und ohne Login-Identitaet. Die
// Web-Seite zieht dieselbe Grenze: PENDING_ALLOWED_STATUS (web-auth.js) laesst suspended zur
// Selbst-Aktivierung durch, haelt closed aber HART gesperrt ("kein Reaktivieren"). Ein Skript,
// das diese eine Grenze aufweicht, waere die Luecke in genau der Wand - eine Wiederaufnahme
// ist ein Vertragsvorgang (neuer Abschluss), kein Notausgang.
if (tenant.status === TENANT_STATUS.CLOSED) {
  console.error(
    "[unlock-tenant] status=closed -> VERWEIGERT: beendeter Vertrag ist kein Lockout-Fall " +
      "(Nummer freigegeben, Identitaet geloescht). Wiederaufnahme = neuer Vertragsabschluss.",
  );
  await exitWith(1);
}

// Warnung in BEIDEN Modi (auch im Trockenlauf, damit der Betreiber sie VOR dem --apply liest):
// ohne Abo-Referenz schaltet die Entsperrung ein zahlungspflichtiges Produkt ohne Abo frei.
// Geprueft wird nur die LOKALE Referenz - ob das Abo bei Stripe wirklich lebt, klaert
// scripts/reconcile-stale-subscriptions.js; der Notausgang fragt bewusst keinen Provider
// (er muss auch dann laufen, wenn kein STRIPE_SECRET_KEY zur Hand ist).
if (!subscriptionId) {
  console.warn(
    "[unlock-tenant] WARNUNG: keine Abo-Referenz am Tenant - die Entsperrung gibt ein " +
      "zahlungspflichtiges Produkt OHNE Abo frei. Abo separat nachziehen.",
  );
}

if (!apply) {
  console.log(
    "[unlock-tenant] DRY-RUN: --apply wuerde status=active setzen, den Grace-Anker " +
      `suspended_at loeschen und eine ${AUDIT_ACTION}-Zeile ins audit_log schreiben.`,
  );
  await exitWith(0);
}

// ---- APPLY: dieselben Primitive wie der approve-Handler, KEIN rohes SQL ----------------
// 1) accounts.setStatus - der Handler-Schreibweg fuer den Tenant-Status. false = keine Zeile
//    getroffen (Race: zwischen listTenants und hier geloescht) -> fail-closed abbrechen,
//    BEVOR ein Audit-Eintrag eine Aenderung behauptet, die nicht stattgefunden hat.
const updated = await accounts.setStatus(tenantId, TENANT_STATUS.ACTIVE);
if (!updated) {
  console.error(`[unlock-tenant] Tenant '${tenantId}' beim Schreiben nicht getroffen - Abbruch.`);
  await exitWith(1);
}
// 2) ensureTenant VOR der Anker-Mutation. Der Handler laesst diesen Schritt bei approve aus
//    (nur suspend zieht den Spiegel nach) und kommt im Server-Prozess meist damit durch, weil
//    mintSession den Tenant beim Login schon in den Spiegel gelegt hat. Dieses Skript ist ein
//    EIGENER Prozess: sein Spiegel kennt nur, was init() hydriert hat. clearSuspendedAt ist
//    fail-soft (fehlender Tenant -> No-Op ohne throw) - ohne Nachzug wuerde der Anker also
//    LAUTLOS stehen bleiben und der DID-Release-Klassifizierer hielte den gerade entsperrten
//    Tenant weiter fuer einen Freigabe-Kandidaten (genau die Invariante 2, die approve wahrt).
//    ensureTenant ist idempotent, fail-safe und uebernimmt nur den realen DB-status.
await store.ensureTenant(tenantId);
// 3) Grace-Anker loeschen (Invariante 2) - derselbe Store-Primitiv wie im Handler.
store.clearSuspendedAt(tenantId);
// PFLICHT: pg-Flush abwarten. Der Prozess endet gleich per exit - ein nur angestossener
// Flush ginge sonst mit ihm verloren (Muster reconcile-stale-subscriptions/bootstrap-tenant).
await store.save();
// 4) Audit erst NACH der erfolgreichen Mutation (Muster Handler). detail traegt den
//    Vorher-Status - PII-frei und beantwortet spaeter "wovon wurde entsperrt".
await audit.record({
  actorSub: AUDIT_ACTOR,
  tenantId,
  action: AUDIT_ACTION,
  detail: `from=${tenant.status}`,
});

console.log(
  `[unlock-tenant] Tenant ${tenantId} entsperrt: status=${TENANT_STATUS.ACTIVE}, ` +
    `suspended_at geloescht, audit=${AUDIT_ACTION}.`,
);
await exitWith(0);
