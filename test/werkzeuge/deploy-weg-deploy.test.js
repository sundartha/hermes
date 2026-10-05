import assert from "node:assert/strict";
import { test } from "node:test";

import { deploy } from "../../tools/deploy-weg/deploy.mjs";
import { einstellungenLesen } from "../../tools/deploy-weg/einstellungen.mjs";
import {
  AUFWACHEN_FRIST_MS,
  AUFWACHEN_SCHUTZGRENZE_MS,
  AUFWACHEN_TAKT_MS,
  AUFWACHEN_TAKTE,
  DEPLOY_TAKTE,
  FRISCH_GEWECKT_AB_MS,
  RUHEFENSTER_MS,
  STAGING_TAKTE,
} from "../../tools/deploy-weg/takt.mjs";
import {
  ALTER_DEPLOY,
  anfragenAn,
  attrappeStarten,
  COMMIT_C,
  COMMIT_P,
  DEPLOY_ID,
  DEPLOY_TOKEN,
  DEPLOYS_PFAD,
  einstellungenFuer,
  HTTP_ANGENOMMEN,
  HTTP_KONFLIKT,
  KURZE_DEPLOY_TAKTE,
  KURZE_TAKTE,
  NEUERER,
  RENDER_SCHLUESSEL,
  sammler,
  testUhr,
  umgebungFuer,
  weltAnlegen,
} from "./deploy-weg-attrappe.mjs";

const MINUTE_MS = 60000;
const SEKUNDE_MS = 1000;
const ANRUFE_TAKT_S = 60;
const ANRUFE_GRENZE_MIN = 35;
const STATUS_TAKT_S = 30;
const STATUS_GRENZE_MIN = 30;
const HEALTHZ_GRENZE_MIN = 10;
const STAGING_GRENZE_MIN = 20;
const AUFWACHEN_FRIST_S = 90;
const AUFWACHEN_TAKT_S = 20;
const AUFWACHEN_GRENZE_MIN = 5;
const FRISCH_AB_S = 15;
const RUHEFENSTER_MIN = 20;
const DEPLOY_SUMME_MIN = 105;
const DEPLOY_JOB_MIN = 120;
const ZWEI_STATUS_SCHLEIFEN = 2;
const ZWEI_ANRUFE = 2;
const ZWEI_WECKVERSUCHE = 2;
const SPAETER_ANRUF_MINUTE = 16;
const FUENF_STATUS = 5;
const DREI_SUCHRUNDEN = 3;
const HEALTHZ_VOR_DEM_UMSCHALTEN = 3;
const LANGSAME_WECK_ANTWORT_MS = 25_000;
const ABFRAGEN_IM_RUHEFENSTER = RUHEFENSTER_MS / (ANRUFE_TAKT_S * SEKUNDE_MS) + 1;
const AUSLOESEN = /\/deploys$/;
const LISTE = /\/deploys\?limit=20$/;
const ABBRECHEN = /\/cancel$/;
const ANRUFE = /\/intern\/anrufe-laufend$/;
const PROD_HEALTHZ = /\/prod\/healthz$/;
const STATUS_ABFRAGE = new RegExp("/deploys/" + DEPLOY_ID + "$");
const FALSCHES_TOKEN = "f".repeat(DEPLOY_TOKEN.length);

async function deployMit(kontext, optionen = {}) {
  const { welt = {}, mehr = {}, takte = KURZE_DEPLOY_TAKTE, frischGeweckt } = optionen;
  const lage = weltAnlegen({ produktion: [COMMIT_P, COMMIT_C], ...welt });
  const uhr = testUhr();
  const attrappe = await attrappeStarten(kontext, lage, uhr);
  const einstellungen = einstellungenFuer("deploy", attrappe.basis, mehr);
  const { zeilen, ausgabe } = sammler();
  const rahmen = { einstellungen, commit: COMMIT_C, produktion: COMMIT_P, ausgabe, uhr };
  const ok = await deploy({ ...rahmen, frischGeweckt, takte });
  return { ok, text: zeilen.join("\n"), attrappe, uhr };
}

