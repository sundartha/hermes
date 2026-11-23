import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { logBis } from "../gemeinsam/log-bis.mjs";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { makeTelnyxSigner, nowSeconds, startServer } from "../helpers.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";
import { anweisungenBisZurueck, warteAufAnspruchsabschnitt } from "./anspruchsverbindung-abschnitt.js";
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
const ANGENOMMEN_LOG = '"status":"in-progress"';
const EINMAL = 1;
const FRIST = { timeout: 60_000 };
const OHNE_EIGENE_FRIST = new AbortController().signal;
const ANRUF_ZAUN = "call_zaun_";
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

async function waermeAnruf(signer, instanz) {
  const ab = instanz.stdout.length;
  assert.equal(await senden(instanz, signierterEndstatus(signer, "warm", { status: "in-progress" })), HTTP_OK);
  await logBis(instanz, ANGENOMMEN_LOG, { ab });
}

const nachlaufZeilen = (instanz) => instanz.stdout.split("\n").filter((zeile) => zeile.includes(NACHLAUF_LOG));

async function warteAufLog(instanzen) {
  await Promise.race(instanzen.map((instanz) => logBis(instanz, NACHLAUF_LOG, { signal: OHNE_EIGENE_FRIST })));
  return () => instanzen.reduce((summe, instanz) => summe + nachlaufZeilen(instanz).length, 0);
}

async function zaun(sql, signer, instanzen) {
  for (const [nr, instanz] of instanzen.entries()) {
    const id = `${ANRUF_ZAUN}${nr}`;
    await senden(instanz, signierterEndstatus(signer, id, { callId: id, status: "in-progress" }));
    await zeilenBis(
      async () => (await sql(ANGENOMMEN_SQL, [id])).rows[0].answered_at,
      (wert) => wert !== null,
    );
  }
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
    for (const [id, angenommen] of [[ANRUF, beginn], [ANRUF_OFFEN, null], [`${ANRUF_ZAUN}0`, null], [`${ANRUF_ZAUN}1`, null]]) {
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

test("Verschiedene Endstatus-Zustellungen eines gebundenen Anrufs an zwei Instanzen: der Nachlauf startet genau einmal", FRIST, async (t) => {
  await mitGebundenemAnruf(t, {}, async ({ sql, signer, starte }) => {
    const [a, b] = [await starte(), await starte()];
    const stati = await Promise.all([
      senden(a, signierterEndstatus(signer, "a")),
      senden(b, signierterEndstatus(signer, "b")),
    ]);
    assert.deepEqual(stati, [HTTP_OK, HTTP_OK]);
    const zaehle = await warteAufLog([a, b]);
    await zaun(sql, signer, [a, b]);
    assert.equal(zaehle(), EINMAL);
    const marker = await zeilenBis(
      async () => (await sql(MARKER_SQL, [ANRUF])).rows[0].el_nachlauf_started_at,
      (wert) => wert !== null,
    );
    assert.ok(marker instanceof Date);
  });
});

test("Zweite Zustellung nach dem Start auf der anderen Instanz startet keinen zweiten Nachlauf und löscht den Marker nicht", FRIST, async (t) => {
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
    await zaun(sql, signer, [a, b]);
    assert.equal(zaehle(), EINMAL);
    assert.deepEqual((await sql(MARKER_SQL, [ANRUF])).rows[0].el_nachlauf_started_at, vorher);
  });
});

test("Hängt die Datenbank beim Beanspruchen, startet der Nachlauf trotzdem und der Anruf bricht nicht ab", FRIST, async (t) => {
  await mitGebundenemAnruf(t, { ueberRelais: true }, async ({ signer, starte, relais }) => {
    const a = await starte();
    await waermeAnruf(signer, a);
    relais.anhalten();
    assert.equal(await senden(a, signierterEndstatus(signer, "a")), HTTP_OK);
    const zaehle = await warteAufLog([a]);
    assert.equal(zaehle(), EINMAL);
    assert.ok(a.stdout.includes(GRUND_FRIST), a.stdout);
  });
});

test("Schlägt das Beanspruchen in der Datenbank fehl, startet der Nachlauf trotzdem", FRIST, async (t) => {
  await mitGebundenemAnruf(t, {}, async ({ sql, signer, starte }) => {
    const a = await starte();
    await sql(SPERRE_SQL);
    assert.equal(await senden(a, signierterEndstatus(signer, "a")), HTTP_OK);
    const zaehle = await warteAufLog([a]);
    assert.equal(zaehle(), EINMAL);
    assert.ok(a.stdout.includes(GRUND_FEHLER), a.stdout);
  });
});

