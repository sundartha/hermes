// OT-3 (P1) Store-Integritaet: atomic write (AC1), withStoreLock-Serialisierung
// (AC2), First-Boot-vs-Korruption (AC3), Happy-Path-Format-Regression (AC5).
// Unit gegen die Store-Fassade (json-Default-Backend) mit Temp-DATA_DIR; das echte
// data/store.json wird nie angefasst (DATA_DIR-Override vor dem Import).
//
// Warum der Korruptions-Fall (T-P1-03) ueber einen Kindprozess laeuft: load()
// cached den Modul-globalen state nach dem ersten Aufruf. Ein zweites Disk-Szenario
// (korruptes File) im selben Prozess ist daher nicht moeglich (ESM-Modul-Cache +
// FILE wird beim Import aus config.dataDir fixiert) -> frischer Prozess noetig.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { tempDataDir, startServer } from "./helpers.js";

let store;
let withStoreLock;
let dataDir;
let file;

before(async () => {
  // First-Boot-Szenario: leeres DATA_DIR (kein store.json -> ENOENT beim ersten load()).
  dataDir = tempDataDir(); // kein seed
  file = path.join(dataDir, "store.json");
  process.env.DATA_DIR = dataDir;
  store = await import("../src/store.js"); // loest noch KEIN load() aus
  withStoreLock = store.withStoreLock;
});

// ---- T-P1-04: First-Boot -> Defaults ohne Fehlalarm -------------------------
// Regression-Guard: ein echter Erst-Start (File abwesend) darf NIE als Korruption
// fehlinterpretiert werden. Gruen vor UND nach der Implementierung; faellt nur, wenn
// ENOENT faelschlich in den Korruptions-Pfad geriete.
test("T-P1-04: First-Boot (ENOENT) -> Defaults, KEIN KORRUPT-Alarm", () => {
  const captured = [];
  const orig = console.error;
  console.error = (...args) => captured.push(args.join(" "));
  let state;
  try {
    state = store.load(); // erster load() -> First-Boot
  } finally {
    console.error = orig;
  }
  assert.ok(
    !captured.some((m) => /\[store\] KORRUPT/.test(m)),
    "First-Boot darf KEINE KORRUPT-Zeile loggen",
  );
  assert.ok(fs.existsSync(file), "store.json wird beim First-Boot angelegt");
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8")); // gueltiges JSON
  assert.ok(Array.isArray(onDisk.calls), "Default-Shape: calls[]");
  assert.ok(state.tenants.some((t) => t.status === "active"), "Owner-Tenant aktiv (Default)");
});

// ---- T-P1-01: Atomic write -> kein in-place-Write, kein truncated File ------
test("T-P1-01a: save() schreibt gueltiges store.json und hinterlaesst kein .tmp", () => {
  store.save();
  JSON.parse(fs.readFileSync(file, "utf8")); // wirft nicht -> vollstaendiges JSON
  const leftover = fs.readdirSync(dataDir).filter((f) => f.includes(".tmp-"));
  assert.deepEqual(leftover, [], "keine verwaisten .tmp-Files nach erfolgreichem save()");
});

test("T-P1-01b: bricht der finale Rename ab, bleibt store.json unveraendert (NIE in-place)", () => {
  const before = fs.readFileSync(file, "utf8"); // vollstaendiger Alt-Inhalt
  // In-Memory-State so mutieren, dass ein in-place-Write den Probe-Marker auf Platte
  // braechte; mit atomic write (tmp+rename) darf die Platte unberuehrt bleiben.
  const s = store.load();
  s.notifications.push({ id: "p1-inplace-probe", title: "x", body: "", at: "t", callId: null });
  const origRename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error("rename blocked (test)");
  };
  try {
    store.save(); // atomic: schreibt tmp, Rename wirft -> save() wirft, Platte unberuehrt
  } catch {
    /* erwartet bei atomic write */
  } finally {
    fs.renameSync = origRename;
  }
  const after = fs.readFileSync(file, "utf8");
  assert.ok(!after.includes("p1-inplace-probe"), "kein in-place-Write: Platte ohne Probe-Marker");
  assert.equal(after, before, "store.json byte-identisch zum Stand vor dem fehlgeschlagenen save()");
  // Aufraeumen: In-Memory-Mutation zuruecknehmen, verwaiste .tmp loeschen.
  s.notifications.pop();
  for (const f of fs.readdirSync(dataDir).filter((n) => n.includes(".tmp-"))) fs.unlinkSync(path.join(dataDir, f));
});

// ---- T-P1-06: Happy-Path-Regression -> Format + Round-Trip unveraendert -----
test("T-P1-06: save()->reload Round-Trip + JSON bleibt 2-space-indented", () => {
  store.addNotification("p1-roundtrip", "body"); // mutiert + save()t
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(raw.includes("p1-roundtrip"), "Mutation round-trippt auf die Platte");
  assert.ok(/^\{\n  "/.test(raw), "JSON.stringify(state, null, 2): 2-space-Einrueckung erhalten");
  JSON.parse(raw); // gueltiges JSON
});

// ---- T-P1-02: withStoreLock serialisiert read-modify-write (kein Lost Update)-
test("T-P1-02: withStoreLock verhindert Lost Update bei await zwischen read und write", async () => {
  // Geteilter Zaehler simuliert eine Usage-/Budget-Mutation. Jede Sequenz liest in
  // ein lokales cur, yieldet (Microtask) und schreibt cur+1 zurueck.
  const shared = { count: 0 };
  const seq = async () => {
    const cur = shared.count;
    await Promise.resolve(); // Interleave-Fenster
    shared.count = cur + 1;
  };
  // OHNE Lock (Negativ-Kontrolle): beide lesen 0, schreiben 1 -> Endwert 1 (Lost Update).
  // MIT Lock: serialisiert -> A vollstaendig vor B -> Endwert 2.
  await Promise.all([withStoreLock(seq), withStoreLock(seq)]);
  assert.equal(shared.count, 2, "beide Mutationen persistiert (Budget-Counter-Schutz, CLAUDE.md Regel 1)");
});

// ---- T-P1-03: Korruptes store.json am Boot -> bewahrt + geflaggt, NICHT gewischt
// Kindprozess (frischer Modul-Zustand): src/server.js laedt den Store beim Boot.
test("T-P1-03: korruptes store.json -> .corrupt-Rename + lautes Log, kein stiller Wipe", async () => {
  const srv = await startServer({ rawStore: "{ this is not json" });
  try {
    assert.match(srv.stdout, /\[store\] KORRUPTES store\.json erkannt/, "lautes KORRUPT-Log");
    const files = fs.readdirSync(srv.dataDir);
    const corrupt = files.find((f) => f.startsWith("store.json.corrupt-"));
    assert.ok(corrupt, "korruptes File forensisch nach .corrupt-<ts> umbenannt");
    assert.equal(
      fs.readFileSync(path.join(srv.dataDir, corrupt), "utf8"),
      "{ this is not json",
      "der .corrupt-Backup haelt den originalen kaputten Inhalt",
    );
    const fresh = JSON.parse(fs.readFileSync(path.join(srv.dataDir, "store.json"), "utf8"));
    assert.ok(Array.isArray(fresh.calls), "neues store.json ist gueltiges Default-JSON (Dienst ueberlebt)");
  } finally {
    await srv.stop();
  }
});