function deployPost(lauf) {
  const posts = anfragenAn(lauf.attrappe, "POST", AUSLOESEN);
  assert.equal(posts.length, 1);
  return posts[0];
}

function anrufeBis(lauf, zeit) {
  return anfragenAn(lauf.attrappe, "GET", ANRUFE).filter((anfrage) => anfrage.zeit <= zeit);
}

function keinDeployPost(lauf) {
  assert.equal(lauf.ok, false);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", AUSLOESEN), []);
}

test("deploy grün: genau ein Deploy-POST mit commitId des Kandidaten, Status bis live, danach meldet /healthz den Kandidaten", async (kontext) => {
  const lauf = await deployMit(kontext);
  assert.equal(lauf.ok, true);
  const posts = anfragenAn(lauf.attrappe, "POST", AUSLOESEN);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].pfad, DEPLOYS_PFAD);
  assert.deepEqual(posts[0].koerper, { commitId: COMMIT_C });
  assert.equal(posts[0].kopf, "Bearer " + RENDER_SCHLUESSEL);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", ABBRECHEN), []);
  const anrufe = anfragenAn(lauf.attrappe, "GET", ANRUFE);
  assert.equal(anrufe.length, ZWEI_ANRUFE);
  assert.ok(anrufe.every((anfrage) => anfrage.kopf === "Bearer " + DEPLOY_TOKEN));
  const reihenfolge = lauf.attrappe.anfragen.map(({ pfad }) => pfad);
  assert.ok(reihenfolge.findIndex((pfad) => ANRUFE.test(pfad)) < reihenfolge.indexOf(DEPLOYS_PFAD));
  assert.match(lauf.text, /Deploy-Status: update_in_progress/);
  assert.match(lauf.text, new RegExp("Produktion fährt jetzt " + COMMIT_C));
});

test("deploy grün über 202: die Deploy-ID kommt aus der Liste, ein älterer API-Deploy desselben Commits zählt nicht", async (kontext) => {
  const welt = { ausloesenStatus: HTTP_ANGENOMMEN, alteDeploys: [ALTER_DEPLOY] };
  const lauf = await deployMit(kontext, { welt });
  assert.equal(lauf.ok, true);
  assert.equal(anfragenAn(lauf.attrappe, "POST", AUSLOESEN).length, 1);
  assert.ok(anfragenAn(lauf.attrappe, "GET", new RegExp("/deploys/" + DEPLOY_ID + "$")).length > 0);
  assert.deepEqual(anfragenAn(lauf.attrappe, "GET", new RegExp("/deploys/" + ALTER_DEPLOY)), []);
});

test("deploy wartet, bis kein Anruf mehr läuft, und deployt erst dann", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { laufend: [ZWEI_ANRUFE, 1, 0, 0] } });
  assert.equal(lauf.ok, true);
  assert.equal(anfragenAn(lauf.attrappe, "POST", AUSLOESEN).length, 1);
  assert.deepEqual(lauf.uhr.wartezeiten.slice(0, ZWEI_ANRUFE), [
    KURZE_TAKTE.taktMs,
    KURZE_TAKTE.taktMs,
  ]);
  assert.match(lauf.text, /Laufende Anrufe in Produktion: 2/);
});

test("deploy rot: ein Anruf läuft bis zur Schutzgrenze, kein Deploy-POST", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { laufend: [1] } });
  keinDeployPost(lauf);
  assert.match(lauf.text, /Schutzgrenze im Schritt anrufe erreicht/);
  assert.ok(lauf.uhr.jetzt() >= KURZE_TAKTE.schutzgrenzeMs);
});

test("deploy rot: die Anruf-Abfrage lehnt das Token ab, kein Deploy-POST", async (kontext) => {
  const lauf = await deployMit(kontext, { mehr: { HERMES_DEPLOY_TOKEN: FALSCHES_TOKEN } });
  keinDeployPost(lauf);
  assert.match(lauf.text, /Abbruch im Schritt anrufe: HTTP 401/);
});

