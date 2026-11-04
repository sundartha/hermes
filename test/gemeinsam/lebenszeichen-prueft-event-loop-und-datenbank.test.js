import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import pg from "pg";
import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { echteDatenbank, POSTGRES_VARIABLE } from "./echtes-postgres.js";
import {
  antwortetMit,
  antwortetNie,
  lebenszeichenZeilen,
  mitGemeldetemDienst,
  wirdWahr,
} from "./lebenszeichen-hilfe.mjs";

const HTTP_OK = 200;
const POSTGRES_STANDARDPORT = 5432;

const DURCHREICHEN = "durchreichen";
const HALTEN = "halten";
const SCHWEIGEN = "schweigen";
const BEREIT_FUER_ABFRAGE = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);

const SCHNELLER_TAKT_MS = "30";
const LANGE_FRIST_MS = "60000";
const KURZE_FRIST_MS = "20";
const FRIST_NACH_SCHNELLER_PRUEFUNG_MS = "60";
const MELDUNGEN_FUER_VERGLEICH = 6;
const MELDUNGEN_NACH_FRISTENDE = 6;
const WEITERE_MELDUNGEN = 3;
const GESUNDE_MELDUNGEN = 2;
const NACHLAUF_MS = 90;

const ANHALTEN_NACH_MELDUNG = 2;
const ANHALTEN_MS = 90;
const EIN_TAKT_MS = 100;
const LANGER_TAKT_MS = 300;
const GRENZE_UNTER_DEM_TAKT_MS = "15";
const GRENZE_UEBER_DEM_MESSTAKT_MS = "50";
const MINDESTABSTAND_NACH_ANHALTEN_MS = 75;
const MINDESTABSTAND_NACH_LANGEM_TAKT_MS = 250;
const ERSTE_MELDUNG_SPAETESTENS_MS = 150;

const TOT_MELDET_GESUND = "Lebenszeichen: Dienst mit toter Datenbank meldet trotzdem gesund";
const GESUND_MELDET_NICHT = "Lebenszeichen: gesunder Dienst meldet nicht";
const KEINE_PRUEFVERBINDUNG = "Lebenszeichen: Dienst mit Postgres öffnet keine Prüfverbindung";
const PRUEFVERBINDUNG_BLEIBT_OFFEN = "Lebenszeichen: Prüfverbindung wird nicht je Takt geschlossen";
const MELDUNG_TROTZ_KRANKHEIT = "Lebenszeichen: kranker Dienst hat gemeldet";
const KEINE_ERKLAERUNG = "Lebenszeichen: im kranken Takt fehlt die Logzeile mit Grund";
const DIENST_BEENDET = "Lebenszeichen: die Prüfung hat den Dienst beendet";
const VERZUG_MELDET_TROTZDEM =
  "Lebenszeichen: Event-Loop-Verzug über der Grenze, Meldung kam sofort";
const NACH_VERZUG_STILL = "Lebenszeichen: nach dem Event-Loop-Verzug meldet der Dienst nicht mehr";
const VERZUG_NICHT_IM_LOG = "Lebenszeichen: das Log nennt den Event-Loop-Verzug nicht";
const ERSTE_MELDUNG_FEHLT = "Lebenszeichen: die erste Meldung fiel bei kleiner Grenze aus";
const JSON_PRUEFT_DATENBANK = "Lebenszeichen: Dienst mit JSON-Speicher prüft die Datenbank";

const GRUND_EVENT_LOOP = "Event-Loop";
const GRUND_DATENBANK = "Datenbank";

const VERWALTER_ZEILEN = "SELECT datname FROM pg_database WHERE datname = ANY($1)";
const ALLE_VERBINDUNGEN_TRENNEN =
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1";
const VERBINDUNG_TRENNEN =
  "SELECT pg_terminate_backend(pid) AS beendet FROM pg_stat_activity WHERE datname = $1 AND client_port = $2";
const VERBINDUNGEN_ZAEHLEN =
  "SELECT count(*)::int AS anzahl FROM pg_stat_activity WHERE datname = $1";

function pgUmgebung(adresse) {
  return {
    STORE_BACKEND: "pg",
    DATABASE_URL: adresse,
    BOOTSTRAP_E164: "+15005550006",
    BOOTSTRAP_PROVIDER: "telnyx",
    HERMES_DEPLOY_TOKEN: "lebenszeichen-deploy-token-mindestens-32-zeichen",
    HERZSCHLAG_TAKT_MS: SCHNELLER_TAKT_MS,
  };
}

