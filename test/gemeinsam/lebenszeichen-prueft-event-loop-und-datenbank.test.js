import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import pg from "pg";
import { echtWarten } from "../echt-warten.js";
import { POSTGRES_VARIABLE, echteDatenbank } from "./echtes-postgres.js";
import {
  antwortetMit,
  lebenszeichenZeilen,
  mitGemeldetemDienst,
  wirdWahr,
} from "./lebenszeichen-hilfe.mjs";
import { pgStartUmgebung } from "./pg-start-umgebung.js";

const HTTP_OK = 200;

const TAKT_MS = 20;
const MINDESTABSTAND_NACH_ANHALTEN_MS = TAKT_MS / 2;
const KLEINE_VERZUGSGRENZE_MS = "20";
const VERZUG_GRENZE_UNTER_TAKT_MS = "30";
const LANGER_TAKT_MS = "50";
const ANHALTEN_MS = 60;
const STILLE_MS = 100;
const ABFRAGE_PAUSE_MS = 10;
const ABFRAGE_VERSUCHE = 100;
const KURZE_FRIST_MS = "50";
const ABFRAGE_FRIST_MS = "200";
const WARTESCHRITT_MS = 100;
const VERZOEGERUNGSSCHRITTE_BEIM_VERBINDEN = 3;
const GESAMTFRIST_MS = 600;
const SPIELRAUM_ZUR_GESAMTFRIST_MS = 300;
const LANGER_TAKT_FUER_ANHALTEN_MS = 200;
const HOEHERER_VERZUG_ALS_GRENZE_MS = "30";
const ANHALTEN_MIT_MESSTAKT_VERZUG_MS = 50;
const ZEITEN_PRO_TAKT_UEBERSPRUNGEN = 1.5;
const LANGE_FRIST_MS = "60000";
const KURZER_TAKT = { HERZSCHLAG_TAKT_MS: String(TAKT_MS) };

const GESUNDE_MELDUNGEN = 3;
const WEITERE_TAKTE = 10;
const GEHALTENE_PRUEFVERBINDUNGEN_JE_TAKT = 1;
const VERSUCHE_OHNE_MELDUNG = 5;

const UNGEDACHTE_ADRESSE = "postgres://127.0.0.1:1/ohne-datenbank";
const PRUEF_ABFRAGE = "SELECT 1";
const GRUND_ZEILE = /\[lebenszeichen\] [^:]+: \S+$/;
const TREIBER_GRUND_ZEILE = /\[lebenszeichen\] [^:]+: Error$/;
const DB_PRUEFUNG_ZEILE = /\[lebenszeichen\] Datenbankprüfung gescheitert:/;

const DURCHLASSEN = "durchlassen";
const SCHWEIGEN = "schweigen";
const HALTEN = "halten";
const VERLANGSAMEN = "verlangsamen";
const FRIST_FUER_LANGSAME_DATENBANK_MS = "1000";
const MELDUNGEN_NACH_VERLANGSAMEN = 2;
const NACHRICHT_KOPF_BYTES = 5;
const NACHRICHT_SCHLUESSEL = "K";
const NACHRICHT_BEREIT = "Z";
const PID_ABSTAND_BYTES = 5;
const STARTNACHRICHT_LAENGE_BYTES = 4;
const NACHRICHT_ANFRAGE = "Q";
const ENDE_DER_ANFRAGE_BYTES = 1;

const TOTE_DATENBANK_MELDET = "Lebenszeichen: Dienst mit toter Datenbank meldet trotzdem gesund";
const KEIN_GRUND_IM_LOG = "Lebenszeichen: keine Logzeile mit Grund";
const VERZUG_MELDET =
  "Lebenszeichen: Dienst mit Event-Loop-Verzug über der Grenze meldet trotzdem gesund";
const MELDET_NICHT = "Lebenszeichen: gesunder Dienst meldet nicht an die Herzschlag-Adresse";
const DIENST_BEENDET = "Lebenszeichen: der Dienst ist beendet";

