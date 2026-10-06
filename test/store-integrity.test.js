import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { tempDataDir, startServer, startServerExpectExit } from "./helpers.js";

const READ_EXEC_NO_WRITE = 0o500;
const OWNER_RWX = 0o700;

let store;
let withStoreLock;
let dataDir;
let file;

before(async () => {
  dataDir = tempDataDir();
  file = path.join(dataDir, "store.json");
  process.env.DATA_DIR = dataDir;
  store = await import("../src/store.js");
  withStoreLock = store.withStoreLock;
});

test("T-P1-04: First-Boot (ENOENT) -> Defaults, KEIN KORRUPT-Alarm", () => {
  const captured = [];
  const orig = console.error;
  console.error = (...args) => captured.push(args.join(" "));
  let state;
  try {
    state = store.load();
  } finally {
    console.error = orig;
  }
  assert.ok(
    !captured.some((m) => /\[store\] KORRUPT/.test(m)),
    "First-Boot darf KEINE KORRUPT-Zeile loggen",
  );
  assert.ok(fs.existsSync(file), "store.json wird beim First-Boot angelegt");
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(Array.isArray(onDisk.calls), "Default-Shape: calls[]");
  assert.ok(
    state.tenants.some((t) => t.status === "active"),
    "Owner-Tenant aktiv (Default)",
  );
});

test("T-P1-01a: save() schreibt gueltiges store.json und hinterlaesst kein .tmp", () => {
  store.save();
  JSON.parse(fs.readFileSync(file, "utf8"));
  const leftover = fs.readdirSync(dataDir).filter((f) => f.includes(".tmp-"));
  assert.deepEqual(leftover, [], "keine verwaisten .tmp-Files nach erfolgreichem save()");
});

test("T-P1-01b: bricht der finale Rename ab, bleibt store.json unveraendert (NIE in-place)", () => {
  const before = fs.readFileSync(file, "utf8");
  const s = store.load();
  s.notifications.push({ id: "p1-inplace-probe", title: "x", body: "", at: "t", callId: null });
  const origRename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error("rename blocked (test)");
  };
  try {
    store.save();
  } catch {
  } finally {
    fs.renameSync = origRename;
  }
  const after = fs.readFileSync(file, "utf8");
  assert.ok(!after.includes("p1-inplace-probe"), "kein in-place-Write: Platte ohne Probe-Marker");
  assert.equal(
    after,
    before,
    "store.json byte-identisch zum Stand vor dem fehlgeschlagenen save()",
  );
  s.notifications.pop();
  for (const f of fs.readdirSync(dataDir).filter((n) => n.includes(".tmp-")))
    fs.unlinkSync(path.join(dataDir, f));
});

test("T-P1-06: save()->reload Round-Trip + JSON bleibt 2-space-indented", () => {
  store.addNotification("p1-roundtrip", "body");
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(raw.includes("p1-roundtrip"), "Mutation round-trippt auf die Platte");
  assert.ok(/^\{\n  "/.test(raw), "JSON.stringify(state, null, 2): 2-space-Einrueckung erhalten");
  JSON.parse(raw);
});

test("T-P1-02: withStoreLock verhindert Lost Update bei await zwischen read und write", async () => {
  const shared = { count: 0 };
  const seq = async () => {
    const cur = shared.count;
    await Promise.resolve();
    shared.count = cur + 1;
  };
  await Promise.all([withStoreLock(seq), withStoreLock(seq)]);
  assert.equal(
    shared.count,
    2,
    "beide Mutationen persistiert (Budget-Counter-Schutz, CLAUDE.md Regel 1)",
  );
});

test("T-P1-03: korruptes store.json -> .corrupt-Rename + lautes Log + fail-closed Boot (kein stiller Wipe)", async () => {
  const { code, output, dataDir } = await startServerExpectExit({ rawStore: "{ this is not json" });
  assert.match(output, /\[store\] KORRUPTES store\.json erkannt/, "lautes KORRUPT-Log");
  assert.match(
    output,
    /Keine aktive Nummer im Store/,
    "Boot-Guard refused fail-closed nach Recovery",
  );
  assert.equal(code, 1, "fail-closed Boot-Refusal (Exit 1)");
  const files = fs.readdirSync(dataDir);
  const corrupt = files.find((f) => f.startsWith("store.json.corrupt-"));
  assert.ok(corrupt, "korruptes File forensisch nach .corrupt-<ts> umbenannt");
  assert.equal(
    fs.readFileSync(path.join(dataDir, corrupt), "utf8"),
    "{ this is not json",
    "der .corrupt-Backup haelt den originalen kaputten Inhalt",
  );
  const fresh = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  assert.ok(
    Array.isArray(fresh.calls),
    "neues store.json ist gueltiges Default-JSON (kein stiller Wipe)",
  );
});

test("T-P1-03b: korrupt + non-writable dataDir -> 'Sicherung FEHLGESCHLAGEN', exit != 0, Original byte-identisch", async () => {
  const raw = "{ this is not json";
  const dataDir = tempDataDir(undefined, raw);
  fs.chmodSync(dataDir, READ_EXEC_NO_WRITE);
  let result;
  try {
    result = await startServerExpectExit({ dataDir });
  } finally {
    fs.chmodSync(dataDir, OWNER_RWX);
  }
  assert.notEqual(result.code, 0, "fail-closed: Boot bricht mit Exit != 0 ab (kein lautloser Exit 0)");
  assert.match(result.output, /Sicherung FEHLGESCHLAGEN/, "ehrliches Log: Sicherung fehlgeschlagen, Original bleibt");
  assert.doesNotMatch(result.output, /umbenannt nach/, "KEINE Luege 'umbenannt' wenn der Rename scheiterte");
  assert.equal(
    fs.readFileSync(path.join(dataDir, "store.json"), "utf8"),
    raw,
    "korruptes Original byte-identisch (kein Wipe, kein Default-Overwrite)",
  );
  const files = fs.readdirSync(dataDir);
  assert.ok(!files.some((f) => f.startsWith("store.json.corrupt-")), "kein .corrupt-Backup (Rename scheiterte)");
  assert.ok(!files.some((f) => f.includes(".tmp-")), "kein Default-Write-Versuch (kein verwaistes .tmp)");
});