test("deploy rot: Produktion fährt nicht mehr den Commit aus der Entscheidung, kein Deploy-POST", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { produktion: [NEUERER] } });
  keinDeployPost(lauf);
  assert.match(lauf.text, /Produktion fährt nicht mehr den Commit aus der Entscheidung/);
});

test("deploy rot: beim Umschalten (update_in_progress) läuft ein Anruf, der Deploy wird abgebrochen", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { laufend: [0, 1] } });
  assert.equal(lauf.ok, false);
  const abbrueche = anfragenAn(lauf.attrappe, "POST", ABBRECHEN);
  assert.deepEqual(
    abbrueche.map(({ pfad }) => pfad),
    [DEPLOYS_PFAD + "/" + DEPLOY_ID + "/cancel"],
  );
  assert.match(lauf.text, /beim Umschalten läuft ein Anruf/);
  assert.doesNotMatch(lauf.text, /Produktion fährt jetzt/);
});

test("deploy rot: der Deploy endet mit build_failed, ohne Abbruch-Anfrage", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { deployStatus: ["build_in_progress", "build_failed"] } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Rot: der Deploy endet mit build_failed/);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", ABBRECHEN), []);
});

test("deploy rot: jeder rote Endzustand beendet die Verfolgung", async (kontext) => {
  for (const endzustand of ["update_failed", "canceled", "pre_deploy_failed", "deactivated"]) {
    const lauf = await deployMit(kontext, { welt: { deployStatus: ["queued", endzustand] } });
    assert.equal(lauf.ok, false);
    assert.match(lauf.text, new RegExp("endet mit " + endzustand));
  }
});

test("deploy rot: der Status wird bis zur Schutzgrenze nicht live, der Deploy wird abgebrochen", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { deployStatus: ["build_in_progress"] } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Schutzgrenze im Schritt deploy_status erreicht/);
  assert.equal(anfragenAn(lauf.attrappe, "POST", ABBRECHEN).length, 1);
});

test("deploy rot: Render lehnt den Deploy mit 409 ab, keine Status-Abfrage", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { ausloesenStatus: HTTP_KONFLIKT } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Deploy angefordert: HTTP 409/);
  assert.deepEqual(anfragenAn(lauf.attrappe, "GET", /\/deploys\/dep-/), []);
});

test("deploy rot: nach live meldet /healthz den Kandidaten nicht innerhalb der Schutzgrenze", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { produktion: [COMMIT_P] } });
  assert.equal(lauf.ok, false);
  assert.match(lauf.text, /Schutzgrenze im Schritt healthz erreicht/);
});

test("deploy maskiert Render-Schlüssel und Deploy-Token und schreibt sie sonst nirgends hin", async (kontext) => {
  const { zeilen, ausgabe } = sammler();
  einstellungenLesen("deploy", umgebungFuer("http://127.0.0.1:9"), ausgabe);
  assert.deepEqual(zeilen, ["::add-mask::" + RENDER_SCHLUESSEL, "::add-mask::" + DEPLOY_TOKEN]);
  const lauf = await deployMit(kontext);
  assert.equal(lauf.ok, true);
  assert.ok(!lauf.text.includes(RENDER_SCHLUESSEL));
  assert.ok(!lauf.text.includes(DEPLOY_TOKEN));
});