const SPERRE_AUFHEBEN = (datenbank) => `ALTER DATABASE ${datenbank} ALLOW_CONNECTIONS true`;
const SPERRE_SETZEN = (datenbank) => `ALTER DATABASE ${datenbank} ALLOW_CONNECTIONS false`;
const VERBINDUNGEN_DER_DATENBANK =
  "SELECT count(*)::int AS anzahl FROM pg_stat_activity WHERE datname = $1";
const VERBINDUNG_MIT_PID =
  "SELECT count(*)::int AS anzahl FROM pg_stat_activity WHERE datname = $1 AND pid = $2";

function schreibeAnfragenMit(client, weiche, antwortbar) {
  let rest = Buffer.alloc(0);
  let angemeldet = false;
  client.on("data", (teil) => {
    rest = Buffer.concat([rest, teil]);
    for (;;) {
      const kopf = angemeldet ? NACHRICHT_KOPF_BYTES : STARTNACHRICHT_LAENGE_BYTES;
      if (rest.length < kopf) return;
      const laenge = angemeldet ? rest.readUInt32BE(1) + 1 : rest.readUInt32BE(0);
      if (rest.length < laenge) return;
      if (angemeldet && String.fromCharCode(rest[0]) === NACHRICHT_ANFRAGE) {
        const text = rest.toString("utf8", NACHRICHT_KOPF_BYTES, laenge - ENDE_DER_ANFRAGE_BYTES);
        weiche.anfragen.push(text);
        if (antwortbar) weiche.beantwortbareAnfragen.push(text);
      }
      angemeldet = true;
      rest = rest.subarray(laenge);
    }
  });
}

async function sendeVerzoegert(client, nachricht, schritte) {
  for (let schritt = 0; schritt < schritte; schritt += 1) await echtWarten(WARTESCHRITT_MS);
  if (!client.destroyed) client.write(nachricht);
}

function reicheBisBereit(dahinter, client, weiche) {
  let rest = Buffer.alloc(0);
  let pid = null;
  let gehalten = false;
  dahinter.on("data", (teil) => {
    if (gehalten) return;
    rest = Buffer.concat([rest, teil]);
    while (!gehalten && rest.length >= NACHRICHT_KOPF_BYTES) {
      const laenge = rest.readUInt32BE(1) + 1;
      if (rest.length < laenge) return;
      const art = String.fromCharCode(rest[0]);
      if (art === NACHRICHT_SCHLUESSEL) pid = rest.readUInt32BE(PID_ABSTAND_BYTES);
      const nachricht = rest.subarray(0, laenge);
      if (art === NACHRICHT_BEREIT && weiche.verzoegerungsschritte > 0) {
        void sendeVerzoegert(client, nachricht, weiche.verzoegerungsschritte);
      } else {
        client.write(nachricht);
      }
      rest = rest.subarray(laenge);
      gehalten = art === NACHRICHT_BEREIT && pid !== null;
    }
    if (gehalten) weiche.gehaltenePids.push(pid);
  });
}

