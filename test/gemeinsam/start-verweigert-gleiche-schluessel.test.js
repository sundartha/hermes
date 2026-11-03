import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startServerExpectExit } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";

const ERWARTETER_FEHLER = "Start mit gleichem Status- und Deploy-Schluessel wird nicht verweigert";
const SCHLUESSEL_LAENGE = 32;
const GEMEINSAMER_SCHLUESSEL = "Gq7vR2mK9wXc4TnB8zLp3HdY6sFj1UaE";
const STATUS_SCHLUESSEL = "St4tusN8rLes3K2pQ9wXmB7cV1zR5yHa";
const DEPLOY_SCHLUESSEL = "D3pl0yW3gK7mQ2xN9vB4cR8tY1sL6hJf";
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const LAEUFT_NOCH = "laeuft noch";

async function startMitSchluesseln(statusWert, deployWert, mehr = {}) {
  const env = { HERMES_STATUS_TOKEN: statusWert, HERMES_DEPLOY_TOKEN: deployWert, ...mehr };
  return startServerExpectExit({ env }).catch((fehler) => ({
    code: LAEUFT_NOCH,
    output: fehler.message,
  }));
}

function nenntBeideNamenOhneWert(output, wert) {
  assert.match(output, /HERMES_STATUS_TOKEN/);
  assert.match(output, /HERMES_DEPLOY_TOKEN/);
  assert.equal(output.includes(wert), false, "Ausgabe enthaelt den Schluesselwert");
  assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
}

async function healthzBeiSchluesseln(env) {
  const srv = await startServer({ env });
  try {
    return (await abrufMitFrist(`${srv.localUrl}/healthz`)).status;
  } finally {
    await srv.stop();
  }
}

function mitBearer(schluessel) {
  return { headers: { authorization: `Bearer ${schluessel}` } };
}

test("gleicher Status- und Deploy-Schluessel ohne RENDER_EXTERNAL_URL: Start bricht mit Exit 1 ab und nennt nur die Namen", async () => {
  assert.equal(GEMEINSAMER_SCHLUESSEL.length, SCHLUESSEL_LAENGE);
  const { code, output } = await startMitSchluesseln(
    GEMEINSAMER_SCHLUESSEL,
    GEMEINSAMER_SCHLUESSEL,
  );
  assert.equal(code, 1, ERWARTETER_FEHLER);
  nenntBeideNamenOhneWert(output, GEMEINSAMER_SCHLUESSEL);
});

test("gleicher Schluessel mit Leerzeichen am Ende und Zeilenumbruch am Anfang: Start bricht ebenso ab", async () => {
  const { code, output } = await startMitSchluesseln(
    `${GEMEINSAMER_SCHLUESSEL} `,
    `\n${GEMEINSAMER_SCHLUESSEL}`,
  );
  assert.equal(code, 1, ERWARTETER_FEHLER);
  nenntBeideNamenOhneWert(output, GEMEINSAMER_SCHLUESSEL);
});

test("[NIE1] nach dem Trimmen gleiche Schluessel mit Tab und Zeilenumbruch am Ende starten auch bei leerem RENDER_EXTERNAL_URL nicht", async () => {
  const { code, output } = await startMitSchluesseln(
    `\t${GEMEINSAMER_SCHLUESSEL}\n`,
    `  ${GEMEINSAMER_SCHLUESSEL}`,
    { RENDER_EXTERNAL_URL: "" },
  );
  assert.notEqual(code, LAEUFT_NOCH, "Hermes laeuft trotz gleicher Schluessel");
  assert.notEqual(code, 0);
  assert.doesNotMatch(output, /Gateway laeuft/);
});

function abbruchmeldung(output) {
  return output
    .split("\n")
    .filter(
      (zeile) => zeile.includes("HERMES_STATUS_TOKEN") && zeile.includes("HERMES_DEPLOY_TOKEN"),
    );
}

test("[NIE2] die Abbruchmeldung bei gleichen Schluesseln nennt beide Namen, aber keinen der beiden Werte", async () => {
  const { output } = await startMitSchluesseln(
    `${GEMEINSAMER_SCHLUESSEL}  `,
    `\r\n${GEMEINSAMER_SCHLUESSEL}`,
  );
  const meldung = abbruchmeldung(output);
  assert.equal(
    meldung.length,
    1,
    "keine Abbruchmeldung mit beiden Schluesselnamen in der Startausgabe",
  );
  assert.deepEqual(
    meldung.filter((zeile) => zeile.includes(GEMEINSAMER_SCHLUESSEL)),
    [],
    "Abbruchmeldung enthaelt den Schluesselwert",
  );
  assert.equal(
    output.includes(GEMEINSAMER_SCHLUESSEL),
    false,
    "Schluesselwert in der Startausgabe",
  );
});

test("[NIE3] verschiedene Schluessel starten und Status- und Deploy-Weg pruefen je ihren eigenen Schluessel", async () => {
  const srv = await startServer({
    env: { HERMES_STATUS_TOKEN: STATUS_SCHLUESSEL, HERMES_DEPLOY_TOKEN: DEPLOY_SCHLUESSEL },
  });
  try {
    assert.equal((await abrufMitFrist(`${srv.localUrl}/healthz`)).status, HTTP_OK);
    const status = await abrufMitFrist(
      `${srv.localUrl}/intern/status`,
      mitBearer(STATUS_SCHLUESSEL),
    );
    assert.equal(status.status, HTTP_OK);
    assert.equal((await status.json()).datenbank, true);
    const laufend = await abrufMitFrist(
      `${srv.localUrl}/intern/anrufe-laufend`,
      mitBearer(DEPLOY_SCHLUESSEL),
    );
    assert.equal(laufend.status, HTTP_OK);
    assert.deepEqual(await laufend.json(), { laufend: 0 });
    const statusMitDeploy = await abrufMitFrist(
      `${srv.localUrl}/intern/status`,
      mitBearer(DEPLOY_SCHLUESSEL),
    );
    assert.equal(statusMitDeploy.status, HTTP_UNAUTHORIZED);
    const deployMitStatus = await abrufMitFrist(
      `${srv.localUrl}/intern/anrufe-laufend`,
      mitBearer(STATUS_SCHLUESSEL),
    );
    assert.equal(deployMitStatus.status, HTTP_UNAUTHORIZED);
  } finally {
    await srv.stop();
  }
});

test("[NIE3] nur der Statusschluessel gesetzt: Hermes startet, GET /healthz 200", async () => {
  const antwort = await healthzBeiSchluesseln({
    HERMES_STATUS_TOKEN: STATUS_SCHLUESSEL,
    HERMES_DEPLOY_TOKEN: "",
  });
  assert.equal(antwort, HTTP_OK);
});

test("[NIE3] nur der Deploy-Schluessel gesetzt: Hermes startet, GET /healthz 200", async () => {
  const antwort = await healthzBeiSchluesseln({
    HERMES_STATUS_TOKEN: "",
    HERMES_DEPLOY_TOKEN: DEPLOY_SCHLUESSEL,
  });
  assert.equal(antwort, HTTP_OK);
});

test("[NIE3] beide Schluessel leer: Hermes startet, GET /healthz 200", async () => {
  const antwort = await healthzBeiSchluesseln({ HERMES_STATUS_TOKEN: "", HERMES_DEPLOY_TOKEN: "" });
  assert.equal(antwort, HTTP_OK);
});