test("Schutzgrenzen und Takte des echten Laufs stehen fest", () => {
  assert.equal(DEPLOY_TAKTE.anrufe.taktMs, ANRUFE_TAKT_S * SEKUNDE_MS);
  assert.equal(DEPLOY_TAKTE.anrufe.schutzgrenzeMs, ANRUFE_GRENZE_MIN * MINUTE_MS);
  assert.equal(DEPLOY_TAKTE.status.taktMs, STATUS_TAKT_S * SEKUNDE_MS);
  assert.equal(DEPLOY_TAKTE.status.schutzgrenzeMs, STATUS_GRENZE_MIN * MINUTE_MS);
  assert.equal(DEPLOY_TAKTE.healthz.schutzgrenzeMs, HEALTHZ_GRENZE_MIN * MINUTE_MS);
  assert.equal(STAGING_TAKTE.schutzgrenzeMs, STAGING_GRENZE_MIN * MINUTE_MS);
  assert.equal(AUFWACHEN_FRIST_MS, AUFWACHEN_FRIST_S * SEKUNDE_MS);
  assert.equal(AUFWACHEN_TAKT_MS, AUFWACHEN_TAKT_S * SEKUNDE_MS);
  assert.equal(AUFWACHEN_SCHUTZGRENZE_MS, AUFWACHEN_GRENZE_MIN * MINUTE_MS);
  assert.equal(FRISCH_GEWECKT_AB_MS, FRISCH_AB_S * SEKUNDE_MS);
  assert.equal(RUHEFENSTER_MS, RUHEFENSTER_MIN * MINUTE_MS);
  assert.deepEqual(
    { ...AUFWACHEN_TAKTE },
    {
      fristMs: AUFWACHEN_FRIST_MS,
      taktMs: AUFWACHEN_TAKT_MS,
      schutzgrenzeMs: AUFWACHEN_SCHUTZGRENZE_MS,
      frischAbMs: FRISCH_GEWECKT_AB_MS,
    },
  );
  assert.equal(DEPLOY_TAKTE.aufwachen, AUFWACHEN_TAKTE);
  assert.equal(DEPLOY_TAKTE.ruhefensterMs, RUHEFENSTER_MS);
  const schlimmstenfalls =
    DEPLOY_TAKTE.anrufe.schutzgrenzeMs +
    ZWEI_STATUS_SCHLEIFEN * DEPLOY_TAKTE.status.schutzgrenzeMs +
    DEPLOY_TAKTE.healthz.schutzgrenzeMs;
  assert.equal(schlimmstenfalls, DEPLOY_SUMME_MIN * MINUTE_MS);
  assert.ok(schlimmstenfalls < DEPLOY_JOB_MIN * MINUTE_MS);
});

test("deploy: Produktion schläft vor der Anruf-Abfrage, wacht innerhalb der Grenze auf und wird erst nach dem Ruhefenster deployt", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { wach: [false, false, true] }, takte: DEPLOY_TAKTE });
  assert.equal(lauf.ok, true);
  assert.deepEqual(lauf.uhr.wartezeiten.slice(0, ZWEI_WECKVERSUCHE), [
    AUFWACHEN_TAKT_MS,
    AUFWACHEN_TAKT_MS,
  ]);
  const wachZeit = ZWEI_WECKVERSUCHE * AUFWACHEN_TAKT_MS;
  const post = deployPost(lauf);
  assert.equal(post.zeit - wachZeit, RUHEFENSTER_MS);
  const anrufe = anrufeBis(lauf, post.zeit);
  assert.equal(anrufe.length, ABFRAGEN_IM_RUHEFENSTER);
  assert.equal(anrufe[0].zeit, wachZeit);
  assert.match(lauf.text, /Produktion hat geschlafen und ist frisch geweckt/);
  assert.match(lauf.text, /Deploy erst nach 20 Minuten ohne laufende Anrufe/);
  assert.match(lauf.text, new RegExp("Produktion fährt jetzt " + COMMIT_C));
});

test("deploy rot: Produktion wacht vor der Anruf-Abfrage nicht auf (nur die Ladeseite mit HTTP 200), keine Anruf-Abfrage, kein Deploy-POST", async (kontext) => {
  const lauf = await deployMit(kontext, { welt: { wach: [false] }, takte: DEPLOY_TAKTE });
  keinDeployPost(lauf);
  assert.match(lauf.text, /Rot: Produktion ist im Schritt anrufe nach 5 Minuten nicht aufgewacht/);
  assert.deepEqual(anfragenAn(lauf.attrappe, "GET", ANRUFE), []);
  assert.equal(lauf.uhr.jetzt(), AUFWACHEN_SCHUTZGRENZE_MS);
});