test("Fehlt die Anrufzeile in der Datenbank noch, startet der Nachlauf trotzdem", FRIST, async (t) => {
  await mitGebundenemAnruf(t, {}, async ({ sql, signer, starte }) => {
    const a = await starte();
    await waermeAnruf(signer, a);
    await sql(ANRUF_LOESCHEN_SQL, [ANRUF]);
    assert.equal(await senden(a, signierterEndstatus(signer, "a")), HTTP_OK);
    const zaehle = await warteAufLog([a]);
    assert.equal(zaehle(), EINMAL);
  });
});

const keineOffeneTransaktion = async (sql) =>
  (await zeilenBis(async () => (await sql(OFFENE_TRANSAKTIONEN_SQL)).rows[0].anzahl, (anzahl) => anzahl === 0)) === 0;

test("Eine einzelne Instanz startet den Nachlauf genau einmal, ohne in den Rückfall zu gehen", FRIST, async (t) => {
  await mitGebundenemAnruf(t, {}, async ({ sql, signer, starte }) => {
    const a = await starte();
    assert.equal(await senden(a, signierterEndstatus(signer, "a")), HTTP_OK);
    const zaehle = await warteAufLog([a]);
    await zaun(sql, signer, [a]);
    assert.equal(zaehle(), EINMAL);
    assert.ok(!a.stdout.includes("nachlauf_anspruch grund="), a.stdout);
  });
});

test("Nach fehlgeschlagenem Beanspruchen bleibt keine offene Transaktion zurück", FRIST, async (t) => {
  await mitGebundenemAnruf(t, {}, async ({ sql, signer, starte }) => {
    const a = await starte();
    await sql(SPERRE_SQL);
    await senden(a, signierterEndstatus(signer, "a"));
    await warteAufLog([a]);
    assert.ok(a.stdout.includes(GRUND_FEHLER), a.stdout);
    assert.ok(await keineOffeneTransaktion(sql));
  });
});

test("Ist der Start in dieser Instanz schon vermerkt, fragt eine weitere Zustellung die Datenbank nicht noch einmal", FRIST, async (t) => {
  await mitGebundenemAnruf(t, {}, async ({ sql, signer, starte }) => {
    const a = await starte();
    await senden(a, signierterEndstatus(signer, "a"));
    const zaehle = await warteAufLog([a]);
    await sql(ANSPRUCH_SPERRE_SQL);
    await senden(a, signierterEndstatus(signer, "b"));
    await senden(a, signierterEndstatus(signer, "c"));
    assert.equal(zaehle(), EINMAL);
    assert.ok(!a.stdout.includes("nachlauf_anspruch grund="), a.stdout);
  });
});

const ANSPRUCH_ANWEISUNG = "UPDATE call SET el_nachlauf_started_at";
const ZEILEN_ANWEISUNG = "SELECT 1 FROM call";
const ABSCHLUSS = "COMMIT";
const BEGINN = "BEGIN";
const ZURUECK = "ROLLBACK";

const naechsteNachAnspruch = (anweisungen) => {
  const folgende = anweisungen.slice(anweisungen.findIndex((text) => text.includes(ANSPRUCH_ANWEISUNG)) + 1);
  return folgende.find((text) => !text.includes(ZEILEN_ANWEISUNG));
};

const gehalteneBeginne = (mitschnitt) =>
  mitschnitt.verbindungen().flatMap((anweisungen, nr) => (anweisungen.at(-1) === BEGINN ? [nr] : []));

async function poolVorwaermen(sql, signer, instanz) {
  await Promise.all([zaun(sql, signer, [instanz]), zaun(sql, signer, [instanz])]);
}

