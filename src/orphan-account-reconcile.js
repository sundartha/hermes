// CL2: Abgleich verwaister account-Zeilen gegen WorkOS.
//
// Das Problem, das dieser Lauf schliesst: das Vertragsende nach einer Kuendigung loescht die
// WorkOS-Identitaet des Kunden (312k-Phase 4), laesst ihre account-Zeile aber stehen. Der
// Tenant bleibt bewusst 'suspended' (geparkt, Owner-Entscheidung: ein neues Abo reaktiviert
// denselben Tenant samt Historie). Meldet sich der Kunde danach an, gibt WorkOS ihm eine NEUE
// Identitaet, und resolveOrCreateTenant haengt sie als ZUSAETZLICHE Zeile an denselben Tenant.
// Pro Rueckkehr waechst die Zeilenzahl um eins; in Produktion gemessen: drei Zeilen derselben
// Adresse auf einem Tenant, zwei davon zu bei WorkOS geloeschten Identitaeten.
// Der eigentliche Schaden ist nicht der Datenmuell, sondern tenant.idp_subject: er zeigt
// weiter auf die AELTESTE, laengst geloeschte Identitaet. Das naechste Vertragsende loescht
// damit einen Geist (404 zaehlt dort als Erfolg) und laesst die LEBENDE Identitaet stehen -
// eine nicht erfuellte Loeschpflicht, die niemandem auffaellt.
//
// WARUM NICHT IM LOGIN-PFAD (der naheliegende Ort, bewusst verworfen): dort ist nicht
// entscheidbar, welche Zeile tot ist. Das System laesst mehrere lebende subs derselben
// Adresse auf einem Tenant ausdruecklich zu und pinnt das (test/tenant-prolif-b.test.js:
// "gemergter sub2 loest kanonisch auf") - ein Abraeumen nach Adresse wuerde dort eine LEBENDE
// Identitaet aus der Aufloesung werfen. Nur eine echte Rueckfrage beim Identitaetsanbieter
// beantwortet "tot oder lebendig", und die gehoert nicht in den Anmeldeweg (Latenz, neue
// Fehlerquelle). Muster: billing/stale-subscription-reconcile.js fragt aus demselben Grund
// aktiv bei Stripe nach, statt aus dem lokalen Zustand zu raten.
//
// Muster ebendaher: testbarer Kern (alle IO-Naehte injiziert), Trockenlauf als Default,
// strukturierter, PII-freier Report. Das Skript daneben (scripts/reconcile-orphan-accounts.js)
// ist nur Verdrahtung.

// Report-Gruende (kein Magic-String, G25).
export const ORPHAN_OUTCOME = Object.freeze({
  DROPPED: "dropped", // Identitaet bei WorkOS weg -> Zeile entfernt (nur bei apply)
  ALIVE: "alive", // Identitaet lebt -> Zeile bleibt
  KEPT_LAST: "kept_last", // tot, aber die letzte Zeile des Tenants -> bleibt (s.u.)
  LOOKUP_FAILED: "lookup_failed", // WorkOS unerreichbar -> Tenant unveraendert (fail-closed)
  ANCHOR_FIXED: "anchor_fixed", // idp_subject auf eine lebende Identitaet nachgezogen
});

// Gruppiert die flache Zeilenliste nach Tenant. Reihenfolge der Zeilen bleibt (created_at
// aufsteigend, s. accountsForOrphanReconcile) - die JUENGSTE ist damit die letzte.
function groupByTenant(rows) {
  const byTenant = new Map();
  for (const row of rows) {
    const entry = byTenant.get(row.tenantId) || { tenantId: row.tenantId, idpSubject: row.idpSubject, accounts: [] };
    entry.accounts.push({ sub: row.sub, email: row.email });
    byTenant.set(row.tenantId, entry);
  }
  return [...byTenant.values()];
}

