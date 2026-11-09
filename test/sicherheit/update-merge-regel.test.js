import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { echteQuellen, laufBefunde } from "../../tools/freigabe.mjs";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KOPF = "a".repeat(40);
const ALTER_STAND = "b".repeat(40);
const NR = 42;
const BAU_AGENT = { login: "dependabot[bot]" };
const ANTONIO = { login: "Antonio20045" };
const JONAS = { login: "jonas986" };
const LOCK = "package-lock.json";
const JETZT = Date.parse("2026-11-09T12:00:00Z");
const NODE_JA = "Ja: Node-Hauptversion";
const NODE_LABEL = "node-hauptversion";

function vorTagen(tage) {
  return new Date(JETZT - tage * 86_400_000).toISOString();
}

function lockfile(versionen) {
  const packages = { "": { name: "hermes", version: "1.0.0" } };
  for (const [pfad, version] of Object.entries(versionen)) packages[pfad] = { version };
  return JSON.stringify({ lockfileVersion: 3, packages });
}

function migration(...namen) {
  const teile = namen.flatMap((name) => [`### ${name}`, "Quelle: https://example.test/notes", "Auszug: Entfernt die alte API.", "Nutzung: git grep alteApi: kein Treffer", ""]);
  return ["PASS, kein MUSS-Befund.", "", "## Migrationsprüfung", ...teile].join("\n");
}

function approve(body, user = ANTONIO, stand = KOPF) {
  return { user, state: "APPROVED", commit_id: stand, body };
}

const ALLES_ALT = {
  veroeffentlicht: async () => vorTagen(400),
  ersterFix: async () => false,
  nodeLtsSeit: async () => vorTagen(400).slice(0, 10),
  queueEintraege: async () => [],
  liegtVor: async () => false,
  pull: async () => ({ head: { ref: "paket/fach" }, labels: [] }),
  offenePRs: async () => [],
  dateienVon: async () => [],
  notAus: async () => [],
};

function lauf(stand, reviews, optionen = {}) {
  const { branch = "dependabot/npm_and_yarn/x", labels = [], imQueue = true, quellen = {}, titel = "Update" } = optionen;
  const pull = { number: NR, head: { sha: KOPF, ref: branch }, base: { ref: "master" }, title: titel, user: BAU_AGENT, labels: labels.map((name) => ({ name })) };
  const dateien = Object.keys(stand).map((pfad) => ({ status: "M", pfad }));
  const lesen = (ref, pfad) => stand[pfad]?.[ref === "basis" ? 0 : 1];
  return laufBefunde({ pull, reviews, dateien, imQueue, basis: "basis", kopf: "kopf", lesen, jetzt: JETZT, quellen: { ...ALLES_ALT, ...quellen } });
}

function lockStand(alt, neu, paket = "node_modules/ws") {
  return { [LOCK]: [lockfile({ [paket]: alt }), lockfile({ [paket]: neu })] };
}

function alter(tage) {
  return { veroeffentlicht: async () => vorTagen(tage) };
}

const PATCH = lockStand("8.1.0", "8.1.1");
const MINOR = lockStand("8.1.0", "8.2.0");
const MAJOR = lockStand("6.0.3", "7.0.0", "node_modules/typescript");
const ACTION = { ".github/workflows/ci.yml": [`      - uses: actions/checkout@${"1".repeat(40)}\n`, `      - uses: actions/checkout@${"2".repeat(40)}\n`] };
const NODE = { ".nvmrc": ["22.18\n", "26.1\n"] };
const MIT_PASS = [approve("PASS")];
const MAJOR_PASS = [approve(migration("typescript"))];
const MINOR_PASS = [approve(migration("ws"))];
const NODE_PASS = approve(migration("node"));
const NODE_JA_REVIEW = approve(NODE_JA);

test("ein npm-Patch unter sieben Tagen wartet, ab sieben Tagen geht er durch", async () => {
  const befunde = await lauf(PATCH, MIT_PASS, { quellen: alter(6) });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /ws 8\.1\.1/);
  assert.match(befunde[0], /7 Tage/);
  assert.deepEqual(await lauf(PATCH, MIT_PASS, { quellen: alter(7) }), []);
});

