// Konto-Zuordnung per E-Mail fuer das oeffentliche Kuendigungsformular (§ 312k BGB,
// billing/public-cancellation.js): der Kunde identifiziert sich OHNE Anmeldung ueber
// seine Konto-E-Mail. Eigene Datei statt einer weiteren Methode an makeAccounts
// (web-auth.js ist eine eingefrorene Riesendatei, tools/basis/riesendateien.json).
//
// Liefert die EINE tenant_id, an der diese Email haengt - sonst null: 0 Treffer ODER
// mehrere VERSCHIEDENE Tenants (nicht raten, fail-closed wie accountByTenant). Mehrere
// account-Zeilen desselben Tenants (CL1-B5, Rueckkehrer) sind KEINE Mehrdeutigkeit.
// Verglichen wird in der Speicherform von account.email (upsertOnFirstLogin legt die
// Email getrimmt und klein geschrieben ab - normalizeEmail tut genau das). account ist
// RLS-exempt wie die uebrigen account-Pfade.
import { normalizeEmail } from "./newsletter-recipients.js";

export function makeTenantByEmail(runner) {
  return async function tenantByEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return null;
    const { rows } = await runner.withClient((client) =>
      client.query(`SELECT DISTINCT tenant_id AS "tenantId" FROM account WHERE email = $1`, [
        normalizedEmail,
      ]),
    );
    return rows.length === 1 ? rows[0].tenantId : null;
  };
}