// Klassifiziert die Zeilen EINES Tenants gegen WorkOS. Bewusst erst alles fragen, dann
// entscheiden: faellt eine einzige Abfrage aus, ist unbekannt, wie viele lebende Zeilen der
// Tenant hat - und genau davon haengt ab, ob eine Loeschung die LETZTE Zeile traefe. Deshalb
// bricht der erste Fehler die Klassifizierung des ganzen Tenants ab (fail-closed).
async function classifyAccounts(tenant, workos, logger) {
  const living = [];
  const dead = [];
  for (const account of tenant.accounts) {
    try {
      const exists = await workos.userExists(account.sub);
      (exists ? living : dead).push(account);
    } catch (err) {
      // PII-frei (Regel 4): interne Tenant-id + Adapter-Meldung (nur HTTP-Status), nie
      // Adresse oder subject.
      logger.warn(`[orphan-accounts] Abfrage fehlgeschlagen tenant=${tenant.tenantId}: ${err.message}`);
      return { lookupFailed: true, living: [], dead: [] };
    }
  }
  return { lookupFailed: false, living, dead };
}

// Teilt die toten Zeilen in "darf weg" und "muss bleiben". Die harte Grenze: es bleibt IMMER
// mindestens eine Zeile stehen. account.email ist der einzige Email-Anker am Tenant (kein
// tenantByEmail-Pfad im Code) - faellt die letzte Zeile, findet der naechste Login den Tenant
// nicht mehr und legt einen leeren neuen an: ohne Gespraechshistorie und ohne
// stripe_customer_id, waehrend Stripe den alten Kunden weiterfuehrt. Ein Tenant, dessen
// saemtliche Identitaeten geloescht sind, behaelt deshalb seine aelteste Zeile - sichtbar als
// kept_last, nicht stillschweigend.
function splitDroppable(living, dead) {
  if (living.length > 0) return { droppable: dead, kept: [] };
  return { droppable: dead.slice(1), kept: dead.slice(0, 1) };
}

// Waehlt den neuen Identitaetsanker, falls der bisherige auf keine ueberlebende Zeile mehr
// zeigt. Bevorzugt eine LEBENDE Identitaet; existiert keine, die behaltene - dann ist der
// Anker zumindest wieder an eine vorhandene Zeile gebunden statt ins Leere zu zeigen.
// null = kein Nachzug noetig.
function nextAnchor(survivors, idpSubject) {
  if (survivors.length === 0) return null;
  if (survivors.some((account) => account.sub === idpSubject)) return null;
  return survivors[survivors.length - 1];
}

// Verarbeitet EINEN Tenant und schreibt das Ergebnis in den Report. Ausgelagert, damit der
// Lauf darueber nur noch die Schleife ist (eine Entscheidungsebene je Funktion).
async function reconcileTenant({ tenant, accounts, workos, apply, logger, report }) {
  const { lookupFailed, living, dead } = await classifyAccounts(tenant, workos, logger);
  if (lookupFailed) {
    report.errors.push({ tenantId: tenant.tenantId, reason: ORPHAN_OUTCOME.LOOKUP_FAILED });
    return;
  }
  for (const account of living) report.alive.push({ tenantId: tenant.tenantId, sub: account.sub });

  const { droppable, kept } = splitDroppable(living, dead);
  for (const account of kept) report.keptLast.push({ tenantId: tenant.tenantId, sub: account.sub });
  for (const account of droppable) {
    report.dropped.push({ tenantId: tenant.tenantId, sub: account.sub });
    if (apply) await accounts.dropAccount(account.sub);
  }

  const anchor = nextAnchor([...living, ...kept], tenant.idpSubject);
  if (!anchor) return;
  report.anchors.push({
    tenantId: tenant.tenantId,
    sub: anchor.sub,
    previous: tenant.idpSubject ?? null,
  });
  if (apply) await accounts.setIdpSubject(tenant.tenantId, anchor.sub);
}

// Ein Lauf. apply=false (Default) fragt und berichtet, schreibt aber NICHTS.
// Wirft NIE pro Tenant: ein unerreichbares WorkOS darf den Lauf nicht reissen.
export async function reconcileOrphanAccounts({ accounts, workos, apply = false, logger = console }) {
  const tenants = groupByTenant(await accounts.accountsForOrphanReconcile());
  const report = { apply, scanned: tenants.length, dropped: [], alive: [], keptLast: [], anchors: [], errors: [] };
  for (const tenant of tenants) {
    await reconcileTenant({ tenant, accounts, workos, apply, logger, report });
  }
  return report;
}