test("ein npm-Minor unter sieben Tagen wartet", async () => {
  assert.equal((await lauf(MINOR, MINOR_PASS, { quellen: alter(6) })).length, 1);
  assert.deepEqual(await lauf(MINOR, MINOR_PASS, { quellen: alter(8) }), []);
});

test("ein Major unter vierzehn Tagen wartet, auch mit PASS", async () => {
  const befunde = await lauf(MAJOR, MAJOR_PASS, { quellen: alter(13) });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /14 Tage/);
  assert.deepEqual(await lauf(MAJOR, MAJOR_PASS, { quellen: alter(14) }), []);
});

test("eine Action unter vierzehn Tagen wartet, auch als kleiner Sprung", async () => {
  const klein = { ".github/workflows/ci.yml": ["      - uses: a/b@v4.1.0\n", "      - uses: a/b@v4.1.1\n"] };
  assert.match((await lauf(klein, MIT_PASS, { quellen: alter(13) }))[0], /14 Tage/);
  assert.deepEqual(await lauf(klein, MIT_PASS, { quellen: alter(15) }), []);
});

test("eine auf den Commit gepinnte Action wird über ihren Stand geprüft", async () => {
  const gefragt = [];
  const quellen = {
    veroeffentlicht: async (oekosystem, name, stand) => {
      gefragt.push([oekosystem, name, stand]);
      return vorTagen(20);
    },
  };
  assert.deepEqual(await lauf(ACTION, [approve(migration("actions/checkout"))], { quellen }), []);
  assert.deepEqual(gefragt, [["actions", "actions/checkout", "2".repeat(40)]]);
});

test("ein Paket, dessen Veröffentlichung nicht lesbar ist, wird nicht gemergt", async () => {
  const befunde = await lauf(PATCH, MIT_PASS, { quellen: { veroeffentlicht: async () => undefined } });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /nicht bestimmbar/);
});

test("ein Paket ohne erkennbaren Versionssprung wird nicht gemergt", async () => {
  const befunde = await lauf(lockStand("8.1", "8.1.0"), MIT_PASS);
  assert.match(befunde.join("\n"), /Alter von ws 8\.1\.0 nicht bestimmbar/);
});

test("von mehreren Ständen einer Action zählt der jüngste", async () => {
  const gemischt = { ".github/workflows/ci.yml": ["      - uses: a/b@v4.0.0\n      - uses: a/b@v4.0.1\n", "      - uses: a/b@v4.0.2\n      - uses: a/b@v4.0.3\n"] };
  const quellen = { veroeffentlicht: async (_oekosystem, _name, stand) => vorTagen(stand === "v4.0.3" ? 3 : 90) };
  const befunde = await lauf(gemischt, [approve(migration("a/b"))], { quellen });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /jünger/);
});

test("ein Major ohne PASS wird nicht gemergt", async () => {
  const befunde = await lauf(MAJOR, []);
  assert.equal(befunde.length >= 1, true);
  assert.match(befunde.join("\n"), /KI-Urteil|Migrationsprüfung/);
});

test("eine Node-Hauptversion ohne Antonios Ja wird nicht gemergt, auch mit PASS", async () => {
  const befunde = await lauf(NODE, [NODE_PASS], { labels: [NODE_LABEL] });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /Antonios Ja/);
});

test("eine Node-Hauptversion mit PASS, Ja und Label geht durch", async () => {
  assert.deepEqual(await lauf(NODE, [NODE_PASS, NODE_JA_REVIEW], { labels: [NODE_LABEL] }), []);
  assert.deepEqual(await lauf(NODE, [NODE_JA_REVIEW, NODE_PASS], { labels: [NODE_LABEL] }), []);
});

test("ein PASS unter Antonios Konto zählt nicht als sein Ja", async () => {
  const mitWort = approve(`${migration("node")}\n${NODE_JA}`);
  assert.match((await lauf(NODE, [mitWort], { labels: [NODE_LABEL] }))[0], /Antonios Ja/);
});