test("deploy frisch geweckt laut entscheiden: Deploy-POST erst nach 20 Minuten durchgehend ohne laufende Anrufe", async (kontext) => {
  const lauf = await deployMit(kontext, { frischGeweckt: true, takte: DEPLOY_TAKTE });
  assert.equal(lauf.ok, true);
  const post = deployPost(lauf);
  assert.equal(post.zeit, RUHEFENSTER_MS);
  assert.equal(anrufeBis(lauf, post.zeit).length, ABFRAGEN_IM_RUHEFENSTER);
  assert.doesNotMatch(lauf.text, /Produktion hat geschlafen/);
  assert.match(lauf.text, /Deploy erst nach 20 Minuten ohne laufende Anrufe/);
});

test("deploy frisch geweckt: ein laufender Anruf startet das Ruhefenster neu", async (kontext) => {
  const laufend = [0, 0, 0, 0, 0, 1, 0];
  const bisNeustart = laufend.indexOf(1);
  const welt = { laufend };
  const lauf = await deployMit(kontext, { welt, frischGeweckt: true, takte: DEPLOY_TAKTE });
  assert.equal(lauf.ok, true);
  const post = deployPost(lauf);
  const anrufe = anrufeBis(lauf, post.zeit);
  assert.equal(post.zeit - anrufe[bisNeustart].zeit, RUHEFENSTER_MS);
  assert.equal(anrufe.length, bisNeustart + ABFRAGEN_IM_RUHEFENSTER);
  assert.match(lauf.text, /Laufende Anrufe in Produktion: 1/);
});

test("deploy rot frisch geweckt: das neu gestartete Ruhefenster passt nicht mehr in die 35-Minuten-Grenze, kein Deploy-POST", async (kontext) => {
  const laufend = [...new Array(SPAETER_ANRUF_MINUTE).fill(0), 1, 0];
  const lauf = await deployMit(kontext, { welt: { laufend }, frischGeweckt: true, takte: DEPLOY_TAKTE });
  keinDeployPost(lauf);
  assert.match(lauf.text, /Schutzgrenze im Schritt anrufe erreicht nach 35 Minuten/);
  assert.equal(lauf.uhr.jetzt(), ANRUFE_GRENZE_MIN * MINUTE_MS);
});

test("deploy rot: Produktion ist beim ersten update_in_progress frisch geweckt, die Zählung gilt als nicht gemessen, der Deploy wird abgebrochen", async (kontext) => {
  const welt = { wach: [true, true, true, false, true] };
  const lauf = await deployMit(kontext, { welt, takte: DEPLOY_TAKTE });
  assert.equal(lauf.ok, false);
  assert.deepEqual(
    anfragenAn(lauf.attrappe, "POST", ABBRECHEN).map(({ pfad }) => pfad),
    [DEPLOYS_PFAD + "/" + DEPLOY_ID + "/cancel"],
  );
  assert.equal(anfragenAn(lauf.attrappe, "GET", ANRUFE).length, 1);
  assert.match(lauf.text, /Produktion hat geschlafen und ist frisch geweckt/);
  assert.match(lauf.text, /beim Umschalten war Produktion frisch geweckt oder nicht wach/);
  assert.doesNotMatch(lauf.text, /Produktion fährt jetzt/);
});

test("deploy rot: Produktion wacht beim ersten update_in_progress nicht auf, der Deploy wird abgebrochen", async (kontext) => {
  const welt = { wach: [true, true, true, false] };
  const lauf = await deployMit(kontext, { welt, takte: DEPLOY_TAKTE });
  assert.equal(lauf.ok, false);
  assert.equal(anfragenAn(lauf.attrappe, "POST", ABBRECHEN).length, 1);
  assert.match(lauf.text, /im Schritt deploy_status nach 5 Minuten nicht aufgewacht/);
  assert.match(lauf.text, /die Anrufzahl gilt als nicht gemessen/);
});