test("Der gewonnene Anspruch wird auf derselben Verbindung sofort abgeschlossen, die Sperre auf der Anrufzeile bleibt nicht liegen", FRIST, async (t) => {
  await mitGebundenemAnruf(t, { ueberRelais: true }, async ({ sql, signer, relais }) => {
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
      await zaun(sql, signer, [a, b]);
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

test("Bekommt das Beanspruchen die Verbindung erst nach Ablauf der Frist, setzt es keine Anweisung mehr ab", FRIST, async (t) => {
  await mitGebundenemAnruf(t, { ueberRelais: true }, async ({ sql, signer, relais }) => {
    const mitschnitt = await starteAnweisungsMitschnitt(relais.adresse);
    const anbieter = await starteAnrufstartAttrappe();
    const umgebung = pgStartUmgebung(mitschnitt.adresse, {
      ...EL_UMGEBUNG,
      ELEVENLABS_API_BASE: anbieter.url,
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
      WEBHOOK_ZUSTELLUNG_SECRET,
    });
    const a = await startServer({ env: umgebung });
    try {
      await waermeAnruf(signer, a);
      relais.anhalten();
      assert.equal(await senden(a, signierterEndstatus(signer, "a")), HTTP_OK);
      await warteAufLog([a]);
      assert.ok(a.stdout.includes(GRUND_FRIST), a.stdout);
      relais.fortsetzen();
      await relais.abwarten();
      await zaun(sql, signer, [a]);
      const ansprueche = mitschnitt.verbindungen().flat().filter((text) => text.includes(ANSPRUCH_ANWEISUNG));
      assert.deepEqual(ansprueche, []);
    } finally {
      relais.fortsetzen();
      await a.stop();
      await mitschnitt.schliessen();
      await anbieter.schliessen();
    }
  });
});

test("Nach Ablauf der Frist sendet die Anspruchsverbindung nach dem Fortsetzen nur noch ROLLBACK", FRIST, async (t) => {
  await mitGebundenemAnruf(t, { ueberRelais: true }, async ({ sql, signer, relais }) => {
    const mitschnitt = await starteAnweisungsMitschnitt(relais.adresse);
    const anbieter = await starteAnrufstartAttrappe();
    const umgebung = pgStartUmgebung(mitschnitt.adresse, {
      ...EL_UMGEBUNG,
      ELEVENLABS_API_BASE: anbieter.url,
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
      WEBHOOK_ZUSTELLUNG_SECRET,
    });
    const a = await startServer({ env: umgebung });
    try {
      await poolVorwaermen(sql, signer, a);
      await waermeAnruf(signer, a);
      relais.anhalten();
      assert.equal(await senden(a, signierterEndstatus(signer, "a")), HTTP_OK);
      await warteAufLog([a]);
      assert.ok(a.stdout.includes(GRUND_FRIST), a.stdout);
      const vorher = mitschnitt.verbindungen().map((anweisungen) => anweisungen.length);
      const gehalten = gehalteneBeginne(mitschnitt);
      relais.fortsetzen();
      await relais.abwarten();
      const beanspruchend = await warteAufAnspruchsabschnitt(mitschnitt, vorher, gehalten);
      const spaeter = beanspruchend.flatMap((nr) => anweisungenBisZurueck(mitschnitt, nr, vorher));
      assert.ok(beanspruchend.length >= EINMAL);
      assert.deepEqual(spaeter.filter((text) => text !== ZURUECK), []);
    } finally {
      relais.fortsetzen();
      await a.stop();
      await mitschnitt.schliessen();
      await anbieter.schliessen();
    }
  });
});

test("Nach Ablauf der Frist kommt auf der wartenden Anspruchsverbindung nach dem Fortsetzen das ROLLBACK des Anspruchs an", FRIST, async (t) => {
  await mitGebundenemAnruf(t, { ueberRelais: true }, async ({ sql, signer, relais }) => {
    const mitschnitt = await starteAnweisungsMitschnitt(relais.adresse);
    const anbieter = await starteAnrufstartAttrappe();
    const umgebung = pgStartUmgebung(mitschnitt.adresse, {
      ...EL_UMGEBUNG,
      ELEVENLABS_API_BASE: anbieter.url,
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
      WEBHOOK_ZUSTELLUNG_SECRET,
    });
    const a = await startServer({ env: umgebung });
    try {
      await poolVorwaermen(sql, signer, a);
      await waermeAnruf(signer, a);
      relais.anhalten();
      assert.equal(await senden(a, signierterEndstatus(signer, "a")), HTTP_OK);
      await warteAufLog([a]);
      assert.ok(a.stdout.includes(GRUND_FRIST), a.stdout);
      const vorher = mitschnitt.verbindungen().map((anweisungen) => anweisungen.length);
      const gehalten = gehalteneBeginne(mitschnitt);
      relais.fortsetzen();
      await relais.abwarten();
      if (gehalten.length === 0) {
        await zaun(sql, signer, [a]);
        const neue = mitschnitt.verbindungen().map((x, nr) => x.slice(vorher[nr] ?? 0));
        assert.deepEqual(
          neue.flat().filter((text) => text.includes(ANSPRUCH_ANWEISUNG)),
          [],
          "kein gehaltenes BEGIN beim Messpunkt: nach Fristablauf darf der Anspruch nicht mehr schreiben",
        );
        return;
      }
      await mitschnitt.bisBedingung(() => gehalten.some((nr) => anweisungenBisZurueck(mitschnitt, nr, vorher).includes(ZURUECK)));
      const beanspruchend = await warteAufAnspruchsabschnitt(mitschnitt, vorher, gehalten);
      assert.ok(beanspruchend.length >= EINMAL);
      for (const nr of beanspruchend) {
        const spaeter = anweisungenBisZurueck(mitschnitt, nr, vorher);
        assert.ok(spaeter.includes(ZURUECK), JSON.stringify(spaeter));
      }
    } finally {
      relais.fortsetzen();
      await a.stop();
      await mitschnitt.schliessen();
      await anbieter.schliessen();
    }
  });
});