function datenbankName(db) {
  return new URL(db.adresse).pathname.slice(1);
}

async function verwalterVon(t) {
  const adresse = process.env[POSTGRES_VARIABLE];
  if (!adresse) return null;
  const verbindung = new pg.Client({ connectionString: adresse });
  await verbindung.connect();
  const gesperrt = new Set();
  t.after(async () => {
    try {
      const { rows } = await verbindung.query(VERWALTER_ZEILEN, [[...gesperrt]]);
      for (const { datname } of rows) {
        await verbindung.query(`ALTER DATABASE ${datname} WITH ALLOW_CONNECTIONS true`);
      }
    } finally {
      await verbindung.end();
    }
  });
  return {
    abfrage: (sql, parameter) => verbindung.query(sql, parameter),
    async verbindungenZu(db) {
      const { rows } = await verbindung.query(VERBINDUNGEN_ZAEHLEN, [datenbankName(db)]);
      return rows[0].anzahl;
    },
    async sperren(db) {
      const name = datenbankName(db);
      gesperrt.add(name);
      await verbindung.query(`ALTER DATABASE ${name} WITH ALLOW_CONNECTIONS false`);
      await verbindung.query(ALLE_VERBINDUNGEN_TRENNEN, [name]);
    },
  };
}

function starteWeiche(zielAdresse) {
  const ziel = new URL(zielAdresse);
  const weiche = { modus: DURCHREICHEN, verbindungen: [] };
  const sockets = new Set();
  const server = net.createServer((hinweg) => {
    const eintrag = { modus: weiche.modus, offen: true, bereit: false, port: null };
    let rueck = null;
    weiche.verbindungen.push(eintrag);
    sockets.add(hinweg);
    hinweg.on("error", () => {});
    hinweg.on("close", () => {
      eintrag.offen = false;
      rueck?.destroy();
    });
    if (eintrag.modus === SCHWEIGEN) return;
    rueck = net.connect({ host: ziel.hostname, port: Number(ziel.port) || POSTGRES_STANDARDPORT });
    sockets.add(rueck);
    rueck.on("connect", () => {
      eintrag.port = rueck.localPort;
    });
    rueck.on("error", () => hinweg.destroy());
    rueck.on("close", () => hinweg.destroy());
    rueck.on("data", (daten) => {
      hinweg.write(daten);
      if (eintrag.modus === HALTEN && daten.includes(BEREIT_FUER_ABFRAGE)) eintrag.bereit = true;
    });
    hinweg.on("data", (daten) => {
      if (!eintrag.bereit) rueck.write(daten);
    });
  });
  return new Promise((fertig) => {
    server.listen(0, "127.0.0.1", () => {
      const adresse = new URL(zielAdresse);
      adresse.hostname = "127.0.0.1";
      adresse.port = String(server.address().port);
      weiche.adresse = adresse.href;
      weiche.bereitPortVon = (ab) => {
        const bereite = weiche.verbindungen.filter(
          ({ bereit, offen }, index) => index >= ab && bereit && offen,
        );
        return bereite.length > 0 ? bereite[0].port : null;
      };
      weiche.istOffen = (port) =>
        weiche.verbindungen.some((eintrag) => eintrag.port === port && eintrag.offen);
      weiche.beenden = async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise((zu) => server.close(zu));
      };
      fertig(weiche);
    });
  });
}

function starteStummenServer() {
  const stummer = { verbindungen: 0 };
  const sockets = new Set();
  const server = net.createServer((socket) => {
    stummer.verbindungen += 1;
    sockets.add(socket);
    socket.on("error", () => {});
  });
  return new Promise((fertig) => {
    server.listen(0, "127.0.0.1", () => {
      stummer.adresse = `postgres://nutzer:geheim@127.0.0.1:${server.address().port}/hermes`;
      stummer.beenden = async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise((zu) => server.close(zu));
      };
      fertig(stummer);
    });
  });
}

function antwortetUndMeldet(beiMeldung) {
  let nummer = 0;
  return (antwort) => {
    antwortetMit(HTTP_OK)(antwort);
    nummer += 1;
    beiMeldung(nummer);
  };
}

