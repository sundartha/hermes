import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";

import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { makeTelnyxSigner, nowSeconds, startServer } from "../helpers.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";
import { starteAnweisungsMitschnitt } from "./anweisungs-mitschnitt.js";
import { starteDatenbankRelais } from "./datenbank-relais.js";
import { postgresVorhanden } from "./hermes-mit-postgres.js";
import { WEBHOOK_ZUSTELLUNG_SECRET, zeilenBis } from "./zwei-instanzen-postgres.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const HTTP_OK = 200;
const ANRUF = "call_nachlauf1";
const ANRUF_OFFEN = "call_nachlauf2";
const KONVERSATION = "conv_nachlauf1";
const NACHLAUF_LOG = "[el-inbound] nachlauf gestartet";
const EINMAL = 1;
const RUHEZEIT_MS = 2_000;
const LOG_FRIST_MS = 8_000;
const LOG_TAKT_MS = 50;
const ANRUF_SEKUNDEN = 600;
const MARKER_SQL = "SELECT el_nachlauf_started_at FROM call WHERE id = $1";
const SEED_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164, to_e164, goal,
  started_at, answered_at, max_duration_s, provider, cost_profile, elevenlabs_conversation_id, el_bound_at)
  VALUES ($1, $2, $3, 'inbound', 'active', '+491701111111', (SELECT e164 FROM number WHERE tenant_id = $2),
  'Testziel', $4, $8, $5, 'telnyx', 'telnyx_inbound_el_convai', $6, $7)`;
const ANGENOMMEN_SQL = "SELECT answered_at FROM call WHERE id = $1";
const SPERRE_SQL = `CREATE FUNCTION nachlauf_sperre() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'gesperrt'; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER nachlauf_sperre BEFORE UPDATE OF el_nachlauf_started_at ON call FOR EACH ROW
  WHEN (OLD.el_nachlauf_started_at IS NULL AND NEW.el_nachlauf_started_at IS NOT NULL)
  EXECUTE FUNCTION nachlauf_sperre()`;
const ANRUF_LOESCHEN_SQL = "DELETE FROM call WHERE id = $1";
const OFFENE_TRANSAKTIONEN_SQL = `SELECT count(*)::int AS anzahl FROM pg_stat_activity
  WHERE datname = current_database() AND state LIKE 'idle in transaction%'`;
const ANSPRUCH_SPERRE_SQL = `CREATE FUNCTION anspruch_sperre() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'gesperrt'; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER anspruch_sperre BEFORE UPDATE ON call FOR EACH STATEMENT EXECUTE FUNCTION anspruch_sperre()`;
const GRUND_FRIST = "[webhook-zustellung] nachlauf_anspruch grund=frist";
const GRUND_FEHLER = "[webhook-zustellung] nachlauf_anspruch grund=fehler";
const EL_UMGEBUNG = {
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_pg",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_pg",
  ELEVENLABS_API_KEY: "el-pg-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
};

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

function signierterEndstatus(signer, marke, { callId = ANRUF, status = "completed" } = {}) {
  const rumpf = new URLSearchParams({ CallStatus: status, CallSid: `CA_${callId}`, Marke: marke }).toString();
  const zeitstempel = String(nowSeconds());
  return {
    pfad: `/voice/status?callId=${callId}`,
    optionen: {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf),
        "telnyx-timestamp": zeitstempel,
      },
      body: rumpf,
    },
  };
}

const senden = async (instanz, zustellung) => {
  const antwort = await abrufMitFrist(`${instanz.localUrl}${zustellung.pfad}`, zustellung.optionen);
  return antwort.status;
};

const nachlaufZeilen = (instanz) => instanz.stdout.split("\n").filter((zeile) => zeile.includes(NACHLAUF_LOG));

async function warteAufLog(instanzen) {
  const ende = Date.now() + LOG_FRIST_MS;
  const zaehle = () => instanzen.reduce((summe, instanz) => summe + nachlaufZeilen(instanz).length, 0);
  while (zaehle() === 0 && Date.now() < ende) await echtWarten(LOG_TAKT_MS);
  return zaehle;
}

async function mitGebundenemAnruf(t, { ueberRelais = false }, lauf) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const db = await echteDatenbankMitRolle(t);
  const relais = ueberRelais ? await starteDatenbankRelais(db.adresse) : null;
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  const signer = makeTelnyxSigner();
  const anbieter = await starteAnrufstartAttrappe();
  const umgebung = pgStartUmgebung(relais ? relais.adresse : db.adresse, {
    ...EL_UMGEBUNG,
    ELEVENLABS_API_BASE: anbieter.url,
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    WEBHOOK_ZUSTELLUNG_SECRET,
  });
  const gestartet = [];
  const starte = async () => {
    const instanz = await startServer({ env: umgebung });
    gestartet.push(instanz);
    return instanz;
  };
  try {
    await (await starte()).stop();
    const beginn = new Date().toISOString();
    for (const [id, angenommen] of [[ANRUF, beginn], [ANRUF_OFFEN, null]]) {
      await sql(SEED_SQL, [id, BOOTSTRAP_TENANT_ID, `tok_${id}`, beginn, ANRUF_SEKUNDEN, `${KONVERSATION}_${id}`, new Date(), angenommen]);
    }
    return await lauf({ sql, signer, starte, relais });
  } finally {
    relais?.fortsetzen();
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
    await relais?.schliessen();
    await anbieter.schliessen();
    await verwaltung.end();
  }
}

test("Verschiedene Endstatus-Zustellungen eines gebundenen Anrufs an zwei Instanzen: der Nachlauf startet genau einmal", async (t) => {
  await mitGebundenemAnruf(t, {}, async ({ sql, signer, starte }) => {
    const [a, b] = [await starte(), await starte()];
    const stati = await Promise.all([
      senden(a, signierterEndstatus(signer, "a")),
      senden(b, signierterEndstatus(signer, "b")),
    ]);
    assert.deepEqual(stati, [HTTP_OK, HTTP_OK]);
    const zaehle = await warteAufLog([a, b]);
    await echtWarten(RUHEZEIT_MS);
    assert.equal(zaehle(), EINMAL);
    const marker = await zeilenBis(
      async () => (await sql(MARKER_SQL, [ANRUF])).rows[0].el_nachlauf_started_at,
      (wert) => wert !== null,
    );
    assert.ok(marker instanceof Date);
  });
});

test("Zweite Zustellung nach dem Start auf der anderen Instanz startet keinen zweiten Nachlauf und löscht den Marker nicht", async (t) => {
  await mitGebundenemAnruf(t, {}, async ({ sql, signer, starte }) => {
    const [a, b] = [await starte(), await starte()];
    await senden(a, signierterEndstatus(signer, "a"));
    const zaehle = await warteAufLog([a, b]);
    const vorher = (await sql(MARKER_SQL, [ANRUF])).rows[0].el_nachlauf_started_at;
    assert.ok(vorher instanceof Date);
    await senden(b, signierterEndstatus(signer, "b"));
    await senden(b, signierterEndstatus(signer, "c", { callId: ANRUF_OFFEN, status: "in-progress" }));
    await zeilenBis(
      async () => (await sql(ANGENOMMEN_SQL, [ANRUF_OFFEN])).rows[0].answered_at,
      (wert) => wert !== null,
    );
    await echtWarten(RUHEZEIT_MS);
    assert.equal(zaehle(), EINMAL);
    assert.deepEqual((await sql(MARKER_SQL, [ANRUF])).rows[0].el_nachlauf_started_at, vorher);
  });
});

test("Hängt die Datenbank beim Beanspruchen, startet der Nachlauf trotzdem und der Anruf bricht nicht ab", async (t) => {
  await mitGebundenemAnruf(t, { ueberRelais: true }, async ({ signer, starte, relais }) => {
    const a = await starte();
    relais.anhalten();
    assert.equal(await senden(a, signierterEndstatus(signer, "a")), HTTP_OK);
    const zaehle = await warteAufLog([a]);
    assert.equal(zaehle(), EINMAL);
    assert.ok(a.stdout.includes(GRUND_FRIST), a.stdout);
  });
});

test("Schlägt das Beanspruchen in der Datenbank fehl, startet der Nachlauf trotzdem", async (t) => {
  await mitGebundenemAnruf(t, {}, async ({ sql, signer, starte }) => {
    const a = await starte();
    await sql(SPERRE_SQL);
    assert.equal(await senden(a, signierterEndstatus(signer, "a")), HTTP_OK);
    const zaehle = await warteAufLog([a]);
    assert.equal(zaehle(), EINMAL);
    assert.ok(a.stdout.includes(GRUND_FEHLER), a.stdout);
  });
});

test("Fehlt die Anrufzeile in der Datenbank noch, startet der Nachlauf trotzdem", async (t) => {
  await mitGebundenemAnruf(t, {}, async ({ sql, signer, starte }) => {
    const a = await starte();
    await sql(ANRUF_LOESCHEN_SQL, [ANRUF]);
    assert.equal(await senden(a, signierterEndstatus(signer, "a")), HTTP_OK);
    const zaehle = await warteAufLog([a]);
    assert.equal(zaehle(), EINMAL);
  });
});

const keineOffeneTransaktion = async (sql) =>
  (await zeilenBis(async () => (await sql(OFFENE_TRANSAKTIONEN_SQL)).rows[0].anzahl, (anzahl) => anzahl === 0)) === 0;

test("Eine einzelne Instanz startet den Nachlauf genau einmal, ohne in den Rückfall zu gehen", async (t) => {
  await mitGebundenemAnruf(t, {}, async ({ signer, starte }) => {
    const a = await starte();
    assert.equal(await senden(a, signierterEndstatus(signer, "a")), HTTP_OK);
    const zaehle = await warteAufLog([a]);
    await echtWarten(RUHEZEIT_MS);
    assert.equal(zaehle(), EINMAL);
    assert.ok(!a.stdout.includes("nachlauf_anspruch grund="), a.stdout);
  });
});

test("Nach fehlgeschlagenem Beanspruchen bleibt keine offene Transaktion zurück", async (t) => {
  await mitGebundenemAnruf(t, {}, async ({ sql, signer, starte }) => {
    const a = await starte();
    await sql(SPERRE_SQL);
    await senden(a, signierterEndstatus(signer, "a"));
    await warteAufLog([a]);
    assert.ok(a.stdout.includes(GRUND_FEHLER), a.stdout);
    assert.ok(await keineOffeneTransaktion(sql));
  });
});

test("Ist der Start in dieser Instanz schon vermerkt, fragt eine weitere Zustellung die Datenbank nicht noch einmal", async (t) => {
  await mitGebundenemAnruf(t, {}, async ({ sql, signer, starte }) => {
    const a = await starte();
    await senden(a, signierterEndstatus(signer, "a"));
    const zaehle = await warteAufLog([a]);
    await sql(ANSPRUCH_SPERRE_SQL);
    await senden(a, signierterEndstatus(signer, "b"));
    await echtWarten(RUHEZEIT_MS);
    assert.equal(zaehle(), EINMAL);
    assert.ok(!a.stdout.includes("nachlauf_anspruch grund="), a.stdout);
  });
});

const ANSPRUCH_ANWEISUNG = "UPDATE call SET el_nachlauf_started_at";
const ZEILEN_ANWEISUNG = "SELECT 1 FROM call";
const ABSCHLUSS = "COMMIT";

const naechsteNachAnspruch = (anweisungen) => {
  const folgende = anweisungen.slice(anweisungen.findIndex((text) => text.includes(ANSPRUCH_ANWEISUNG)) + 1);
  return folgende.find((text) => !text.includes(ZEILEN_ANWEISUNG));
};

test("Der gewonnene Anspruch wird auf derselben Verbindung sofort abgeschlossen, die Sperre auf der Anrufzeile bleibt nicht liegen", async (t) => {
  await mitGebundenemAnruf(t, { ueberRelais: true }, async ({ signer, relais }) => {
    const mitschnitt = await starteAnweisungsMitschnitt(relais.adresse);
    const anbieter = await starteAnrufstartAttrappe();
    const umgebung = pgStartUmgebung(mitschnitt.adresse, {
      ...EL_UMGEBUNG,
      ELEVENLABS_API_BASE: anbieter.url,
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
      WEBHOOK_ZUSTELLUNG_SECRET,
    });
    const [a, b] = [await startServer({ env: umgebung }), await startServer({ env: umgebung })];
    try {
      await senden(a, signierterEndstatus(signer, "a"));
      await senden(b, signierterEndstatus(signer, "b"));
      const zaehle = await warteAufLog([a, b]);
      await echtWarten(RUHEZEIT_MS);
      assert.equal(zaehle(), EINMAL);
      assert.ok(!a.stdout.includes(GRUND_FEHLER), a.stdout);
      assert.ok(!b.stdout.includes(GRUND_FEHLER), b.stdout);
      const ansprueche = mitschnitt.verbindungen().filter((anweisungen) => anweisungen.some((text) => text.includes(ANSPRUCH_ANWEISUNG)));
      assert.ok(ansprueche.length >= EINMAL);
      for (const anweisungen of ansprueche) assert.equal(naechsteNachAnspruch(anweisungen), ABSCHLUSS);
    } finally {
      await Promise.all([a.stop(), b.stop()]);
      await mitschnitt.schliessen();
      await anbieter.schliessen();
    }
  });
});