test("das Ja zählt nur von Antonio und nur auf dem aktuellen Stand", async () => {
  const vonJonas = await lauf(NODE, [NODE_PASS, approve(NODE_JA, JONAS)], { labels: [NODE_LABEL] });
  assert.match(vonJonas.join("\n"), /Antonios Ja/);
  const alterStand = await lauf(NODE, [approve(NODE_JA, ANTONIO, ALTER_STAND), NODE_PASS], { labels: [NODE_LABEL] });
  assert.match(alterStand.join("\n"), /Antonios Ja/);
});

test("ein späteres Changes-Requested nimmt das Ja zurück", async () => {
  const zurueck = { user: ANTONIO, state: "CHANGES_REQUESTED", commit_id: KOPF, body: "Doch nicht." };
  const befunde = await lauf(NODE, [NODE_PASS, NODE_JA_REVIEW, zurueck], { labels: [NODE_LABEL] });
  assert.match(befunde.join("\n"), /Antonios Ja/);
});

test("eine Node-Hauptversion ohne Label wird nicht gemergt", async () => {
  const befunde = await lauf(NODE, [NODE_PASS, NODE_JA_REVIEW]);
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /node-hauptversion/);
});

test("das Label allein macht einen PR zur Node-Hauptversion und verlangt das Ja", async () => {
  const befunde = await lauf(PATCH, MIT_PASS, { labels: [NODE_LABEL] });
  assert.match(befunde.join("\n"), /Antonios Ja/);
});

test("Node vor Active LTS plus vierzehn Tagen wird nicht gemergt", async () => {
  const quellen = { nodeLtsSeit: async () => vorTagen(13).slice(0, 10) };
  const befunde = await lauf(NODE, [NODE_PASS, NODE_JA_REVIEW], { labels: [NODE_LABEL], quellen });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /Active LTS/);
});

test("die LTS-Frist wird für die Zielversion gefragt, nicht für eine Obergrenze", async () => {
  const stand = { ".nvmrc": ["22.18\n", "26.1\n"], "package.json": ['{"engines":{"node":">=22.18 <23"}}', '{"engines":{"node":">=26.1 <27"}}'] };
  const { befunde, versionen } = await ltsLauf(stand);
  assert.deepEqual(befunde, []);
  assert.deepEqual(versionen, [26]);
});

test("Node mit unbekanntem LTS-Datum wird nicht gemergt", async () => {
  const quellen = { nodeLtsSeit: async () => undefined };
  const befunde = await lauf(NODE, [NODE_PASS, NODE_JA_REVIEW], { labels: [NODE_LABEL], quellen });
  assert.match(befunde[0], /Active LTS/);
});

const VORAUS = { queueEintraege: async () => [{ pr: 7, sha: "c".repeat(40) }], liegtVor: async () => true };

test("ein zweites Update wartet hinter einem Update in der Merge-Queue", async () => {
  const quellen = { ...VORAUS, pull: async () => ({ head: { ref: "dependabot/npm_and_yarn/y" }, labels: [] }) };
  const befunde = await lauf(PATCH, MIT_PASS, { quellen });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /#7/);
});

test("ein zweites Update wartet auch hinter einem Node-PR", async () => {
  const quellen = { ...VORAUS, pull: async () => ({ head: { ref: "system/node-26" }, labels: [{ name: NODE_LABEL }] }) };
  assert.equal((await lauf(PATCH, MIT_PASS, { quellen })).length, 1);
});

test("hinter einem Fach-PR in der Queue läuft ein Update weiter", async () => {
  assert.deepEqual(await lauf(PATCH, MIT_PASS, { quellen: VORAUS }), []);
});

test("ein Update, das hinter dem eigenen Stand liegt, hält nicht auf", async () => {
  const quellen = { ...VORAUS, liegtVor: async () => false, pull: async () => ({ head: { ref: "dependabot/npm_and_yarn/y" }, labels: [] }) };
  assert.deepEqual(await lauf(PATCH, MIT_PASS, { quellen }), []);
});

