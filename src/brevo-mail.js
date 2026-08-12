// Brevo-Mailversand (312k-Phase 5, HTTP-Fortsetzung): seit bfb5dfc verschickte der Dienst
// Kuendigungsbestaetigungen per SMTP (smtp-mail.js), was auf Render (kostenloser Web-
// Dienst) NICHT funktioniert - Render sperrt dort ausgehenden Verkehr auf allen SMTP-Ports
// (25/465/587); die Boot-Sonde meldete in Produktion ETIMEDOUT. Owner-Entscheidung: der
// kostenlose Plan bleibt, der Versand wechselt fuer Kuendigungsbestaetigungen auf eine HTTP-
// Schnittstelle ueber Port 443, den Render NICHT sperrt. Anbieter: Brevo (Frankreich, EU-
// Verarbeitung, kostenloses Kontingent von rund 300 Mails/Tag - fuer Kuendigungsbestaeti-
// gungen um Groessenordnungen ausreichend).
//
// Im Stil von workos-management.js: nacktes fetch, KEIN SDK, alles injiziert (DIP-Seam).
// Erfuellt DENSELBEN Port wie smtp-mail.js (mail/ports.js, nur sendMail({to,subject,text}))
// - der Aufrufer (billing/cancellation-mail.js attemptCancellationMailConfirm) unterscheidet
// die beiden Adapter nicht. SMTP bleibt bestehen (s. smtp-mail.js-Kopf) - sobald der Dienst
// auf einen bezahlten Plan wechselt, ist SMTP wieder die einfachere Wahl, ohne Codeaenderung
// (nur die Rangfolge in wiring/web-login.js entscheidet ueber die Env-Variablen).
//
// Absender AUSSCHLIESSLICH aus config.mail.mailFrom (dieselbe Quelle wie der SMTP-Adapter),
// NIE aus einem Request-Body. Niemals den Brevo-API-Key in eine Fehlermeldung schreiben
// (Regel 4 - Secret); bei einem Fehler wird NUR der HTTP-Status gelesen, NIE der
// Antwortkoerper (Brevo spiegelt bei 4xx gern die Anfrage - und damit die Empfaenger-
// adresse - zurueck, Muster research/adapters/exa-search.js "kein Body im Grund-Code").
const BREVO_API_BASE = "https://api.brevo.com/v3";

export function makeBrevoMailer(config, { _fetch = fetch } = {}) {
  return {
    // Verschickt EINE Text-Mail ueber den Brevo-Transactional-Endpunkt (POST /smtp/email,
    // trotz des Pfadnamens ein reiner HTTP/JSON-Aufruf, kein SMTP). Wirft bei einem
    // Provider-/Netzwerkfehler unveraendert weiter (der Aufrufer ist selbst fail-soft,
    // s. billing/cancellation-mail.js) - NIE hier schon einen Fehler verschlucken (sonst
    // gaelte eine gescheiterte Bestaetigung faelschlich als erledigt).
    async sendMail({ to, subject, text }) {
      const res = await _fetch(`${BREVO_API_BASE}/smtp/email`, {
        method: "POST",
        headers: {
          "api-key": config.mail.brevoApiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: config.mail.mailFrom },
          to: [{ email: to }],
          subject,
          textContent: text,
        }),
      });
      if (!res.ok) {
        // Bewusst KEIN res.text()/res.json() hier (s. Modulkopf) - die Fehlermeldung traegt
        // nur den HTTP-Status, damit weder Key noch Empfaengeradresse ueber einen
        // gespiegelten Provider-Fehlerkoerper leaken koennen.
        const err = new Error("brevo sendMail fehlgeschlagen");
        err.code = `http_${res.status}`;
        throw err;
      }
    },
  };
}

// ---- Boot-Sonde-Baustein (orchestriert von mail-boot-probe.js) -----------------------
// Reiner Verbindungs-/Auth-Test: GET /v3/account authentifiziert sich beim Anbieter,
// verschickt aber KEINE Mail (Muster transporter.verify() in smtp-mail.js). Wirft bei
// jedem Fehler (Netzwerk ODER Nicht-2xx) unveraendert weiter - der Aufrufer
// (probeMailBoot, mail-boot-probe.js) faengt es und loggt NUR err.code/err.name, NIE
// err.message (das kann Anbieter-/Kontodetails tragen, Regel 4).
export async function verifyBrevoAccount(config, { _fetch = fetch } = {}) {
  const res = await _fetch(`${BREVO_API_BASE}/account`, {
    headers: { "api-key": config.mail.brevoApiKey, accept: "application/json" },
  });
  if (!res.ok) {
    const err = new Error("brevo account check fehlgeschlagen");
    err.code = `http_${res.status}`;
    throw err;
  }
}
