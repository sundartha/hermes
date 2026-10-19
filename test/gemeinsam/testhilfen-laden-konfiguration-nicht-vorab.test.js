import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { importNachUmgebung } from "./umgebung-import.js";

test("test/helpers.js lädt src/config.js nicht, startIdp läuft nach der danach gesetzten Umgebung", async (t) => {
  const { startIdp } = await import("../helpers.js");
  const datenverzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), "testhilfen-umgebung-"));
  t.after(() => {
    delete process.env.DATA_DIR;
    fs.rmSync(datenverzeichnis, { recursive: true, force: true });
  });
  await importNachUmgebung({ DATA_DIR: datenverzeichnis });
  const idp = await startIdp();
  t.after(idp.close);
  const antwort = await abrufMitFrist(`${idp.issuer}/.well-known/openid-configuration`);
  assert.equal((await antwort.json()).issuer, idp.issuer);
});
