// WorkOS-Management: Nutzer bei WorkOS loeschen (312k-Phase 4, Vertragsende nach
// Kuendigung). Im Stil von makeOidc (web-auth.js): nacktes fetch, KEIN SDK, alles
// injiziert (DI-Naht wie der gesamte heutige WorkOS-Zugriff). EIGENER Schluessel
// (WORKOS_MANAGEMENT_API_KEY, config.auth.workosManagementApiKey) - NICHT
// OIDC_CLIENT_SECRET: ob der Anmeldeschluessel ueberhaupt Loeschrechte hat, ist
// ungeklaert, und ein Anmeldeschluessel gehoert nicht auf einen Loeschpfad. Teilt sich
// workosApiBase mit makeOidc (dieselbe WorkOS-Umgebung, EIN Host fuer Login+Management).
// Niemals den API-Key oder die Nutzer-Kennung (subject) loggen.
export function makeWorkosManagement(config, { _fetch = fetch } = {}) {
  const usersEndpoint = `${config.auth.workosApiBase}/user_management/users`;

  return {
    // Loescht EINEN WorkOS-Nutzer (unwiderruflich). subject = die beim Login gebundene
    // WorkOS-Identitaet (idp_subject/user.id, s. store/state-ops.js tenantIdpSubject) -
    // NIE aus einem Request-Body (kein Spoofing). 404 (Nutzer bereits weg) zaehlt als
    // Erfolg (Idempotenz/Konvergenz, Muster Telnyx-DID-Release providerReleaseOrGone).
    // Jeder andere Fehlerstatus wirft; die Meldung traegt NUR den HTTP-Status (Stufe-1-
    // Fehlerbehandlung wie stripeBilling.scheduleCancellation - der Provider-Fehlerkoerper
    // wird bewusst NICHT gelesen, kein PII-Risiko ueber eine WorkOS-Fehlermeldung, Regel 4).
    async deleteUser(subject) {
      const r = await _fetch(`${usersEndpoint}/${encodeURIComponent(subject)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${config.auth.workosManagementApiKey}` },
      });
      if (r.status === 404) return { deleted: true, alreadyGone: true };
      if (!r.ok) throw new Error(`workos_management deleteUser HTTP ${r.status}`);
      return { deleted: true, alreadyGone: false };
    },
  };
}
