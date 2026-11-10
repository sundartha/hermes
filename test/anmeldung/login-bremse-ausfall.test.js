import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { zweiProzesse } from "../gemeinsam/zwei-prozesse.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_FOUND = 302;
const HTTP_TOO_MANY = 429;
const HTTP_UNAVAILABLE = 503;
const GLEICHZEITIG = 60;
const WARTEND = 32;
const ZAEHLER_MAX = 4;
const SOFORT_ABGEWIESEN = GLEICHZEITIG - ZAEHLER_MAX - WARTEND;
const GRENZE = 10;
const LOGIN_PFAD = "/auth/login";
const ABSENDER = "198.51.100.1";
const GEHEIMNIS = "login-bremse-ausfall-geheimnis-mind-32-zeichen";
const UMGEBUNG = {
  SESSION_SECRET: GEHEIMNIS,
  OIDC_CLIENT_ID: "login-bremse-client",
  OIDC_CLIENT_SECRET: "login-bremse-client-geheimnis",
  LOGIN_RATE_LIMIT_PER_MIN: String(GRENZE),
};

async function abruf(prozess, absender) {
  const antwort = await abrufMitFrist(`${prozess.localUrl}${LOGIN_PFAD}`, {
    redirect: "manual",
    headers: { "x-forwarded-for": absender },
  });
  const text = await antwort.text();
  return { status: antwort.status, headers: antwort.headers, text };
}

async function mitSitzung(t, arbeit) {
  if (process.env.CI && !process.env[POSTGRES_VARIABLE]) {
    assert.fail(`${POSTGRES_VARIABLE} fehlt in der CI, der Test darf nicht überspringen`);
  }
  const rolle = await echteDatenbankMitRolle(t);
  if (!rolle) return;
  const prozesse = await zweiProzesse(t, { ...UMGEBUNG, DATABASE_URL: rolle.adresse });
  const kontrolle = await abruf(prozesse.a, "203.0.113.200");
  assert.equal(kontrolle.status, HTTP_FOUND, "Positiv-Kontrolle: /auth/login leitet um");
  const meldungen = { text: "" };
  prozesse.a.child.stderr.on("data", (stueck) => (meldungen.text += stueck.toString()));
  await arbeit({ adresse: rolle.adresse, a: prozesse.a, meldungen });
}

async function sperreSetzen(adresse) {
  const verbindung = await (async () => {
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString: adresse });
    await client.connect();
    return client;
  })();
  await verbindung.query("BEGIN");
  await verbindung.query("LOCK TABLE login_bremse IN ACCESS EXCLUSIVE MODE");
  return {
    async aufheben() {
      await verbindung.query("ROLLBACK");
      await verbindung.end();
    },
  };
}

function wartendeZaehlungen(adresse) {
  return mitVerbindung(adresse, async (verbindung) => {
    const { rows } = await verbindung.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%login_bremse%'",
    );
    return rows[0].n;
  });
}

function sofortigeAntworten(anfragen, anzahl) {
  const frueh = [];
  return new Promise((resolve) => {
    for (const anfrage of anfragen) {
      anfrage.then((antwort) => {
        if (antwort.status !== HTTP_UNAVAILABLE) return;
        frueh.push(antwort);
        if (frueh.length === anzahl) resolve(frueh);
      });
    }
  });
}

function pruefeAbweisung(antwort) {
  assert.equal(antwort.status, HTTP_UNAVAILABLE);
  assert.equal(antwort.headers.get("retry-after"), "5");
  assert.deepEqual(JSON.parse(antwort.text), { error: "service unavailable" });
  const cookies = antwort.headers.getSetCookie().join("\n");
  assert.ok(!cookies.includes("pkce_verifier"));
}

test(
  "Login-Bremse: fehlt die Tabelle, antwortet /auth/login mit 503, Retry-After 5 und festem Text ohne Datenbankdetails",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async ({ adresse, a, meldungen }) => {
      await mitVerbindung(adresse, (verbindung) => verbindung.query("DROP TABLE login_bremse"));
      const antwort = await abruf(a, ABSENDER);
      pruefeAbweisung(antwort);
      assert.match(meldungen.text, /\[login-bremse\] .*login_bremse/);
      assert.ok(!/login_bremse|relation/i.test(antwort.text), "kein Tabellenname im Körper");
    }),
);