async function mitWeiche(t, { modusNachErsterMeldung, umgebung = {} }, pruefung) {
  const verwalter = await verwalterVon(t);
  const db = await echteDatenbank(t);
  if (!db) return;
  const weiche = await starteWeiche(db.adresse);
  t.after(() => weiche.beenden());
  const zustand = { ab: null };
  const beiMeldung = (nummer) => {
    if (nummer !== 1) return;
    zustand.ab = weiche.verbindungen.length;
    weiche.modus = modusNachErsterMeldung;
  };
  await mitGemeldetemDienst(
    {
      antworte: antwortetUndMeldet(beiMeldung),
      umgebung: { ...pgUmgebung(weiche.adresse), ...umgebung },
    },
    (dienst, empfaenger) => pruefung({ dienst, empfaenger, weiche, zustand, db, verwalter }),
  );
}

async function mitAnhalten({ umgebung, mindestabstandMs }, pruefung) {
  const zustand = { dienst: null, angehalten: false };
  const beiMeldung = (nummer) => {
    if (nummer !== ANHALTEN_NACH_MELDUNG) return;
    zustand.dienst.child.kill("SIGSTOP");
    zustand.angehalten = true;
  };
  await mitGemeldetemDienst(
    { antworte: antwortetUndMeldet(beiMeldung), umgebung },
    async (dienst, empfaenger) => {
      zustand.dienst = dienst;
      const bereitMs = performance.now();
      try {
        assert.equal(await wirdWahr(() => zustand.angehalten), true, GESUND_MELDET_NICHT);
        const ersteMeldungNachMs = empfaenger.meldungen[0].zeitMs - bereitMs;
        await echtWarten(ANHALTEN_MS);
        dienst.child.kill("SIGCONT");
        const fortgesetztMs = performance.now();
        const wieder = await wirdWahr(() => empfaenger.meldungen.length > ANHALTEN_NACH_MELDUNG);
        assert.equal(wieder, true, NACH_VERZUG_STILL);
        const abstand = empfaenger.meldungen[ANHALTEN_NACH_MELDUNG].zeitMs - fortgesetztMs;
        assert.ok(abstand >= mindestabstandMs, `${VERZUG_MELDET_TROTZDEM} (${abstand} ms)`);
        const nenntVerzug = lebenszeichenZeilen(dienst).some((zeile) =>
          zeile.includes(GRUND_EVENT_LOOP),
        );
        assert.equal(nenntVerzug, true, VERZUG_NICHT_IM_LOG);
        await pruefung({ dienst, ersteMeldungNachMs });
      } finally {
        dienst.child.kill("SIGCONT");
      }
    },
  );
}

const nachDerErstenMeldung = (weiche, zustand) => weiche.verbindungen.slice(zustand.ab);

async function assertLogzeile(dienst, grund) {
  const erschienen = await wirdWahr(() =>
    lebenszeichenZeilen(dienst).some((zeile) => zeile.includes(grund)),
  );
  assert.equal(erschienen, true, KEINE_ERKLAERUNG);
}

async function assertErsteMeldung(zustand) {
  assert.equal(await wirdWahr(() => zustand.ab !== null), true, GESUND_MELDET_NICHT);
}

async function assertDienstLebt(dienst) {
  const antwort = await abrufMitFrist(`${dienst.localUrl}/healthz`);
  assert.equal(antwort.status, HTTP_OK, "Lebenszeichen: /healthz weicht von 200 ab");
  assert.equal(dienst.child.exitCode, null, DIENST_BEENDET);
}

test("[NIE1] eine nie beantwortete Meldung hält den nächsten Takt nicht auf", async () => {
  await mitGemeldetemDienst(
    {
      antworte: antwortetNie,
      umgebung: { HERZSCHLAG_TAKT_MS: SCHNELLER_TAKT_MS, HERZSCHLAG_FRIST_MS: LANGE_FRIST_MS },
    },
    async (_dienst, empfaenger) => {
      const weitere = await wirdWahr(() => empfaenger.meldungen.length >= WEITERE_MELDUNGEN);
      assert.equal(weitere, true, "Lebenszeichen: der Takt wartet auf die offene Meldung");
    },
  );
});

test("Lebenszeichen: Dienst mit toter Datenbank meldet nicht mehr und nennt den Grund im Log", async (t) => {
  await mitWeiche(
    t,
    { modusNachErsterMeldung: DURCHREICHEN },
    async ({ dienst, empfaenger, db, verwalter }) => {
      const gesund = await wirdWahr(() => empfaenger.meldungen.length >= GESUNDE_MELDUNGEN);
      assert.equal(gesund, true, GESUND_MELDET_NICHT);
      await verwalter.sperren(db);
      const ersteZeile = await wirdWahr(() => lebenszeichenZeilen(dienst).length >= 1);
      assert.equal(ersteZeile, true, TOT_MELDET_GESUND);
      const gemeldet = empfaenger.meldungen.length;
      const zweiteZeile = await wirdWahr(() => lebenszeichenZeilen(dienst).length >= 2);
      assert.equal(zweiteZeile, true, TOT_MELDET_GESUND);
      assert.equal(empfaenger.meldungen.length, gemeldet, TOT_MELDET_GESUND);
      await assertLogzeile(dienst, GRUND_DATENBANK);
    },
  );
});

