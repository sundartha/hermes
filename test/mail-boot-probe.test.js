import { test } from "node:test";
import assert from "node:assert/strict";
import { probeMailBoot } from "../src/mail-boot-probe.js";
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

function fakeFetch(response) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (typeof response === "function") return response();
    return response;
  };
  fn.calls = calls;
  return fn;
}

function mailConfig(over = {}) {
  return withConfigNamespaces({
    brevoApiKey: "",
    smtpHost: "",
    smtpPort: 465,
    smtpUser: "",
    smtpPassword: "",
    mailFrom: "",
    ...over,
  });
}

const SECRET_PASSWORD = "sk_smtp_should_never_leak_zoho9x";
const SECRET_API_KEY = "xkeysib-should-never-leak-brevo9x";
const HOST = "smtp.zoho.eu";
const PORT = 465;
const FROM = "kuendigung@sundartha.example";

test("Pflichttest 1: nichts konfiguriert -> Meldung, kein Verbindungsversuch", async () => {
  const _nodemailer = fakeNodemailer({ verify: async () => true });
  const _fetch = fakeFetch({ ok: true, status: 200 });
  const { log, logError, logLines, errorLines } = fakeLogger();

  await probeMailBoot(mailConfig(), { _nodemailer, _fetch, log, logError });

  assert.equal(_nodemailer.createTransportCalls.length, 0, "kein SMTP-Transporter gebaut");
  assert.equal(_fetch.calls.length, 0, "kein Brevo-Aufruf");
  assert.equal(logLines.length, 1);
  assert.equal(errorLines.length, 0);
  assert.equal(
    logLines[0],
    "[mail] nicht konfiguriert (weder BREVO_API_KEY noch SMTP_HOST gesetzt) - " +
      "Kuendigungsbestaetigungen bleiben offen vermerkt, ein spaeterer Sweep versucht sie erneut.",
  );
});

test("Pflichttest 2: nur SMTP konfiguriert, Verify gelingt -> SMTP-Erfolgsmeldung", async () => {
  const _nodemailer = fakeNodemailer({ verify: async () => true });
  const _fetch = fakeFetch({ ok: true, status: 200 });
  const { log, logError, logLines, errorLines } = fakeLogger();

  await probeMailBoot(
    mailConfig({ smtpHost: HOST, smtpPort: PORT, smtpUser: "u", smtpPassword: SECRET_PASSWORD, mailFrom: FROM }),
    { _nodemailer, _fetch, log, logError },
  );

  assert.equal(_nodemailer.createTransportCalls.length, 1, "genau EIN SMTP-Verbindungsversuch");
  assert.equal(_fetch.calls.length, 0, "kein Brevo-Aufruf");
  assert.equal(errorLines.length, 0);
  assert.equal(logLines.length, 1);
  assert.equal(logLines[0], `[mail] SMTP konfiguriert (host=${HOST}:${PORT}, from=${FROM}) - Verbindung/Anmeldung ok`);
});

test("Pflichttest 3: nur SMTP konfiguriert, Verify scheitert -> Fehlermeldung mit Code, kein Wurf", async () => {
  const authError = new Error(`535 authentication failed for user u with password ${SECRET_PASSWORD}`);
  authError.code = "EAUTH";
  const _nodemailer = fakeNodemailer({
    verify: async () => {
      throw authError;
    },
  });
  const { log, logError, logLines, errorLines } = fakeLogger();

  await assert.doesNotReject(
    probeMailBoot(mailConfig({ smtpHost: HOST, smtpPort: PORT, mailFrom: FROM }), { _nodemailer, log, logError }),
  );

  assert.equal(logLines.length, 0);
  assert.equal(errorLines.length, 1);
  assert.equal(
    errorLines[0],
    `[mail] SMTP konfiguriert (host=${HOST}:${PORT}, from=${FROM}) - Verbindung/Anmeldung fehlgeschlagen (code=EAUTH, name=Error)`,
  );
});