test("der eigene Queue-Eintrag zählt nicht als zweites Update", async () => {
  const quellen = { queueEintraege: async () => [{ pr: NR, sha: "c".repeat(40) }], liegtVor: async () => true, pull: async () => ({ head: { ref: "dependabot/x" }, labels: [] }) };
  assert.deepEqual(await lauf(PATCH, MIT_PASS, { quellen }), []);
});

const OFFEN_FACH = { offenePRs: async () => [{ number: 9, head: { ref: "paket/fach" }, labels: [] }] };

test("kein Update-Merge, solange ein offener PR dieselbe package.json ändert", async () => {
  const stand = { ...PATCH, "package.json": ["{}", '{"a":1}'] };
  const quellen = { ...OFFEN_FACH, dateienVon: async () => ["package.json"] };
  const befunde = await lauf(stand, MIT_PASS, { quellen });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /#9/);
});

test("ein Update nur im Lockfile zählt für die package.json daneben", async () => {
  const quellen = { ...OFFEN_FACH, dateienVon: async () => ["package.json"] };
  assert.match((await lauf(PATCH, MIT_PASS, { quellen }))[0], /package\.json/);
});

test("eine andere package.json hält das Update nicht auf", async () => {
  const quellen = { ...OFFEN_FACH, dateienVon: async () => ["apps/web/package.json"] };
  assert.deepEqual(await lauf(PATCH, MIT_PASS, { quellen }), []);
});

test("der eigene offene PR hält sich nicht selbst auf", async () => {
  const quellen = { offenePRs: async () => [{ number: NR, head: { ref: "system/lock" }, labels: [] }], dateienVon: async () => ["package.json"] };
  assert.deepEqual(await lauf(PATCH, MIT_PASS, { branch: "system/lock", quellen }), []);
});

test("ein anderer offener Update-PR hält das Update nicht auf", async () => {
  const quellen = { offenePRs: async () => [{ number: 9, head: { ref: "dependabot/npm_and_yarn/z" }, labels: [] }], dateienVon: async () => ["package.json"] };
  assert.deepEqual(await lauf(PATCH, MIT_PASS, { quellen }), []);
});

test("ein Update nur an Actions kennt keine package.json", async () => {
  const klein = { ".github/workflows/ci.yml": ["      - uses: a/b@v4.1.0\n", "      - uses: a/b@v4.1.1\n"] };
  const quellen = { ...OFFEN_FACH, dateienVon: async () => ["package.json"] };
  assert.deepEqual(await lauf(klein, MIT_PASS, { quellen }), []);
});

function wirftWennGefragt() {
  throw new Error("außerhalb der Queue und bei Nicht-Updates wird nichts abgefragt");
}

const NIE_FRAGEN = {
  veroeffentlicht: wirftWennGefragt,
  ersterFix: wirftWennGefragt,
  nodeLtsSeit: wirftWennGefragt,
  queueEintraege: wirftWennGefragt,
  liegtVor: wirftWennGefragt,
  pull: wirftWennGefragt,
  offenePRs: wirftWennGefragt,
  dateienVon: wirftWennGefragt,
  notAus: wirftWennGefragt,
};

test("am PR außerhalb der Queue greift die Regel nicht", async () => {
  assert.deepEqual(await lauf(MAJOR, [], { imQueue: false, quellen: NIE_FRAGEN }), []);
});

test("ein PR ohne Versionsänderung wird nicht als Update behandelt", async () => {
  const stand = { "docs/x.md": ["a", "b"] };
  assert.deepEqual(await lauf(stand, MIT_PASS, { branch: "paket/fach", quellen: NIE_FRAGEN }), []);
});

function antwort(daten, weiter) {
  return new Response(JSON.stringify(daten), { status: 200, headers: weiter ? { link: `<${weiter}>; rel="next"` } : {} });
}