test(
  "Login-Bremse: bei gesperrter Tabelle zählen 4 von 60 gleichzeitigen Anfragen auf Verbindungen, 32 warten und 24 bekommen sofort 503",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async ({ adresse, a, meldungen }) => {
      const sperre = await sperreSetzen(adresse);
      const anfragen = Array.from({ length: GLEICHZEITIG }, () => abruf(a, ABSENDER));
      const abgewiesen = await sofortigeAntworten(anfragen, SOFORT_ABGEWIESEN);
      abgewiesen.forEach(pruefeAbweisung);
      assert.match(meldungen.text, /\[login-bremse\] login-bremse: Warteschlange voll/);
      assert.equal(await wartendeZaehlungen(adresse), ZAEHLER_MAX, "genau 4 belegen Verbindungen");
      await sperre.aufheben();
      const rest = (await Promise.all(anfragen)).filter(
        (antwort) => antwort.status !== HTTP_UNAVAILABLE,
      );
      assert.equal(rest.length, ZAEHLER_MAX + WARTEND, "36 angenommen");
    }),
);

test(
  "Login-Bremse: nach Aufheben der Sperre bekommen die 36 angenommenen Anfragen 10 mal 302 und sonst 429, keinen Status ab 500",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async ({ adresse, a }) => {
      const sperre = await sperreSetzen(adresse);
      const anfragen = Array.from({ length: GLEICHZEITIG }, () => abruf(a, ABSENDER));
      await sofortigeAntworten(anfragen, SOFORT_ABGEWIESEN);
      await sperre.aufheben();
      const stati = (await Promise.all(anfragen))
        .map((antwort) => antwort.status)
        .filter((wert) => wert !== HTTP_UNAVAILABLE);
      assert.equal(stati.filter((wert) => wert === HTTP_FOUND).length, GRENZE);
      assert.equal(
        stati.filter((wert) => wert === HTTP_TOO_MANY).length,
        ZAEHLER_MAX + WARTEND - GRENZE,
      );
    }),
);

test(
  "Login-Bremse: zählt eine Anfrage länger als 3 Sekunden ohne Antwort der Datenbank, bekommt sie 503 mit Retry-After 5",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async ({ adresse, a, meldungen }) => {
      const sperre = await sperreSetzen(adresse);
      try {
        pruefeAbweisung(await abruf(a, ABSENDER));
      } finally {
        await sperre.aufheben();
      }
      assert.match(meldungen.text, /\[login-bremse\] login-bremse: Zaehlen ueberschreitet die Frist/);
    }),
);

test(
  "Login-Bremse: während 4 Zählungen hängen, belegt die Bremse höchstens 4 der Portal-Verbindungen",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async ({ adresse, a }) => {
      const sperre = await sperreSetzen(adresse);
      const anfragen = Array.from({ length: GLEICHZEITIG }, () => abruf(a, ABSENDER));
      await sofortigeAntworten(anfragen, SOFORT_ABGEWIESEN);
      const belegt = await mitVerbindung(adresse, async (verbindung) => {
        const { rows } = await verbindung.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state <> 'idle' AND pid <> pg_backend_pid() AND datname = current_database()",
        );
        return rows[0].n;
      });
      await sperre.aufheben();
      await Promise.all(anfragen);
      assert.ok(belegt <= ZAEHLER_MAX + 1, `aktive Verbindungen ${belegt}`);
    }),
);

test(
  "Login-Bremse: abgelaufene wartende Anfragen zählen nach Aufheben der Sperre nicht mehr, sechs weitere Anfragen bekommen 302",
  { timeout: ZEITGRENZE_MS },
  (t) =>
    mitSitzung(t, async ({ adresse, a }) => {
      const sperre = await sperreSetzen(adresse);
      const anfragen = Array.from({ length: ZAEHLER_MAX + WARTEND }, () => abruf(a, ABSENDER));
      const abgelaufen = await Promise.all(anfragen);
      abgelaufen.forEach(pruefeAbweisung);
      await sperre.aufheben();
      const folgende = [];
      for (let i = 0; i < GRENZE - ZAEHLER_MAX; i += 1) folgende.push(await abruf(a, ABSENDER));
      assert.deepEqual(
        folgende.map((antwort) => antwort.status),
        Array(GRENZE - ZAEHLER_MAX).fill(HTTP_FOUND),
      );
    }),
);
