import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { updateNachkontrolle } from "../../tools/deploy-weg/zurueckrollen.mjs";
import {
  NACHKONTROLLE_LAUF_TOKEN,
  NACHKONTROLLE_UPDATE_TOKEN,
} from "../gemeinsam/erfundene-geheimnisse.js";

const REPO = "sundartha/hermes";
const COMMIT = "c".repeat(40);
const server = [];

after(() => {
  for (const eintrag of server) {
    eintrag.closeAllConnections();
    eintrag.close();
  }
});

function dienst(behandeln) {
  const eintrag = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => behandeln(anfrage, Buffer.concat(teile).toString(), rueckgabe));
  });
  server.push(eintrag);
  return new Promise((fertig) =>
    eintrag.listen(0, "127.0.0.1", () => fertig(`http://127.0.0.1:${eintrag.address().port}`)),
  );
}

function antworten(rueckgabe, status, daten) {
  rueckgabe.writeHead(status, { "content-type": "application/json" });
  rueckgabe.end(JSON.stringify(daten));
}

async function laufen({ webhook = {}, mitSlack = true, telnyx = "none" } = {}) {
  const anfragen = [];
  const slack = [];
  const produktion = await dienst((anfrage, roh, rueckgabe) => {
    const pfad = anfrage.url.split("?")[0];
    anfragen.push({ methode: anfrage.method, pfad, roh, kopf: anfrage.headers });
    if (pfad === "/healthz") return antworten(rueckgabe, 200, { ok: true, commit: COMMIT });
    antworten(rueckgabe, webhook[pfad] ?? 403, {});
  });
  const github = await dienst((anfrage, _roh, rueckgabe) => {
    const pfad = anfrage.url.split("?")[0];
    if (pfad === `/repos/${REPO}/commits/${COMMIT}/pulls`) {
      return antworten(rueckgabe, 200, [
        {
          merged_at: "2026-11-12T10:00:00Z",
          merge_commit_sha: COMMIT,
          base: { ref: "master" },
          user: { login: "dependabot[bot]" },
          head: { ref: "dependabot/npm_and_yarn/x" },
          labels: [],
        },
      ]);
    }
    antworten(rueckgabe, 404, {});
  });
  const slackUrl = await dienst((_anfrage, roh, rueckgabe) => {
    slack.push(JSON.parse(roh));
    antworten(rueckgabe, 200, {});
  });
  const statusTelnyx = await dienst((_anfrage, _roh, rueckgabe) =>
    antworten(rueckgabe, 200, { status: { indicator: telnyx } }),
  );
  const zeilen = [];
  const revert = [];
  const stand = { t: 0 };
  const ergebnis = await updateNachkontrolle({
    einstellungen: {
      githubUrl: github,
      githubToken: NACHKONTROLLE_LAUF_TOKEN,
      updateToken: NACHKONTROLLE_UPDATE_TOKEN,
      repository: REPO,
      serverUrl: "https://github.com",
      runId: "42",
      repoDir: ".",
      produktionUrl: produktion,
      slackUrl: mitSlack ? slackUrl : null,
      anbieterStatus: [{ name: "Telnyx", url: statusTelnyx }],
    },
    commit: COMMIT,
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
    uhr: { jetzt: () => stand.t, warten: async (ms) => void (stand.t += ms) },
    revertBauen: async (angaben) => void revert.push(angaben),
  });
  return { ergebnis, zeilen, anfragen, slack, revert };
}

const webhooks = (anfragen) => anfragen.filter((a) => a.methode === "POST");
const enthalten = (zeilen, teil) => zeilen.some((zeile) => zeile.includes(teil));

test("Probe 403 auf beiden Webhooks: grün, Zeile, kein Slack, fremd signiert und ohne Anruf", async () => {
  const { ergebnis, zeilen, anfragen, slack, revert } = await laufen();
  assert.equal(ergebnis, true);
  assert.equal(enthalten(zeilen, "Nachkontrolle: Webhooks auf Produktion weisen fremde Signatur ab"), true);
  assert.deepEqual(slack, []);
  assert.deepEqual(revert, []);
  const gesendet = webhooks(anfragen);
  assert.deepEqual(
    gesendet.map((a) => a.pfad),
    ["/voice/outbound", "/voice/status"],
  );
  for (const a of gesendet) {
    assert.match(a.kopf["telnyx-signature-ed25519"], /^[A-Za-z0-9+/=]+$/);
    assert.equal(a.roh.includes("CallStatus=ringing"), true);
  }
  assert.equal(anfragen.every((a) => a.pfad === "/healthz" || a.pfad.startsWith("/voice/")), true);
});

test("Webhook antwortet nicht mit 403: rot, Slack mit Pfad, Status und Lauf-Link, kein Revert", async () => {
  const { ergebnis, zeilen, slack, revert } = await laufen({ webhook: { "/voice/status": 200 } });
  assert.equal(ergebnis, false);
  assert.deepEqual(revert, []);
  assert.equal(slack.length, 1);
  const zeilenSlack = slack[0].text.split("\n");
  assert.equal(zeilenSlack.includes("Live-Probe: Webhook voice/status antwortet mit 200"), true);
  assert.equal(
    slack[0].text,
    [
      "Live-Probe: Webhook voice/status antwortet mit 200",
      "Umgebung: Produktion.",
      `Lauf: https://github.com/${REPO}/actions/runs/42`,
    ].join("\n"),
  );
  assert.equal(
    zeilenSlack.includes(`Lauf: https://github.com/${REPO}/actions/runs/42`),
    true,
  );
  assert.equal(enthalten(zeilen, "Slack: Vorfall gesendet"), true);
});

test("beide Webhooks abweichend und Anbieter gestört: beide Zeilen und die Anbieterzeile", async () => {
  const { ergebnis, slack } = await laufen({
    webhook: { "/voice/outbound": 500, "/voice/status": 404 },
    telnyx: "major",
  });
  assert.equal(ergebnis, false);
  const zeilen = slack[0].text.split("\n");
  assert.equal(zeilen.includes("Live-Probe: Webhook voice/outbound antwortet mit 500"), true);
  assert.equal(zeilen.includes("Live-Probe: Webhook voice/status antwortet mit 404"), true);
  assert.equal(zeilen.includes("Anbieter meldet gerade Störung: Telnyx"), true);
});

test("ohne Anbieterstörung steht keine Anbieterzeile im Text", async () => {
  const { slack } = await laufen({ webhook: { "/voice/outbound": 200 } });
  assert.equal(slack[0].text.includes("Anbieter meldet"), false);
});

test("ohne SLACK_ALERT_URL: bei 403 grün, bei Abweichung rot mit der Übersprungen-Zeile", async () => {
  const gut = await laufen({ mitSlack: false });
  assert.equal(gut.ergebnis, true);
  assert.equal(enthalten(gut.zeilen, "Slack: übersprungen"), false);
  const schlecht = await laufen({ mitSlack: false, webhook: { "/voice/outbound": 200 } });
  assert.equal(schlecht.ergebnis, false);
  assert.equal(enthalten(schlecht.zeilen, "Slack: übersprungen (SLACK_ALERT_URL fehlt)"), true);
  assert.deepEqual(schlecht.revert, []);
});