test("Lebenszeichen: eine hängende Datenbank ergibt je hängender Prüfung genau einen Verbindungsversuch und keine Meldung", async (t) => {
  await mitWeiche(
    t,
    { modusNachErsterMeldung: SCHWEIGEN, umgebung: { HERZSCHLAG_FRIST_MS: LANGE_FRIST_MS } },
    async ({ empfaenger, weiche, zustand }) => {
      await assertErsteMeldung(zustand);
      const versucht = await wirdWahr(() => nachDerErstenMeldung(weiche, zustand).length >= 1);
      assert.equal(versucht, true, "Lebenszeichen: Dienst prüft die hängende Datenbank nicht");
      await echtWarten(NACHLAUF_MS);
      assert.equal(
        nachDerErstenMeldung(weiche, zustand).length,
        1,
        "Lebenszeichen: hängende Prüfung löst weitere Verbindungsversuche aus",
      );
      assert.equal(empfaenger.meldungen.length, 1, MELDUNG_TROTZ_KRANKHEIT);
    },
  );
});

test("[NIE2] mit kurzer Frist bricht die Prüfung an einer Datenbank ohne Antwort ab, ohne zu melden", async (t) => {
  await mitWeiche(
    t,
    { modusNachErsterMeldung: SCHWEIGEN, umgebung: { HERZSCHLAG_FRIST_MS: KURZE_FRIST_MS } },
    async ({ dienst, empfaenger, weiche, zustand }) => {
      await assertErsteMeldung(zustand);
      const abgebrochen = await wirdWahr(() =>
        nachDerErstenMeldung(weiche, zustand).some(({ offen }) => !offen),
      );
      assert.equal(abgebrochen, true, "Lebenszeichen: Prüfung bricht nach der Frist nicht ab");
      assert.equal(empfaenger.meldungen.length, 1, MELDUNG_TROTZ_KRANKHEIT);
      await assertLogzeile(dienst, GRUND_DATENBANK);
    },
  );
});

test("Lebenszeichen: mit Postgres öffnet und schließt jeder Takt eine eigene Prüfverbindung, die Zahl der Verbindungen wächst nicht", async (t) => {
  await mitWeiche(
    t,
    { modusNachErsterMeldung: DURCHREICHEN },
    async ({ empfaenger, weiche, zustand, db, verwalter }) => {
      await assertErsteMeldung(zustand);
      const vorher = await verwalter.verbindungenZu(db);
      const genug = await wirdWahr(() => empfaenger.meldungen.length >= MELDUNGEN_FUER_VERGLEICH);
      assert.equal(genug, true, GESUND_MELDET_NICHT);
      const geprueft = nachDerErstenMeldung(weiche, zustand);
      assert.ok(geprueft.length >= MELDUNGEN_FUER_VERGLEICH - 1, KEINE_PRUEFVERBINDUNG);
      const geschlossen = await wirdWahr(() =>
        nachDerErstenMeldung(weiche, zustand)
          .slice(0, -1)
          .every(({ offen }) => !offen),
      );
      assert.equal(geschlossen, true, PRUEFVERBINDUNG_BLEIBT_OFFEN);
      const nachher = await verwalter.verbindungenZu(db);
      assert.ok(nachher <= vorher + 1, `${PRUEFVERBINDUNG_BLEIBT_OFFEN}: ${vorher} -> ${nachher}`);
    },
  );
});

