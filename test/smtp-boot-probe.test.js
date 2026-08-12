// smtp-boot-probe: seit bfb5dfc verschickt der Dienst Kuendigungsbestaetigungen per SMTP
// (smtp-mail.js/billing/cancellation-mail.js), bewusst fail-soft - ein Fehlschlag bleibt
// nur am Tenant vermerkt und wird vom Sweep wiederholt. Genau daraus entsteht eine blinde
// Stelle: falsche Zugangsdaten oder eine beim Anbieter nicht verifizierte Absenderadresse
// lassen JEDEN Versuch lautlos scheitern. probeSmtpBoot schliesst die Luecke mit EINER
// Zeile beim Start (Muster test/al-p16-boot-probes.test.js + test/312k-p5-cancellation-
// mail.test.js: fakeLogger, injizierter _nodemailer statt echtem Netzwerk).
import { test } from "node:test";
import assert from "node:assert/strict";
import { probeSmtpBoot } from "../src/smtp-mail.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { startServer, waitForLog } from "./helpers.js";

function fakeLogger() {
  const logLines = [];
  const errorLines = [];
  return {
    logLines,
    errorLines,
    log: (m) => logLines.push(String(m)),
    logError: (m) => errorLines.push(String(m)),
  };
}

// Fake nodemailer (DIP-Seam, Muster _nodemailer in smtp-mail.js/312k-p5-cancellation-
// mail.test.js): verify() loest nach dem uebergebenen Ausgang auf, OHNE Netzwerk. Zeichnet
// auf, mit welchen createTransport-Optionen aufgerufen wurde (Pflichttest 1: kein
// Verbindungsversuch, wenn nicht konfiguriert).
function fakeNodemailer({ verify }) {
  const createTransportCalls = [];
  return {
    createTransportCalls,
    createTransport(opts) {
      createTransportCalls.push(opts);
      return { verify };
    },
  };
}

function mailConfig(over = {}) {
  return withConfigNamespaces({
    smtpHost: "",
    smtpPort: 465,
    smtpUser: "",
    smtpPassword: "",
    mailFrom: "",
    ...over,
  });
}

const SECRET_PASSWORD = "sk_smtp_should_never_leak_zoho9x";
const HOST = "smtp.zoho.eu";
const PORT = 465;
const FROM = "kuendigung@sundartha.example";

// ======================================================================================
// Pflichttest 1: nicht konfiguriert -> Meldung, KEIN Verbindungsversuch
// ======================================================================================

test("Pflichttest 1: SMTP nicht konfiguriert -> Meldung, kein Verbindungsversuch", async () => {
  const _nodemailer = fakeNodemailer({ verify: async () => true });
  const { log, logError, logLines, errorLines } = fakeLogger();

  await probeSmtpBoot(mailConfig(), { _nodemailer, log, logError });

  assert.equal(_nodemailer.createTransportCalls.length, 0, "kein Transporter gebaut, kein Verbindungsversuch");
  assert.equal(logLines.length, 1);
  assert.equal(errorLines.length, 0);
  assert.match(logLines[0], /^\[smtp\] nicht konfiguriert \(SMTP_HOST fehlt\)/);
  assert.match(logLines[0], /vermerkt/);
  assert.match(logLines[0], /Sweep/);
});

// ======================================================================================
// Pflichttest 2: konfiguriert, Pruefung erfolgreich -> Erfolgsmeldung
// ======================================================================================

test("Pflichttest 2: SMTP konfiguriert und Verify gelingt -> Erfolgsmeldung mit Host/Port/Absender", async () => {
  const _nodemailer = fakeNodemailer({ verify: async () => true });
  const { log, logError, logLines, errorLines } = fakeLogger();

  await probeSmtpBoot(
    mailConfig({ smtpHost: HOST, smtpPort: PORT, smtpUser: "kuendigung@sundartha.example", smtpPassword: SECRET_PASSWORD, mailFrom: FROM }),
    { _nodemailer, log, logError },
  );

  assert.equal(_nodemailer.createTransportCalls.length, 1, "genau EIN Verbindungsversuch");
  assert.equal(errorLines.length, 0);
  assert.equal(logLines.length, 1);
  assert.equal(
    logLines[0],
    `[smtp] konfiguriert (host=${HOST}:${PORT}, from=${FROM}) - Verbindung/Anmeldung ok`,
  );
});

// ======================================================================================
// Pflichttest 3: konfiguriert, Pruefung scheitert -> Meldung mit Fehlercode, Start laeuft
// trotzdem durch (die Boot-Sonde wirft nie)
// ======================================================================================

test("Pflichttest 3: SMTP konfiguriert und Verify scheitert -> Meldung mit Fehlercode, kein Wurf", async () => {
  const authError = new Error(
    `535 authentication failed for user kuendigung@sundartha.example with password ${SECRET_PASSWORD}`,
  );
  authError.code = "EAUTH";
  const _nodemailer = fakeNodemailer({
    verify: async () => {
      throw authError;
    },
  });
  const { log, logError, logLines, errorLines } = fakeLogger();

  // Wirft NICHT - genau das ist die Randbedingung "Start darf niemals daran scheitern".
  await assert.doesNotReject(
    probeSmtpBoot(
      mailConfig({ smtpHost: HOST, smtpPort: PORT, smtpUser: "u", smtpPassword: SECRET_PASSWORD, mailFrom: FROM }),
      { _nodemailer, log, logError },
    ),
  );

  assert.equal(logLines.length, 0, "kein Erfolgs-Log bei Fehlschlag");
  assert.equal(errorLines.length, 1);
  assert.equal(
    errorLines[0],
    `[smtp] konfiguriert (host=${HOST}:${PORT}, from=${FROM}) - Verbindung/Anmeldung fehlgeschlagen (code=EAUTH, name=Error)`,
  );
});

