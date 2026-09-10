// WorkOS-Management: Nutzer bei WorkOS loeschen (312k-Phase 4, Vertragsende nach
// Kuendigung). Im Stil von makeOidc (web-auth.js): nacktes fetch, KEIN SDK, alles
// injiziert (DI-Naht wie der gesamte heutige WorkOS-Zugriff). EIGENER Schluessel
// (WORKOS_MANAGEMENT_API_KEY, config.auth.workosManagementApiKey) - NICHT
// OIDC_CLIENT_SECRET: ob der Anmeldeschluessel ueberhaupt Loeschrechte hat, ist
// ungeklaert, und ein Anmeldeschluessel gehoert nicht auf einen Loeschpfad. Teilt sich
// workosApiBase mit makeOidc (dieselbe WorkOS-Umgebung, EIN Host fuer Login+Management).
// Niemals den API-Key oder die Nutzer-Kennung (subject) loggen.
// "gibt es nicht (mehr)" - der Regelfall nach einem Vertragsende, kein Fehler (G25).
const HTTP_NOT_FOUND = 404;

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

    // Existenzpruefung EINER WorkOS-Identitaet (CL2: Abgleich verwaister account-Zeilen).
    // Gegenstueck zu deleteUser und bewusst getrennt davon: der Abgleich darf NIE loeschen,
    // er liest nur. 404 = die Identitaet gibt es nicht mehr (der Regelfall nach einem
    // Vertragsende); 200 = sie lebt. Jeder ANDERE Status wirft - der Aufrufer wertet das
    // fail-closed als "unbekannt" und laesst die Zeile stehen. Ein Netzfehler darf nie als
    // "tot" durchgehen, sonst raeumte ein kurzer WorkOS-Ausfall lebende Identitaeten ab.
    // Wie deleteUser: nur der HTTP-Status reist in die Meldung, nie Schluessel oder subject.
    async userExists(subject) {
      const response = await _fetch(`${usersEndpoint}/${encodeURIComponent(subject)}`, {
        headers: { Authorization: `Bearer ${config.auth.workosManagementApiKey}` },
      });
      if (response.status === HTTP_NOT_FOUND) return false;
      if (!response.ok) throw new Error(`workos_management userExists HTTP ${response.status}`);
      return true;
    },
  };
}
