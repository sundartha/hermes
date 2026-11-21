import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";

async function probeLaufen(antwort) {
  const dienst = createServer((anfrage, rueckgabe) => {
    anfrage.resume();
    anfrage.on("end", () => {
      rueckgabe.writeHead(antwort);
      rueckgabe.end("{}");
    });
  });
  await new Promise((fertig) => dienst.listen(0, "127.0.0.1", fertig));
  const env = {
    PATH: process.env.PATH,
    GITHUB_REPOSITORY: "sundartha/hermes",
    GITHUB_RUN_ID: "79",
    SLACK_ALERT_URL: `http://127.0.0.1:${dienst.address().port}/slack`,
  };
  const kind = spawn("node", ["tools/deploy-weg.mjs", "alarmprobe"], { env });
  const code = await new Promise((fertig) => kind.on("close", fertig));
  dienst.close();
  return code;
}

const FAELLE = [
  { antwort: 200, code: 0 },
  { antwort: 299, code: 0 },
  { antwort: 300, code: 1 },
  { antwort: 500, code: 1 },
  { antwort: 404, code: 1 },
];

for (const { antwort, code } of FAELLE) {
  test(`Alarmprobe: Slack antwortet ${antwort}, Exit ${code}`, async () => {
    assert.equal(await probeLaufen(antwort), code);
  });
}