test("Lebenszeichen: wird die gehaltene Prüfverbindung getrennt, lebt der Dienst weiter, meldet in diesem Takt nicht und nennt einen Grund", async (t) => {
  await mitWeiche(
    t,
    { modusNachErsterMeldung: HALTEN, umgebung: { HERZSCHLAG_FRIST_MS: LANGE_FRIST_MS } },
    async ({ dienst, empfaenger, weiche, zustand, db, verwalter }) => {
      await assertErsteMeldung(zustand);
      const gehalten = await wirdWahr(() => weiche.bereitPortVon(zustand.ab) !== null);
      assert.equal(gehalten, true, KEINE_PRUEFVERBINDUNG);
      const port = weiche.bereitPortVon(zustand.ab);
      const { rows } = await verwalter.abfrage(VERBINDUNG_TRENNEN, [datenbankName(db), port]);
      assert.deepEqual(rows, [{ beendet: true }], KEINE_PRUEFVERBINDUNG);
      const getrennt = await wirdWahr(() => !weiche.istOffen(port));
      assert.equal(getrennt, true, "Lebenszeichen: die getrennte Prüfverbindung bleibt offen");
      await assertLogzeile(dienst, GRUND_DATENBANK);
      assert.equal(empfaenger.meldungen.length, 1, MELDUNG_TROTZ_KRANKHEIT);
      assert.equal(dienst.child.exitCode, null, DIENST_BEENDET);
    },
  );
});

test("Lebenszeichen: feuert die Frist nach einer schnellen Prüfung auf der geschlossenen Verbindung, lebt der Dienst weiter", async (t) => {
  await mitWeiche(
    t,
    {
      modusNachErsterMeldung: DURCHREICHEN,
      umgebung: { HERZSCHLAG_FRIST_MS: FRIST_NACH_SCHNELLER_PRUEFUNG_MS },
    },
    async ({ dienst, empfaenger, weiche, zustand }) => {
      await assertErsteMeldung(zustand);
      const weitere = await wirdWahr(() => empfaenger.meldungen.length >= MELDUNGEN_NACH_FRISTENDE);
      assert.equal(weitere, true, GESUND_MELDET_NICHT);
      assert.equal(nachDerErstenMeldung(weiche, zustand).length >= 1, true, KEINE_PRUEFVERBINDUNG);
      await assertDienstLebt(dienst);
    },
  );
});

test("Lebenszeichen: ein Event-Loop-Verzug über der Grenze verhindert die Meldung dieses Takts, die erste Meldung fällt bei kleiner Grenze nicht aus", async () => {
  await mitAnhalten(
    {
      umgebung: {
        HERZSCHLAG_TAKT_MS: String(EIN_TAKT_MS),
        HERZSCHLAG_VERZUG_GRENZE_MS: GRENZE_UNTER_DEM_TAKT_MS,
      },
      mindestabstandMs: MINDESTABSTAND_NACH_ANHALTEN_MS,
    },
    ({ ersteMeldungNachMs }) => {
      assert.ok(
        ersteMeldungNachMs < ERSTE_MELDUNG_SPAETESTENS_MS,
        `${ERSTE_MELDUNG_FEHLT} (${ersteMeldungNachMs} ms)`,
      );
    },
  );
});

test("Lebenszeichen: ein Anhalten mitten im Takt, ohne verspäteten Takt, verhindert die Meldung des Takts mit dem Verzug", async () => {
  await mitAnhalten(
    {
      umgebung: {
        HERZSCHLAG_TAKT_MS: String(LANGER_TAKT_MS),
        HERZSCHLAG_VERZUG_GRENZE_MS: GRENZE_UEBER_DEM_MESSTAKT_MS,
      },
      mindestabstandMs: MINDESTABSTAND_NACH_LANGEM_TAKT_MS,
    },
    () => {},
  );
});

test("[NIE2] ein Event-Loop-Verzug über der Grenze lässt den Dienst in diesem Takt nicht gesund melden", async () => {
  await mitAnhalten(
    {
      umgebung: {
        HERZSCHLAG_TAKT_MS: String(EIN_TAKT_MS),
        HERZSCHLAG_VERZUG_GRENZE_MS: GRENZE_UEBER_DEM_MESSTAKT_MS,
      },
      mindestabstandMs: MINDESTABSTAND_NACH_ANHALTEN_MS,
    },
    () => {},
  );
});

test("Lebenszeichen: ein Dienst mit JSON-Speicher meldet ohne Datenbankprüfung, aber nicht bei Event-Loop-Verzug", async (t) => {
  const stummer = await starteStummenServer();
  t.after(() => stummer.beenden());
  await mitAnhalten(
    {
      umgebung: {
        STORE_BACKEND: "json",
        DATABASE_URL: stummer.adresse,
        HERZSCHLAG_TAKT_MS: String(EIN_TAKT_MS),
        HERZSCHLAG_VERZUG_GRENZE_MS: GRENZE_UEBER_DEM_MESSTAKT_MS,
      },
      mindestabstandMs: MINDESTABSTAND_NACH_ANHALTEN_MS,
    },
    () => {
      assert.equal(stummer.verbindungen, 0, JSON_PRUEFT_DATENBANK);
    },
  );
});