test("Pflichttest 3b: Fehler ohne .code -> Platzhalter statt Wurf/Absturz", async () => {
  const bareError = new Error(`connect refused with password ${SECRET_PASSWORD}`);
  const _nodemailer = fakeNodemailer({
    verify: async () => {
      throw bareError;
    },
  });
  const { logError, errorLines } = fakeLogger();

  await probeSmtpBoot(mailConfig({ smtpHost: HOST, smtpPort: PORT, mailFrom: FROM }), {
    _nodemailer,
    log: () => {},
    logError,
  });

  assert.equal(errorLines.length, 1);
  assert.match(errorLines[0], /code=\?/);
  assert.match(errorLines[0], /name=Error/);
});

// ======================================================================================
// Pflichttest 4: in KEINER Log-Ausgabe steht das Passwort
// ======================================================================================

test("Pflichttest 4: das SMTP-Passwort erscheint in keiner Zeile - weder bei Erfolg noch bei Fehlschlag", async () => {
  const passwordLeakingError = new Error(
    `535 authentication failed for user kuendigung@sundartha.example with password ${SECRET_PASSWORD} to smtp.zoho.eu`,
  );
  passwordLeakingError.code = "EAUTH";

  for (const verify of [
    async () => true,
    async () => {
      throw passwordLeakingError;
    },
  ]) {
    const _nodemailer = fakeNodemailer({ verify });
    const { log, logError, logLines, errorLines } = fakeLogger();
    await probeSmtpBoot(
      mailConfig({ smtpHost: HOST, smtpPort: PORT, smtpUser: "u", smtpPassword: SECRET_PASSWORD, mailFrom: FROM }),
      { _nodemailer, log, logError },
    );
    const all = [...logLines, ...errorLines].join("\n");
    assert.doesNotMatch(all, new RegExp(SECRET_PASSWORD), "kein Passwort im Log");
  }
});

test("Pflichttest 4b: err.message (kann Nutzer/Adresse tragen) landet nie im Log, nur code/name", async () => {
  // Absichtlich EINE andere Adresse als mailFrom (FROM) im err.message - from=FROM ist
  // erlaubtes Betriebsdatum (Regel 4 erlaubt die Absenderadresse explizit); die hier
  // "geleakte" Adresse ist eine FREMDE, die NIRGENDS erscheinen darf.
  const err = new Error(`geheime Details ueber leak-user@other-domain.example und ${SECRET_PASSWORD}`);
  err.code = "ETIMEDOUT";
  const _nodemailer = fakeNodemailer({
    verify: async () => {
      throw err;
    },
  });
  const { logError, errorLines } = fakeLogger();

  await probeSmtpBoot(mailConfig({ smtpHost: HOST, smtpPort: PORT, mailFrom: FROM }), {
    _nodemailer,
    log: () => {},
    logError,
  });

  assert.equal(errorLines.length, 1);
  assert.doesNotMatch(errorLines[0], /geheime Details/);
  assert.doesNotMatch(errorLines[0], /leak-user@other-domain\.example/);
  assert.doesNotMatch(errorLines[0], new RegExp(SECRET_PASSWORD));
  assert.match(errorLines[0], /code=ETIMEDOUT/);
});

// ======================================================================================
// Boot-Integration: der echte Prozess druckt genau eine Sonden-Zeile, in beiden
// Zustaenden, und startet in beiden Faellen vollstaendig durch (Muster
// test/al-p16-boot-probes.test.js AL-P16-8/9).
// ======================================================================================

test("Boot-Integration: SMTP nicht konfiguriert (Auslieferungszustand) -> Sonden-Zeile, Boot laeuft durch", async () => {
  const srv = await startServer({});
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
    const hits = srv.stdout.match(/\[smtp\] nicht konfiguriert \(SMTP_HOST fehlt\)/g);
    assert.equal(hits ? hits.length : 0, 1, `erwartet genau eine Sonden-Zeile:\n${srv.stdout}`);
  } finally {
    await srv.stop();
  }
});

test("Boot-Integration: SMTP konfiguriert, Server nicht erreichbar -> Fehlschlag-Zeile mit Code, Boot laeuft TROTZDEM durch", async () => {
  const srv = await startServer({
    env: {
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1", // kein Listener - schnelles ECONNREFUSED, keine echte Netzwerkabhaengigkeit
      SMTP_USER: "probe-test@example.test",
      SMTP_PASSWORD: "smtp-boot-probe-test-password-should-not-leak",
      MAIL_FROM: "probe-test@example.test",
    },
  });
  try {
    // Der Boot selbst haengt NICHT an der Sonde - /healthz antwortet, obwohl der
    // Verbindungsversuch im Hintergrund noch laeuft oder schon gescheitert ist.
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);

    await waitForLog(srv, /\[smtp\] konfiguriert .* Verbindung\/Anmeldung fehlgeschlagen \(code=/);
    assert.doesNotMatch(
      srv.stdout,
      /smtp-boot-probe-test-password-should-not-leak/,
      "kein Passwort im echten Boot-Log",
    );
  } finally {
    await srv.stop();
  }
});