async function starteWeiche(zielAdresse) {
  const ziel = new URL(zielAdresse);
  const weiche = {
    modus: DURCHLASSEN,
    angenommen: 0,
    schweigend: 0,
    beantwortbareAnfragen: [],
    geschlossen: 0,
    gehaltenePids: [],
    anfragen: [],
    haltenAnnahmeMs: [],
    verzoegerungsschritte: 0,
  };
  const alle = new Set();
  const festgehalten = new Set();
  const merke = (socket) => {
    alle.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => alle.delete(socket));
  };
  const server = net.createServer((client) => {
    merke(client);
    weiche.angenommen += 1;
    if (weiche.modus === HALTEN) weiche.haltenAnnahmeMs.push(performance.now());
    client.on("close", () => {
      weiche.geschlossen += 1;
    });
    if (weiche.modus === SCHWEIGEN) {
      weiche.schweigend += 1;
      festgehalten.add(client);
      client.resume();
      return;
    }
    schreibeAnfragenMit(client, weiche, weiche.modus === DURCHLASSEN || weiche.modus === VERLANGSAMEN);
    const dahinter = net.connect(Number(ziel.port), ziel.hostname);
    merke(dahinter);
    client.pipe(dahinter);
    client.on("close", () => dahinter.destroy());
    dahinter.on("close", () => client.destroy());
    if (weiche.modus === VERLANGSAMEN) {
      return void dahinter.on("data", (teil) => void sendeVerzoegert(client, teil, 1));
    }
    if (weiche.modus !== HALTEN) return void dahinter.pipe(client);
    festgehalten.add(client);
    reicheBisBereit(dahinter, client, weiche);
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  const adresse = new URL(zielAdresse);
  adresse.hostname = "127.0.0.1";
  adresse.port = String(server.address().port);
  return Object.assign(weiche, {
    adresse: adresse.href,
    stelleAuf(modus) {
      this.modus = modus;
    },
    verzoegereBereitUm(schritte) {
      this.verzoegerungsschritte = schritte;
    },
    lasseLos() {
      this.modus = DURCHLASSEN;
      for (const socket of festgehalten) socket.destroy();
    },
    async schliessen() {
      this.lasseLos();
      for (const socket of alle) socket.destroy();
      await new Promise((fertig) => server.close(fertig));
    },
  });
}

async function mitPgDienst(t, umgebung, pruefung) {
  const db = await echteDatenbank(t);
  if (!db) return;
  const weiche = await starteWeiche(db.adresse);
  try {
    await mitGemeldetemDienst(
      { antworte: antwortetMit(HTTP_OK), umgebung: pgStartUmgebung(weiche.adresse, umgebung) },
      async (dienst, empfaenger) => {
        try {
          await pruefung({ db, weiche, dienst, empfaenger });
        } finally {
          weiche.lasseLos();
        }
      },
    );
  } finally {
    await weiche.schliessen();
  }
}

async function mitVerwaltung(aktion) {
  const verwaltung = new pg.Client({ connectionString: process.env[POSTGRES_VARIABLE] });
  await verwaltung.connect();
  try {
    return await aktion(verwaltung);
  } finally {
    await verwaltung.end();
  }
}

const datenbankName = (db) => new URL(db.adresse).pathname.slice(1);

async function zaehle(verwaltung, anfrage) {
  const {
    rows: [{ anzahl }],
  } = await verwaltung.query(anfrage);
  return anzahl;
}

async function anzahlBis(verwaltung, anfrage, erreicht) {
  let anzahl = 0;
  for (let versuch = 0; versuch < ABFRAGE_VERSUCHE; versuch += 1) {
    anzahl = await zaehle(verwaltung, anfrage);
    if (erreicht(anzahl)) return anzahl;
    await echtWarten(ABFRAGE_PAUSE_MS);
  }
  return anzahl;
}

const beantwortbarePruefungen = (weiche) => weiche.beantwortbareAnfragen.filter((text) => text === PRUEF_ABFRAGE).length;

function assertKeineMeldungOhnePruefung(empfaenger, weiche) {
  assert.ok(empfaenger.meldungen.length <= beantwortbarePruefungen(weiche), TOTE_DATENBANK_MELDET);
}

async function assertGesundGemeldet(empfaenger, anzahl = 1) {
  const gemeldet = await wirdWahr(() => empfaenger.meldungen.length >= anzahl);
  assert.equal(gemeldet, true, MELDET_NICHT);
}

async function assertDienstLebt(dienst) {
  assert.equal(dienst.child.exitCode, null, DIENST_BEENDET);
  for (const wort of ["uncaughtException", "unhandledRejection"]) {
    assert.equal(dienst.stdout.includes(wort), false, `Lebenszeichen: ${wort} im Log`);
  }
}

async function assertGrundImLog(dienst) {
  const erschienen = await wirdWahr(() =>
    lebenszeichenZeilen(dienst).some((zeile) => GRUND_ZEILE.test(zeile)),
  );
  assert.equal(erschienen, true, KEIN_GRUND_IM_LOG);
}

async function assertTreiberGrundImLog(dienst) {
  const nennt = await wirdWahr(() =>
    lebenszeichenZeilen(dienst).some((zeile) => TREIBER_GRUND_ZEILE.test(zeile)),
  );
  assert.equal(nennt, true, "Lebenszeichen: die Logzeile nennt nicht den Grund des Treibers");
}

test("Lebenszeichen: ein Dienst mit toter Datenbank meldet nicht gesund und nennt den Grund im Log", async (t) => {
  await mitPgDienst(t, KURZER_TAKT, async ({ db, weiche, dienst, empfaenger }) => {
    await assertGesundGemeldet(empfaenger);
    const name = datenbankName(db);
    await mitVerwaltung(async (verwaltung) => {
      try {
        await verwaltung.query(SPERRE_SETZEN(name));
        const versuche = weiche.angenommen + VERSUCHE_OHNE_MELDUNG;
        const geprueft = await wirdWahr(() => weiche.angenommen >= versuche);
        assert.equal(geprueft, true, "Lebenszeichen: Dienst prüft die gesperrte Datenbank nicht weiter");
        assertKeineMeldungOhnePruefung(empfaenger, weiche);
        await assertGrundImLog(dienst);
        await assertDienstLebt(dienst);
      } finally {
        await verwaltung.query(SPERRE_AUFHEBEN(name));
      }
    });
  });
});

test("Lebenszeichen: eine hängende Datenbank meldet nicht gesund und löst je Prüfung genau einen Verbindungsversuch aus", async (t) => {
  const umgebung = { ...KURZER_TAKT, HERZSCHLAG_FRIST_MS: LANGE_FRIST_MS };
  await mitPgDienst(t, umgebung, async ({ weiche, empfaenger }) => {
    await assertGesundGemeldet(empfaenger);
    weiche.stelleAuf(SCHWEIGEN);
    const versucht = await wirdWahr(() => weiche.schweigend > 0);
    assert.equal(versucht, true, "Lebenszeichen: Dienst prüft die hängende Datenbank nicht");
    await echtWarten(STILLE_MS);
    assert.equal(
      weiche.schweigend,
      GEHALTENE_PRUEFVERBINDUNGEN_JE_TAKT,
      "Lebenszeichen: hängende Prüfung löst weitere Verbindungsversuche aus",
    );
    assertKeineMeldungOhnePruefung(empfaenger, weiche);
  });
});

test("Lebenszeichen: die Prüfung bricht an einer nie antwortenden Datenbank nach der Frist ab", async (t) => {
  const umgebung = { ...KURZER_TAKT, HERZSCHLAG_FRIST_MS: KURZE_FRIST_MS };
  await mitPgDienst(t, umgebung, async ({ weiche, dienst, empfaenger }) => {
    await assertGesundGemeldet(empfaenger);
    const geschlossenVorher = weiche.geschlossen;
    weiche.stelleAuf(SCHWEIGEN);
    const versucht = await wirdWahr(() => weiche.schweigend > 0);
    assert.equal(versucht, true, "Lebenszeichen: Dienst prüft die schweigende Datenbank nicht");
    const abgebrochen = await wirdWahr(() => weiche.geschlossen > geschlossenVorher);
    assert.equal(abgebrochen, true, "Lebenszeichen: Prüfung bricht nach der Frist nicht ab");
    await assertGrundImLog(dienst);
    await assertTreiberGrundImLog(dienst);
    assertKeineMeldungOhnePruefung(empfaenger, weiche);
  });
});

test("Lebenszeichen: die Prüfung bricht eine nie beantwortete Abfrage nach der Frist ab und schließt die Verbindung", async (t) => {
  const umgebung = { ...KURZER_TAKT, HERZSCHLAG_FRIST_MS: ABFRAGE_FRIST_MS };
  await mitPgDienst(t, umgebung, async ({ weiche, dienst, empfaenger }) => {
    await assertGesundGemeldet(empfaenger);
    const geschlossenVorher = weiche.geschlossen;
    const anfragenVorher = weiche.anfragen.length;
    weiche.stelleAuf(HALTEN);
    const gestellt = await wirdWahr(
      () => weiche.gehaltenePids.length >= 1 && weiche.anfragen.length > anfragenVorher,
    );
    assert.equal(gestellt, true, "Lebenszeichen: Dienst stellt der Datenbank keine Abfrage");
    const abgebrochen = await wirdWahr(() => weiche.geschlossen > geschlossenVorher);
    assert.equal(abgebrochen, true, "Lebenszeichen: Prüfung bricht die hängende Abfrage nicht ab");
    await assertTreiberGrundImLog(dienst);
    assertKeineMeldungOhnePruefung(empfaenger, weiche);
    await assertDienstLebt(dienst);
  });
});

test("Lebenszeichen: Verbindung und Abfrage zusammen überschreiten die Frist nicht", async (t) => {
  const umgebung = { ...KURZER_TAKT, HERZSCHLAG_FRIST_MS: String(GESAMTFRIST_MS) };
  await mitPgDienst(t, umgebung, async ({ weiche, empfaenger }) => {
    await assertGesundGemeldet(empfaenger);
    const geschlossenVorher = weiche.geschlossen;
    weiche.verzoegereBereitUm(VERZOEGERUNGSSCHRITTE_BEIM_VERBINDEN);
    weiche.stelleAuf(HALTEN);
    const versucht = await wirdWahr(() => weiche.haltenAnnahmeMs.length > 0);
    assert.equal(versucht, true, "Lebenszeichen: Dienst prüft die verzögerte Datenbank nicht");
    const [beginnMs] = weiche.haltenAnnahmeMs;
    const abgebrochen = await wirdWahr(() => weiche.geschlossen > geschlossenVorher);
    const dauerMs = performance.now() - beginnMs;
    assert.equal(abgebrochen, true, "Lebenszeichen: Prüfung bricht nicht ab");
    assert.ok(
      dauerMs < GESAMTFRIST_MS + SPIELRAUM_ZUR_GESAMTFRIST_MS,
      `Lebenszeichen: Verbindung und Abfrage brauchten ${dauerMs} ms bei einer Frist von ${GESAMTFRIST_MS} ms`,
    );
  });
});

test("Lebenszeichen: eine langsame, aber antwortende Datenbank innerhalb der Frist meldet gesund", async (t) => {
  const umgebung = { ...KURZER_TAKT, HERZSCHLAG_FRIST_MS: FRIST_FUER_LANGSAME_DATENBANK_MS };
  await mitPgDienst(t, umgebung, async ({ weiche, dienst, empfaenger }) => {
    await assertGesundGemeldet(empfaenger);
    const angenommenVorher = weiche.angenommen;
    weiche.stelleAuf(VERLANGSAMEN);
    const versucht = await wirdWahr(() => weiche.angenommen > angenommenVorher);
    assert.equal(versucht, true, "Lebenszeichen: Dienst prüft die langsame Datenbank nicht");
    const beiBeginn = empfaenger.meldungen.length;
    await assertGesundGemeldet(empfaenger, beiBeginn + MELDUNGEN_NACH_VERLANGSAMEN);
    assert.equal(lebenszeichenZeilen(dienst).length, 0, "Lebenszeichen: Zeile trotz Antwort");
  });
});

test("Lebenszeichen: ein Verzug nur im Messtakt, ohne späten Herzschlag-Takt, verhindert die nächste Meldung", async () => {
  const umgebung = {
    HERZSCHLAG_TAKT_MS: String(LANGER_TAKT_FUER_ANHALTEN_MS),
    HERZSCHLAG_VERZUG_GRENZE_MS: HOEHERER_VERZUG_ALS_GRENZE_MS,
  };
  await mitGemeldetemDienst(
    { antworte: antwortetMit(HTTP_OK), umgebung },
    async (dienst, empfaenger) => {
      await assertGesundGemeldet(empfaenger, GESUNDE_MELDUNGEN);
      const anzahl = empfaenger.meldungen.length;
      const ausgangMs = empfaenger.meldungen.at(-1).zeitMs;
      try {
        dienst.child.kill("SIGSTOP");
        await echtWarten(ANHALTEN_MIT_MESSTAKT_VERZUG_MS);
      } finally {
        dienst.child.kill("SIGCONT");
      }
      const naechste = await wirdWahr(() => empfaenger.meldungen.length > anzahl);
      assert.equal(naechste, true, "Lebenszeichen: nach dem Anhalten kommt keine Meldung mehr");
      const abstandMs = empfaenger.meldungen[anzahl].zeitMs - ausgangMs;
      assert.ok(
        abstandMs >= LANGER_TAKT_FUER_ANHALTEN_MS * ZEITEN_PRO_TAKT_UEBERSPRUNGEN,
        `${VERZUG_MELDET} (nach ${abstandMs} ms)`,
      );
    },
  );
});

test("Lebenszeichen: wird die gehaltene Prüfverbindung getrennt, lebt der Dienst weiter, meldet in diesem Takt nicht und nennt einen Grund", async (t) => {
  const umgebung = { ...KURZER_TAKT, HERZSCHLAG_FRIST_MS: LANGE_FRIST_MS };
  await mitPgDienst(t, umgebung, async ({ db, weiche, dienst, empfaenger }) => {
    await assertGesundGemeldet(empfaenger);
    const gesehenVorher = weiche.angenommen;
    weiche.stelleAuf(HALTEN);
    const gehalten = await wirdWahr(() => weiche.gehaltenePids.length >= 1);
    assert.equal(
      gehalten,
      true,
      `Dienst mit Postgres öffnet keine Prüfverbindung: Weiche sah ${weiche.angenommen - gesehenVorher} neue Verbindungen, keine bereit`,
    );
    const [pid] = weiche.gehaltenePids;
    const name = datenbankName(db);
    await mitVerwaltung(async (verwaltung) => {
      const anfrage = { text: VERBINDUNG_MIT_PID, values: [name, pid] };
      const sichtbar = await anzahlBis(verwaltung, anfrage, (n) => n > 0);
      assert.equal(
        sichtbar,
        1,
        `Keine gehaltene Verbindung in pg_stat_activity: Bereit-Port der Weiche gesehen, Pid ${pid} aber ${sichtbar}-mal in ${name}`,
      );
      assert.equal(lebenszeichenZeilen(dienst).length, 0, "Lebenszeichen: Zeile vor dem Trennen");
      await verwaltung.query("SELECT pg_terminate_backend($1)", [pid]);
    });
    await assertGrundImLog(dienst);
    assertKeineMeldungOhnePruefung(empfaenger, weiche);
    await assertDienstLebt(dienst);
  });
});

test("Lebenszeichen: die Prüfverbindung wird je Takt wieder geschlossen, die Zahl der Verbindungen wächst nicht", async (t) => {
  await mitPgDienst(t, KURZER_TAKT, async ({ db, empfaenger }) => {
    await assertGesundGemeldet(empfaenger, GESUNDE_MELDUNGEN);
    const name = datenbankName(db);
    await mitVerwaltung(async (verwaltung) => {
      const anfrage = { text: VERBINDUNGEN_DER_DATENBANK, values: [name] };
      const vorher = await zaehle(verwaltung, anfrage);
      await assertGesundGemeldet(empfaenger, empfaenger.meldungen.length + WEITERE_TAKTE);
      const nachher = await zaehle(verwaltung, anfrage);
      assert.ok(
        nachher <= vorher + GEHALTENE_PRUEFVERBINDUNGEN_JE_TAKT,
        `Lebenszeichen: Verbindungen wachsen von ${vorher} auf ${nachher}`,
      );
    });
  });
});

test("Lebenszeichen: jede Prüfung stellt der Datenbank eine Anfrage", async (t) => {
  await mitPgDienst(t, KURZER_TAKT, async ({ weiche, empfaenger }) => {
    await assertGesundGemeldet(empfaenger, GESUNDE_MELDUNGEN);
    assert.ok(weiche.anfragen.length >= GESUNDE_MELDUNGEN, "Lebenszeichen: Prüfung ohne Anfrage");
    const leer = weiche.anfragen.filter((text) => text.trim() === "");
    assert.deepEqual(leer, [], "Lebenszeichen: Prüfung stellt eine leere Anfrage");
  });
});

test("Lebenszeichen: ein Event-Loop-Verzug über der Grenze verhindert die Meldung, danach kommt die nächste", async () => {
  const umgebung = { ...KURZER_TAKT, HERZSCHLAG_VERZUG_GRENZE_MS: KLEINE_VERZUGSGRENZE_MS };
  await mitGemeldetemDienst(
    { antworte: antwortetMit(HTTP_OK), umgebung },
    async (dienst, empfaenger) => {
      await assertGesundGemeldet(empfaenger, GESUNDE_MELDUNGEN);
      let weckMs = null;
      try {
        dienst.child.kill("SIGSTOP");
        await echtWarten(ANHALTEN_MS);
        weckMs = performance.now();
      } finally {
        dienst.child.kill("SIGCONT");
      }
      const nachDemAnhalten = () => empfaenger.meldungen.find(({ zeitMs }) => zeitMs >= weckMs);
      const wieder = await wirdWahr(() => nachDemAnhalten() !== undefined);
      assert.equal(wieder, true, "Lebenszeichen: nach dem Anhalten kommt keine Meldung mehr");
      const abstand = nachDemAnhalten().zeitMs - weckMs;
      assert.ok(
        abstand >= MINDESTABSTAND_NACH_ANHALTEN_MS,
        `${VERZUG_MELDET} (nach ${abstand} ms)`,
      );
    },
  );
});

test("Lebenszeichen: ein gesunder Dienst mit Verzugsgrenze unter dem Takt meldet weiter", async () => {
  const umgebung = {
    HERZSCHLAG_TAKT_MS: LANGER_TAKT_MS,
    HERZSCHLAG_VERZUG_GRENZE_MS: VERZUG_GRENZE_UNTER_TAKT_MS,
  };
  await mitGemeldetemDienst(
    { antworte: antwortetMit(HTTP_OK), umgebung },
    async (_dienst, empfaenger) => {
      await assertGesundGemeldet(empfaenger, GESUNDE_MELDUNGEN);
    },
  );
});

test("Lebenszeichen: ein Dienst mit JSON-Speicher meldet ohne Datenbankprüfung", async () => {
  const umgebung = {
    ...KURZER_TAKT,
    DATABASE_URL: UNGEDACHTE_ADRESSE,
    HERZSCHLAG_FRIST_MS: KURZE_FRIST_MS,
  };
  await mitGemeldetemDienst(
    { antworte: antwortetMit(HTTP_OK), umgebung },
    async (dienst, empfaenger) => {
      await assertGesundGemeldet(empfaenger, GESUNDE_MELDUNGEN);
      assert.deepEqual(lebenszeichenZeilen(dienst).filter((zeile) => DB_PRUEFUNG_ZEILE.test(zeile)), [], "Lebenszeichen: JSON-Speicher prüft DB");
    },
  );
});