test("deploy rot: nach live wacht Produktion vor der /healthz-Abfrage nicht auf", async (kontext) => {
  const welt = { wach: [true, true, true, true, true, false] };
  const lauf = await deployMit(kontext, { welt, takte: DEPLOY_TAKTE });
  assert.equal(lauf.ok, false);
  assert.equal(deployPost(lauf).koerper.commitId, COMMIT_C);
  assert.match(lauf.text, /Deploy-Status: live/);
  assert.match(lauf.text, /im Schritt healthz nach 5 Minuten nicht aufgewacht/);
  assert.doesNotMatch(lauf.text, /Produktion fährt jetzt/);
});

test("deploy hält Produktion wach: zwischen zwei Abfragen des Deploy-Status fragt er /healthz", async (kontext) => {
  const deployStatus = ["queued", "build_in_progress", "build_in_progress", "update_in_progress", "live"];
  const lauf = await deployMit(kontext, { welt: { deployStatus } });
  assert.equal(lauf.ok, true);
  const pfade = lauf.attrappe.anfragen.map(({ pfad }) => pfad);
  const abfragen = pfade.flatMap((pfad, stelle) => (STATUS_ABFRAGE.test(pfad) ? [stelle] : []));
  assert.equal(abfragen.length, FUENF_STATUS);
  assert.ok(abfragen.slice(0, -1).every((stelle) => PROD_HEALTHZ.test(pfade[stelle + 1])));
  assert.ok(abfragen.slice(1).every((stelle) => PROD_HEALTHZ.test(pfade[stelle - 1])));
});

test("deploy rot: beim ersten update_in_progress wird vor dem Wachhalten geweckt, eine Weck-Antwort nach 25 Sekunden gilt als frisch geweckt", async (kontext) => {
  const healthzDauerMs = [...new Array(HEALTHZ_VOR_DEM_UMSCHALTEN).fill(0), LANGSAME_WECK_ANTWORT_MS, 0];
  const lauf = await deployMit(kontext, { welt: { healthzDauerMs }, takte: DEPLOY_TAKTE });
  assert.equal(lauf.ok, false);
  const { anfragen } = lauf.attrappe;
  const umschalten = anfragen.findLastIndex(({ pfad }) => STATUS_ABFRAGE.test(pfad));
  const [wecken, danach] = anfragen.slice(umschalten + 1);
  assert.match(wecken.pfad, PROD_HEALTHZ);
  assert.equal(danach.zeit - wecken.zeit, LANGSAME_WECK_ANTWORT_MS);
  assert.deepEqual(
    anfragenAn(lauf.attrappe, "POST", ABBRECHEN).map(({ pfad }) => pfad),
    [DEPLOYS_PFAD + "/" + DEPLOY_ID + "/cancel"],
  );
  assert.equal(anfragenAn(lauf.attrappe, "GET", ANRUFE).length, 1);
  assert.match(lauf.text, /Produktion hat geschlafen und ist frisch geweckt/);
  assert.match(lauf.text, /beim Umschalten war Produktion frisch geweckt oder nicht wach/);
});

test("deploy über 202: Deploy suchen hält Produktion wach, nach jeder Runde ohne neuen Deploy fragt er /healthz", async (kontext) => {
  const welt = { ausloesenStatus: HTTP_ANGENOMMEN, neuInListe: [false, false, true] };
  const lauf = await deployMit(kontext, { welt });
  assert.equal(lauf.ok, true);
  const pfade = lauf.attrappe.anfragen.map(({ methode, pfad }) => methode + " " + pfad);
  const post = pfade.indexOf("POST " + DEPLOYS_PFAD);
  const suche = pfade.flatMap((pfad, stelle) => (stelle > post && LISTE.test(pfad) ? [stelle] : []));
  assert.equal(suche.length, DREI_SUCHRUNDEN);
  assert.ok(suche.slice(0, -1).every((stelle) => PROD_HEALTHZ.test(pfade[stelle + 1])));
  assert.match(pfade[suche.at(-1) + 1], STATUS_ABFRAGE);
});
