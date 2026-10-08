import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

const CHALLENGE_PATH = "/.well-known/openai-apps-challenge";
const TOKEN = "e7-token-abc";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const CONTENT_TYPE_TEXT_PLAIN = "text/plain";

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

async function mitServer(env, pruefung) {
  const srv = await startServer({ env });
  try {
    await pruefung(srv);
  } finally {
    await srv.stop();
  }
}

test("E7-T1: gesetzter Token liefert 200, byte-exakten Klartext, kein WWW-Authenticate", async () => {
  await mitServer({ OPENAI_APPS_CHALLENGE_TOKEN: TOKEN }, async (srv) => {
    const res = await fetch(srv.localUrl + CHALLENGE_PATH);
    assert.equal(res.status, HTTP_OK);
    assert.equal(await res.text(), TOKEN);
    assert.ok(res.headers.get("content-type").startsWith(CONTENT_TYPE_TEXT_PLAIN));
    assert.equal(res.headers.get("www-authenticate"), null);
  });
});

test("E7-T2: Koerperform ist reiner Klartext, kein JSON/Liste (O-4)", async () => {
  await mitServer({ OPENAI_APPS_CHALLENGE_TOKEN: TOKEN }, async (srv) => {
    const res = await fetch(srv.localUrl + CHALLENGE_PATH);
    const text = await res.text();
    assert.throws(() => JSON.parse(text));
    assert.ok(!text.includes("{") && !text.includes("[") && !text.includes('"'));
  });
});

test("E7-T3: ungesetzter Token -> 404, Body verraet nicht das Wort openai", async () => {
  await mitServer({}, async (srv) => {
    const res = await fetch(srv.localUrl + CHALLENGE_PATH);
    assert.equal(res.status, HTTP_NOT_FOUND);
    const text = await res.text();
    assert.ok(!text.includes("openai"));
  });
});

test("E7-T4: nur Whitespace als Token -> 404 (belegt .trim() am Config-Rand)", async () => {
  await mitServer({ OPENAI_APPS_CHALLENGE_TOKEN: "   " }, async (srv) => {
    const res = await fetch(srv.localUrl + CHALLENGE_PATH);
    assert.equal(res.status, HTTP_NOT_FOUND);
  });
});

test("E7-T5: Token mit umgebendem Whitespace/Zeilenumbruch wird getrimmt", async () => {
  await mitServer({ OPENAI_APPS_CHALLENGE_TOKEN: ` ${TOKEN}\n` }, async (srv) => {
    const res = await fetch(srv.localUrl + CHALLENGE_PATH);
    assert.equal(res.status, HTTP_OK);
    assert.equal(await res.text(), TOKEN);
  });
});

test("E7-T6: POST bei gesetztem Token -> 404, Token nicht im Body (B2: kein openai-Grep)", async () => {
  await mitServer({ OPENAI_APPS_CHALLENGE_TOKEN: TOKEN }, async (srv) => {
    const res = await fetch(srv.localUrl + CHALLENGE_PATH, { method: "POST" });
    assert.equal(res.status, HTTP_NOT_FOUND);
    const text = await res.text();
    assert.ok(!text.includes(TOKEN));
  });
});

test("E7-T7: der Token wird nie geloggt (Regel 4)", async () => {
  await mitServer({ OPENAI_APPS_CHALLENGE_TOKEN: TOKEN }, async (srv) => {
    await fetch(srv.localUrl + CHALLENGE_PATH);
    assert.ok(!srv.stdout.includes(TOKEN));
  });
});

test("E7-T8: der Token ist keine configHash-Achse (Boot-Hash identisch mit/ohne Token)", async () => {
  await mitServer({}, async (srvOhne) => {
    const matchOhne = srvOhne.stdout.match(/\[boot\] configHash=([a-f0-9]{64})/);
    assert.ok(matchOhne, "Boot-Log ohne Token traegt keinen configHash");
    await mitServer({ OPENAI_APPS_CHALLENGE_TOKEN: TOKEN }, async (srvMit) => {
      const matchMit = srvMit.stdout.match(/\[boot\] configHash=([a-f0-9]{64})/);
      assert.ok(matchMit, "Boot-Log mit Token traegt keinen configHash");
      assert.equal(matchOhne[1], matchMit[1]);
    });
  });
});

test("E7-T9: .env.example + render.yaml + config.js sind kohaerent (Doku-Pin)", () => {
  const envExample = readRepoFile(".env.example");
  const renderYaml = readRepoFile("render.yaml");

  assert.match(envExample, /^MCP_ORIGIN_ENFORCE=true$/m);

  assert.match(envExample, /^OPENAI_APPS_CHALLENGE_TOKEN=\s*(#.*)?$/m);
  assert.match(renderYaml, /key:\s*OPENAI_APPS_CHALLENGE_TOKEN\s*\n\s*sync:\s*false/);
});