function mitFetch(antworten, ablauf) {
  const gefragt = [];
  const vorher = globalThis.fetch;
  const repoVorher = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = "o/r";
  globalThis.fetch = async (adresse) => {
    gefragt.push(String(adresse));
    const treffer = antworten.find(([muster]) => String(adresse).includes(muster));
    return treffer ? treffer[1]() : new Response("{}", { status: 404 });
  };
  return ablauf(gefragt).finally(() => {
    globalThis.fetch = vorher;
    if (repoVorher === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = repoVorher;
  });
}

const PULL = { number: NR, base: { ref: "master" } };
const GRUPPE = "d".repeat(40);

test("das Veröffentlichungsdatum eines Scope-Pakets kommt aus der npm-Registry", async () => {
  await mitFetch([["registry.npmjs.org", () => antwort({ time: { "7.0.0": "2026-10-01T00:00:00.000Z" } })]], async (gefragt) => {
    const zeit = await echteQuellen(PULL, GRUPPE).veroeffentlicht("npm", "@types/node", "7.0.0");
    assert.equal(zeit, "2026-10-01T00:00:00.000Z");
    assert.deepEqual(gefragt, ["https://registry.npmjs.org/@types%2Fnode"]);
  });
});

test("das Datum einer Action kommt aus dem Commit ihres Repos, auch bei Unterpfaden", async () => {
  await mitFetch([["/repos/a/b/releases", () => antwort([])], ["/repos/a/b/commits/v4", () => antwort({ commit: { committer: { date: "2026-10-02T00:00:00Z" } } })]], async () => {
    assert.equal(await echteQuellen(PULL, GRUPPE).veroeffentlicht("actions", "a/b/unter/pfad", "v4"), "2026-10-02T00:00:00Z");
  });
});

test("die Active-LTS-Frist kommt aus der Node-Release-Liste, frühester LTS-Eintrag", async () => {
  const liste = [{ version: "v26.2.0", date: "2026-11-05", lts: "Name" }, { version: "v26.1.0", date: "2026-10-28", lts: "Name" }, { version: "v26.0.0", date: "2026-05-05", lts: false }, { version: "v24.1.0", date: "2025-10-28", lts: "Alt" }];
  await mitFetch([["nodejs.org", () => antwort(liste)]], async () => {
    assert.equal(await echteQuellen(PULL, GRUPPE).nodeLtsSeit(26), "2026-10-28");
    assert.equal(await echteQuellen(PULL, GRUPPE).nodeLtsSeit(99), undefined);
  });
});

test("die Queue-Einträge kommen aus den Refs, fremde Refs zählen nicht", async () => {
  const refs = [{ ref: "refs/heads/gh-readonly-queue/master/pr-7-abc123", object: { sha: "e".repeat(40) } }, { ref: "refs/heads/gh-readonly-queue/master/kaputt", object: { sha: "f".repeat(40) } }];
  await mitFetch([["/git/matching-refs/heads/gh-readonly-queue/master/pr-", () => antwort(refs)]], async () => {
    assert.deepEqual(await echteQuellen(PULL, GRUPPE).queueEintraege(), [{ pr: 7, sha: "e".repeat(40) }]);
  });
});

test("voraus liegt ein Eintrag, dessen Stand im eigenen Gruppen-Stand enthalten ist", async () => {
  const fall = (status) => mitFetch([[`/compare/${"e".repeat(40)}...${GRUPPE}`, () => antwort({ status })]], () => echteQuellen(PULL, GRUPPE).liegtVor("e".repeat(40)));
  assert.equal(await fall("ahead"), true);
  assert.equal(await fall("identical"), true);
  assert.equal(await fall("behind"), false);
  assert.equal(await fall("diverged"), false);
});

test("die Dateien eines offenen PRs kommen vollständig über alle Seiten", async () => {
  const seite2 = "https://api.github.com/repos/o/r/pulls/9/files?page=2";
  await mitFetch([["page=2", () => antwort([{ filename: "package.json" }])], ["/pulls/9/files", () => antwort([{ filename: "a.js" }], seite2)]], async () => {
    assert.deepEqual(await echteQuellen(PULL, GRUPPE).dateienVon(9), ["a.js", "package.json"]);
  });
});

function pruefeInhaltAn(repo, ausdruck) {
  const github = pathToFileURL(join(WURZEL, "tools", "github.mjs")).href;
  const code = `import { inhaltAn } from ${JSON.stringify(github)}; const wert = ${ausdruck}; process.stdout.write(JSON.stringify({ laenge: wert?.length, leer: wert === undefined }));`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

function probeRepo() {
  const repo = mkdtempSync(join(tmpdir(), "inhalt-an-"));
  const git = (...argumente) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...argumente], { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  writeFileSync(join(repo, "gross.json"), "x".repeat(2 * 1024 * 1024));
  git("add", ".");
  git("commit", "-q", "-m", "gross");
  return repo;
}

test("ein großes Lockfile wird vollständig gelesen statt als fehlend zu gelten", () => {
  const repo = probeRepo();
  try {
    assert.deepEqual(pruefeInhaltAn(repo, 'inhaltAn("HEAD", "gross.json")'), { laenge: 2 * 1024 * 1024, leer: false });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("nur ein Pfad, der am Stand nicht existiert, gilt als fehlend", () => {
  const repo = probeRepo();
  try {
    assert.deepEqual(pruefeInhaltAn(repo, 'inhaltAn("HEAD", "gibtsnicht.json")'), { leer: true });
    assert.throws(() => pruefeInhaltAn(repo, 'inhaltAn("kein-stand", "gross.json")'));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

const IST_FIX = { ersterFix: async () => true };

test("ein bestätigter Sicherheitsfix eines npm-Pakets wartet nicht", async () => {
  assert.deepEqual(await lauf(PATCH, MIT_PASS, { quellen: { ...alter(1), ...IST_FIX } }), []);
});

test("der Sicherheitsfix wird für genau Paket, alten Stand und Zielversion gefragt", async () => {
  const gefragt = [];
  const quellen = {
    ...alter(1),
    ersterFix: async (paket) => {
      gefragt.push(paket);
      return true;
    },
  };
  await lauf(PATCH, MIT_PASS, { quellen });
  assert.deepEqual(gefragt, [{ name: "ws", alt: "8.1.0", neu: "8.1.1", oekosystem: "npm" }]);
});

test("ein Security im PR-Titel umgeht die Wartezeit nicht", async () => {
  const befunde = await lauf(PATCH, MIT_PASS, { quellen: alter(1), titel: "[Security] Bump ws from 8.1.0 to 8.1.1" });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /7 Tage/);
});

test("auch ein Sicherheitsfix braucht bei einem Major die Migrationsprüfung", async () => {
  const befunde = await lauf(MAJOR, MIT_PASS, { quellen: { ...alter(1), ...IST_FIX } });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /Migrationsprüfung/);
});

test("ein Sicherheitsfix mit unbekanntem Alter wird nicht gemergt", async () => {
  const befunde = await lauf(PATCH, MIT_PASS, { quellen: { veroeffentlicht: async () => undefined, ...IST_FIX } });
  assert.match(befunde[0], /nicht bestimmbar/);
});

test("ein abgewartetes Update fragt die Advisory-Quelle nicht", async () => {
  assert.deepEqual(await lauf(PATCH, MIT_PASS, { quellen: { ...alter(30), ersterFix: wirftWennGefragt } }), []);
});

test("fällt die Advisory-Quelle aus, geht ein junges Update nicht durch", async () => {
  await assert.rejects(lauf(PATCH, MIT_PASS, { quellen: { ...alter(1), ersterFix: wirftWennGefragt } }));
});

const WS_FIX = { name: "ws", alt: "8.1.0", neu: "8.1.1", oekosystem: "npm" };

function advisory(felder = {}) {
  return { withdrawn_at: null, vulnerabilities: [{ package: { ecosystem: "npm", name: "ws" }, first_patched_version: "8.1.1" }], ...felder };
}

function fixAbfrage(advisories, paket = WS_FIX) {
  return mitFetch([["/advisories", () => antwort(advisories)]], async (gefragt) => ({ ergebnis: await echteQuellen(PULL, GRUPPE).ersterFix(paket), gefragt }));
}

test("als Fix zählt die erste gepatchte Version einer geprüften Advisory auf den alten Stand", async () => {
  const { ergebnis, gefragt } = await fixAbfrage([advisory()]);
  assert.equal(ergebnis, true);
  assert.equal(gefragt.length, 1);
  const abfrage = new URL(gefragt[0]);
  assert.equal(abfrage.pathname, "/advisories");
  assert.equal(abfrage.searchParams.get("affects"), "ws@8.1.0");
  assert.equal(abfrage.searchParams.get("type"), "reviewed");
  assert.equal(abfrage.searchParams.get("ecosystem"), "npm");
});

test("ein Scope-Paket wird vollständig kodiert abgefragt", async () => {
  const paket = { name: "@babel/traverse", alt: "7.22.0", neu: "7.23.2", oekosystem: "npm" };
  const treffer = advisory({ vulnerabilities: [{ package: { ecosystem: "npm", name: "@babel/traverse" }, first_patched_version: "7.23.2" }] });
  const { ergebnis, gefragt } = await fixAbfrage([treffer], paket);
  assert.equal(ergebnis, true);
  assert.match(gefragt[0], /affects=%40babel%2Ftraverse%407\.22\.0/);
});

test("eine neuere Version als der erste Fix wartet", async () => {
  assert.equal((await fixAbfrage([advisory()], { ...WS_FIX, neu: "8.1.2" })).ergebnis, false);
});

test("eine zurückgezogene Advisory zählt nicht", async () => {
  assert.equal((await fixAbfrage([advisory({ withdrawn_at: "2026-11-01T00:00:00Z" })])).ergebnis, false);
});

test("der Fix eines anderen Pakets in derselben Advisory zählt nicht", async () => {
  const fremd = advisory({ vulnerabilities: [{ package: { ecosystem: "npm", name: "ws-anders" }, first_patched_version: "8.1.1" }] });
  assert.equal((await fixAbfrage([fremd])).ergebnis, false);
});

test("der Fix aus einem anderen Ökosystem zählt nicht", async () => {
  const fremd = advisory({ vulnerabilities: [{ package: { ecosystem: "pip", name: "ws" }, first_patched_version: "8.1.1" }] });
  assert.equal((await fixAbfrage([fremd])).ergebnis, false);
});

test("eine Action fragt die Advisory-Quelle nicht und wartet", async () => {
  const { ergebnis, gefragt } = await fixAbfrage([advisory()], { name: "a/b", alt: "1".repeat(40), neu: "2".repeat(40), oekosystem: "actions" });
  assert.equal(ergebnis, false);
  assert.deepEqual(gefragt, []);
});

const ACTION_SHA = "2".repeat(40);
const COMMIT_ALT = () => antwort({ commit: { committer: { date: "2020-01-01T00:00:00Z" } } });
const TAGS = () => antwort([{ name: "v4", commit: { sha: ACTION_SHA } }, { name: "v4.2.0", commit: { sha: ACTION_SHA } }, { name: "v3", commit: { sha: "9".repeat(40) } }]);

function gepinnteActionZeit(releases) {
  return mitFetch([["/repos/a/b/tags", TAGS], ["/repos/a/b/releases", () => antwort(releases)], ["/repos/a/b/commits/", COMMIT_ALT]], () => echteQuellen(PULL, GRUPPE).veroeffentlicht("actions", "a/b", ACTION_SHA));
}

test("eine gepinnte Action zählt ab dem Release ihres Tags, ein rückdatierter Commit hilft nicht", async () => {
  const zeit = await gepinnteActionZeit([{ tag_name: "v3", published_at: "2021-01-01T00:00:00Z" }, { tag_name: "v4.2.0", published_at: "2026-11-08T00:00:00Z" }]);
  assert.equal(zeit, "2026-11-08T00:00:00Z");
});

test("eine Action mit Tag-Stand zählt ab dem Release dieses Tags", async () => {
  const releases = () => antwort([{ tag_name: "v4.2.0", published_at: "2026-11-07T00:00:00Z" }]);
  await mitFetch([["/repos/a/b/releases", releases], ["/repos/a/b/commits/", COMMIT_ALT]], async (gefragt) => {
    assert.equal(await echteQuellen(PULL, GRUPPE).veroeffentlicht("actions", "a/b", "v4.2.0"), "2026-11-07T00:00:00Z");
    assert.equal(gefragt.some((adresse) => adresse.includes("/tags")), false);
  });
});

test("ein Release-Entwurf ohne Veröffentlichung zählt nicht, es bleibt das Commit-Datum", async () => {
  assert.equal(await gepinnteActionZeit([{ tag_name: "v4.2.0", published_at: null }]), "2020-01-01T00:00:00Z");
});

async function ltsLauf(stand) {
  const gefragt = [];
  const quellen = {
    nodeLtsSeit: async (haupt) => {
      gefragt.push(haupt);
      return vorTagen(30).slice(0, 10);
    },
  };
  const befunde = await lauf(stand, [NODE_PASS, NODE_JA_REVIEW], { labels: [NODE_LABEL], quellen });
  return { befunde, versionen: [...new Set(gefragt)] };
}

function nodeMatrix(...versionen) {
  return versionen.map((version) => `          node-version: ${version}\n`).join("");
}

test("bei mehreren Node-Ständen zählt der höchste geänderte", async () => {
  assert.deepEqual((await ltsLauf({ ".github/workflows/ci.yml": [nodeMatrix(22, 26), nodeMatrix(22, 28)] })).versionen, [28]);
});

test("ein unveränderter höherer Node-Stand der Matrix zählt nicht", async () => {
  assert.deepEqual((await ltsLauf({ ".github/workflows/ci.yml": [nodeMatrix(22, 26), nodeMatrix(24, 26)] })).versionen, [24]);
});

test("ändert sich nur die Obergrenze, bleibt die Untergrenze der Node-Stand", async () => {
  assert.deepEqual((await ltsLauf({ "package.json": ['{"engines":{"node":">=26.1 <27"}}', '{"engines":{"node":">=26.1 <28"}}'] })).versionen, [26]);
});

const PAUSIERT = { notAus: async () => [{ number: 3458 }] };

test("Not-Aus: mit gesetztem Label updates-pausiert wird ein sonst grünes Update nicht gemergt", async () => {
  const befunde = await lauf(PATCH, MIT_PASS, { quellen: PAUSIERT });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /updates-pausiert/);
  assert.match(befunde[0], /#3458/);
});

test("Not-Aus: auch ein bestätigter Sicherheitsfix wird nicht gemergt", async () => {
  const befunde = await lauf(PATCH, MIT_PASS, { quellen: { ...alter(1), ...IST_FIX, ...PAUSIERT } });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /updates-pausiert/);
});

test("Not-Aus: auch eine Node-Hauptversion mit Antonios Ja wird nicht gemergt", async () => {
  const befunde = await lauf(NODE, [NODE_PASS, NODE_JA_REVIEW], { labels: [NODE_LABEL], quellen: PAUSIERT });
  assert.equal(befunde.length, 1);
  assert.match(befunde[0], /updates-pausiert/);
});

test("Not-Aus: auch ein Update auf einem Zweig außerhalb von Dependabot wird nicht gemergt", async () => {
  const befunde = await lauf(PATCH, MIT_PASS, { branch: "system/lock", quellen: PAUSIERT });
  assert.match(befunde.join("\n"), /updates-pausiert/);
});

test("Not-Aus: ein PR ohne Versionsänderung läuft weiter und fragt das Label nicht ab", async () => {
  const stand = { "docs/x.md": ["a", "b"] };
  assert.deepEqual(await lauf(stand, MIT_PASS, { branch: "paket/fach", quellen: NIE_FRAGEN }), []);
});

test("Not-Aus: das Label wird an offenen Issues und PRs des Repos gesucht", async () => {
  await mitFetch([["/issues", () => antwort([{ number: 5 }])]], async (gefragt) => {
    assert.deepEqual(await echteQuellen(PULL, GRUPPE).notAus(), [{ number: 5 }]);
    const abfrage = new URL(gefragt[0]);
    assert.equal(abfrage.pathname, "/repos/o/r/issues");
    assert.equal(abfrage.searchParams.get("state"), "open");
    assert.equal(abfrage.searchParams.get("labels"), "updates-pausiert");
  });
});

test("Not-Aus: ist das Label nicht abfragbar, gilt das Update nicht als frei", async () => {
  await mitFetch([], async () => {
    await assert.rejects(echteQuellen(PULL, GRUPPE).notAus());
  });
});