test("Pflichttest 3b: SMTP-Fehler ohne .code -> Platzhalter statt Wurf/Absturz", async () => {
  const bareError = new Error(`connect refused with password ${SECRET_PASSWORD}`);
  const _nodemailer = fakeNodemailer({
    verify: async () => {
      throw bareError;
    },
  });
  const { logError, errorLines } = fakeLogger();

  await probeMailBoot(mailConfig({ smtpHost: HOST, smtpPort: PORT, mailFrom: FROM }), {
    _nodemailer,
    log: () => {},
    logError,
  });

  assert.equal(errorLines.length, 1);
  assert.match(errorLines[0], /code=\?/);
  assert.match(errorLines[0], /name=Error/);
});

test("Pflichttest 4: Brevo konfiguriert, Account-Check gelingt -> Brevo-Erfolgsmeldung, kein SMTP-Zweig", async () => {
  const _nodemailer = fakeNodemailer({ verify: async () => true });
  const _fetch = fakeFetch({ ok: true, status: 200 });
  const { log, logError, logLines, errorLines } = fakeLogger();

  await probeMailBoot(mailConfig({ brevoApiKey: SECRET_API_KEY, mailFrom: FROM }), {
    _nodemailer,
    _fetch,
    log,
    logError,
  });

  assert.equal(_fetch.calls.length, 1, "genau EIN Brevo-Aufruf");
  assert.equal(_fetch.calls[0].url, "https://api.brevo.com/v3/account");
  assert.equal(_nodemailer.createTransportCalls.length, 0, "kein SMTP-Verbindungsversuch");
  assert.equal(errorLines.length, 0);
  assert.equal(logLines.length, 1);
  assert.equal(logLines[0], `[mail] Brevo (HTTP) konfiguriert (from=${FROM}) - Verbindung/Anmeldung ok`);
});

test("Pflichttest 4 (Rangfolge): BEIDE Kanaele konfiguriert -> Brevo hat Vorrang, SMTP-Transporter wird nie gebaut", async () => {
  const _nodemailer = fakeNodemailer({ verify: async () => true });
  const _fetch = fakeFetch({ ok: true, status: 200 });
  const { logLines } = fakeLogger();

  await probeMailBoot(
    mailConfig({ brevoApiKey: SECRET_API_KEY, smtpHost: HOST, smtpPort: PORT, mailFrom: FROM }),
    { _nodemailer, _fetch, log: (m) => logLines.push(String(m)), logError: () => {} },
  );

  assert.equal(_nodemailer.createTransportCalls.length, 0, "SMTP-Zweig darf bei gesetztem Brevo-Key nie laufen");
  assert.match(logLines[0], /^\[mail\] Brevo \(HTTP\)/);
});

test("Pflichttest 5: Brevo konfiguriert, Account-Check scheitert -> Fehlermeldung mit HTTP-Code, kein Wurf", async () => {
  const _fetch = fakeFetch({ ok: false, status: 401 });
  const { log, logError, logLines, errorLines } = fakeLogger();

  await assert.doesNotReject(
    probeMailBoot(mailConfig({ brevoApiKey: SECRET_API_KEY, mailFrom: FROM }), { _fetch, log, logError }),
  );

  assert.equal(logLines.length, 0);
  assert.equal(errorLines.length, 1);
  assert.equal(
    errorLines[0],
    `[mail] Brevo (HTTP) konfiguriert (from=${FROM}) - Verbindung/Anmeldung fehlgeschlagen (code=http_401, name=Error)`,
  );
});

test("Pflichttest 5b: Brevo-Netzwerkfehler ohne .code -> Platzhalter statt Wurf/Absturz", async () => {
  const _fetch = async () => {
    throw new Error(`connect refused, key=${SECRET_API_KEY}`);
  };
  const { logError, errorLines } = fakeLogger();

  await probeMailBoot(mailConfig({ brevoApiKey: SECRET_API_KEY, mailFrom: FROM }), {
    _fetch,
    log: () => {},
    logError,
  });

  assert.equal(errorLines.length, 1);
  assert.match(errorLines[0], /code=\?/);
  assert.match(errorLines[0], /name=Error/);
});

test("Pflichttest 6: SMTP-Passwort erscheint in keiner Zeile - weder bei Erfolg noch bei Fehlschlag", async () => {
  const passwordLeakingError = new Error(
    `535 authentication failed for user kuendigung@sundartha.example with password ${SECRET_PASSWORD} to smtp.zoho.eu`,
  );
  passwordLeakingError.code = "EAUTH";

  for (const verify of [async () => true, async () => { throw passwordLeakingError; }]) {
    const _nodemailer = fakeNodemailer({ verify });
    const { log, logError, logLines, errorLines } = fakeLogger();
    await probeMailBoot(
      mailConfig({ smtpHost: HOST, smtpPort: PORT, smtpUser: "u", smtpPassword: SECRET_PASSWORD, mailFrom: FROM }),
      { _nodemailer, log, logError },
    );
    const all = [...logLines, ...errorLines].join("\n");
    assert.doesNotMatch(all, new RegExp(SECRET_PASSWORD), "kein SMTP-Passwort im Log");
  }
});

test("Pflichttest 6b: Brevo-API-Key erscheint in keiner Zeile - weder bei Erfolg noch bei Fehlschlag", async () => {
  for (const _fetch of [
    fakeFetch({ ok: true, status: 200 }),
    async () => {
      const err = new Error(`unauthorized api-key=${SECRET_API_KEY}`);
      err.code = "http_401";
      throw err;
    },
  ]) {
    const { log, logError, logLines, errorLines } = fakeLogger();
    await probeMailBoot(mailConfig({ brevoApiKey: SECRET_API_KEY, mailFrom: FROM }), { _fetch, log, logError });
    const all = [...logLines, ...errorLines].join("\n");
    assert.doesNotMatch(all, new RegExp(SECRET_API_KEY), "kein Brevo-API-Key im Log");
  }
});

test("Pflichttest 6c: err.message (kann Nutzer/Adresse/Anbieterdetails tragen) landet nie im Log, nur code/name", async () => {
  const smtpErr = new Error(`geheime Details ueber leak-user@other-domain.example und ${SECRET_PASSWORD}`);
  smtpErr.code = "ETIMEDOUT";
  const _nodemailer = fakeNodemailer({
    verify: async () => {
      throw smtpErr;
    },
  });
  const { logError, errorLines } = fakeLogger();
  await probeMailBoot(mailConfig({ smtpHost: HOST, smtpPort: PORT, mailFrom: FROM }), {
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

test("Boot-Integration: nichts konfiguriert (Auslieferungszustand) -> Sonden-Zeile, Boot laeuft durch", async () => {
  const srv = await startServer({});
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
    const hits = srv.stdout.match(
      /\[mail\] nicht konfiguriert \(weder BREVO_API_KEY noch SMTP_HOST gesetzt\)/g,
    );
    assert.equal(hits ? hits.length : 0, 1, `erwartet genau eine Sonden-Zeile:\n${srv.stdout}`);
  } finally {
    await srv.stop();
  }
});

test("Boot-Integration: nur SMTP konfiguriert, Server nicht erreichbar -> Fehlschlag-Zeile mit Code, Boot laeuft TROTZDEM durch", async () => {
  const srv = await startServer({
    env: {
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1",
      SMTP_USER: "probe-test@example.test",
      SMTP_PASSWORD: "smtp-boot-probe-test-password-should-not-leak",
      MAIL_FROM: "probe-test@example.test",
    },
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);

    await waitForLog(srv, /\[mail\] SMTP konfiguriert .* Verbindung\/Anmeldung fehlgeschlagen \(code=/);
    assert.doesNotMatch(
      srv.stdout,
      /smtp-boot-probe-test-password-should-not-leak/,
      "kein Passwort im echten Boot-Log",
    );
  } finally {
    await srv.stop();
  }
});
