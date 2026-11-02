import { spawnSync } from "node:child_process";

import { NUL, dateiAm, git } from "../auftrag/git.mjs";
import { graphql } from "../testschutz/github.mjs";
import { ausserhalbGleich, festeStuecke, hatMarker } from "./konfliktstellen.mjs";
import { istProduktpfad } from "./produktpfad.mjs";

const PULL_REQUEST = "pull_request";
const KURZ = 7;
const MERGE_MIT_KONFLIKT = 1;
const GENANNT = /^Konflikt gelöst: (.+)$/gm;
const AUFTRAG_ZEILE = /^Auftrag:.*$/m;
const AUSSERHALB = "src-Änderung außerhalb einer Konfliktstelle, nicht von lauf";
const ABFRAGE = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      timelineItems(itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT], last: 100) {
        pageInfo { hasPreviousPage }
        nodes { ... on HeadRefForcePushedEvent { beforeCommit { oid } } }
      }
    }
  }
}`;

function auftragZeile(nachricht) {
  return AUFTRAG_ZEILE.exec(nachricht)?.[0] ?? null;
}

function genannteDateien(nachricht) {
  return new Set([...nachricht.matchAll(GENANNT)].flatMap(([, liste]) => liste.split(",").map((datei) => datei.trim())));
}

function vorhanden(sha, root) {
  return spawnSync("git", ["cat-file", "-e", sha], { cwd: root }).status === 0;
}

function holeVonGithub(sha, root) {
  const quellen = git(["remote"], { cwd: root }).split("\n").filter(Boolean);
  return quellen.some((quelle) => spawnSync("git", ["fetch", "--no-tags", "--quiet", quelle, sha], { cwd: root }).status === 0);
}

async function alteKoepfe(nummer) {
  const {
    pullRequest: {
      timelineItems: { nodes, pageInfo },
    },
  } = await graphql(ABFRAGE, Number(nummer));
  if (pageInfo?.hasPreviousPage !== false) {
    throw new Error(`mehr als 100 Force-Pushes oder keine Angabe, ob die Liste vollständig ist`);
  }
  const oids = nodes.map(({ beforeCommit }) => beforeCommit?.oid).filter(Boolean);
  return [...new Set(oids.reverse())];
}

function commitNachricht(sha, root) {
  return git(["log", "-1", "--format=%B", sha], { cwd: root });
}

function altCommitsDes(kopf, { basis, root }) {
  const shas = git(["rev-list", "--no-merges", kopf, "--not", basis], { cwd: root }).split("\n").filter(Boolean);
  return shas.map((sha) => ({ sha, auftrag: auftragZeile(commitNachricht(sha, root)) }));
}

function elternVon(sha, root) {
  return git(["rev-list", "--parents", "-n", "1", sha], { cwd: root }).trim().split(" ").slice(1);
}

function baumVon(sha, root) {
  return git(["show", "--no-patch", "--format=%T", sha], { cwd: root }).trim();
}

function ersteZeile(text) {
  const [zeile] = text.trim().split("\n");
  return zeile || "kein Ergebnis";
}

function dreiWegMerge({ alt, altEltern, neuerEltern }, root) {
  const lauf = spawnSync(
    "git",
    ["-c", "merge.conflictStyle=merge", "merge-tree", "--write-tree", "-z", "--name-only", `--merge-base=${altEltern}`, neuerEltern, alt],
    { cwd: root, encoding: "utf8" },
  );
  if (lauf.status !== 0 && lauf.status !== MERGE_MIT_KONFLIKT) {
    return { fehler: `git merge-tree rechnet ${alt.slice(0, KURZ)} nicht nach: ${ersteZeile(lauf.stderr)}` };
  }
  const [baum, ...felder] = lauf.stdout.split(NUL);
  const ende = felder.indexOf("");
  const konflikte = felder.slice(0, ende === -1 ? felder.length : ende);
  return { baum, konflikte };
}

function geaendert(von, nach, root) {
  return git(["diff-tree", "-r", "--no-renames", "--name-only", "-z", von, nach], { cwd: root }).split(NUL).filter(Boolean);
}

function eintrag(stand, pfad, root) {
  return git(["ls-tree", "--full-tree", "-z", stand, "--", pfad], { cwd: root });
}

function modus(stand, pfad, root) {
  return eintrag(stand, pfad, root).split(" ")[0];
}

function dateiartPasst({ pfad, sha, alt, neuerEltern, merge }, root) {
  const erlaubt = [merge.baum, alt, neuerEltern].map((stand) => modus(stand, pfad, root));
  return erlaubt.includes(modus(sha, pfad, root));
}

function loesungPasst(argumente, root) {
  const { pfad, sha, alt, altEltern, neuerEltern, merge } = argumente;
  const [text, aufgeloest] = [dateiAm(merge.baum, pfad, root), dateiAm(sha, pfad, root)];
  const basis = dateiAm(altEltern, pfad, root);
  const fassungen = [neuerEltern, alt].map((stand) => dateiAm(stand, pfad, root));
  const stuecke = text === null || [basis, ...fassungen].some(hatMarker) ? [] : festeStuecke(text);
  if (aufgeloest !== null && !dateiartPasst(argumente, root)) return false;
  if (stuecke.length > 1) return aufgeloest !== null && ausserhalbGleich(stuecke, aufgeloest);
  return [text, ...fassungen].includes(aufgeloest);
}

function konfliktGrund(argumente, root) {
  const { pfad, genannt } = argumente;
  const gruende = loesungPasst(argumente, root) ? [] : [`${AUSSERHALB} (${pfad})`];
  return genannt.has(pfad) ? gruende : [...gruende, `die Konfliktstelle in ${pfad} fehlt in der Zeile „Konflikt gelöst: DATEI, …“ der Nachricht`];
}

function pfadGrund(argumente, root) {
  const { pfad, sha, merge } = argumente;
  if (merge.konflikte.includes(pfad)) return konfliktGrund(argumente, root);
  const gleich = eintrag(sha, pfad, root) === eintrag(merge.baum, pfad, root);
  return gleich ? [] : [`${AUSSERHALB} (${pfad})`];
}

function pfadeZumVergleich({ sha, neuerEltern, merge }, root) {
  const alle = [...geaendert(neuerEltern, sha, root), ...geaendert(neuerEltern, merge.baum, root)];
  return [...new Set(alle)].filter(istProduktpfad);
}

function umgelegtAus(alt, sha, root) {
  const altEltern = elternVon(alt, root);
  return altEltern.length === 1 && baumVon(altEltern[0], root) !== baumVon(elternVon(sha, root)[0], root);
}

function gruendeZu(alt, { sha, nachricht }, root) {
  const [[altEltern], [neuerEltern]] = [elternVon(alt, root), elternVon(sha, root)];
  const merge = dreiWegMerge({ alt, altEltern, neuerEltern }, root);
  if (merge.fehler !== undefined) return [merge.fehler];
  const genannt = genannteDateien(nachricht);
  const pfade = pfadeZumVergleich({ sha, neuerEltern, merge }, root);
  return pfade.flatMap((pfad) => pfadGrund({ pfad, sha, alt, altEltern, neuerEltern, merge, genannt }, root));
}

function gruendeGegen(vorgaenger, commit, root) {
  const urteile = vorgaenger.map(({ alt, kette }) => [...gruendeZu(alt, commit, root), ...kette]);
  return urteile.some((gruende) => gruende.length === 0) ? [] : (urteile[0] ?? []);
}

export function umgelegtPruefer({ ereignis, nummer, basis }, root) {
  let vorher;
  const cache = new Map();

  async function koepfe() {
    const probleme = [];
    let staende;
    try {
      staende = await alteKoepfe(nummer);
    } catch (fehler) {
      return { staende: [], probleme: [`Force-Push-Ereignisse des PR ${nummer} nicht lesbar: ${fehler.message}; ob der Commit umgelegt wurde, ist nicht prüfbar`] };
    }
    const geholt = staende.filter((kopf) => {
      const da = vorhanden(kopf, root) || holeVonGithub(kopf, root);
      if (!da) probleme.push(`der frühere PR-Kopf ${kopf.slice(0, KURZ)} lässt sich weder lokal noch vom Remote holen; ob der Commit umgelegt wurde, ist nicht prüfbar`);
      return da;
    });
    return { staende: geholt, probleme };
  }

  function vorgaengerVon(sha, nachricht, { alteStaende, ab }) {
    const gesucht = auftragZeile(nachricht);
    for (const [stelle, stand] of alteStaende.entries()) {
      if (stelle < ab) continue;
      if (!cache.has(stand)) cache.set(stand, altCommitsDes(stand, { basis, root }));
      const treffer = cache.get(stand).filter((alt) => alt.auftrag === gesucht && umgelegtAus(alt.sha, sha, root));
      if (treffer.length > 0) return { shas: treffer.map((alt) => alt.sha), naechster: stelle + 1 };
    }
    return { shas: [], naechster: alteStaende.length };
  }

  function vorgaengerMitKette(sha, nachricht, { alteStaende, ab }) {
    const { shas, naechster } = vorgaengerVon(sha, nachricht, { alteStaende, ab });
    return shas.map((alt) => {
      const frueher = vorgaengerMitKette(alt, commitNachricht(alt, root), { alteStaende, ab: naechster });
      return { alt, kette: gruendeGegen(frueher, { sha: alt, nachricht: commitNachricht(alt, root) }, root) };
    });
  }

  return {
    async gruende(sha, nachricht) {
      if (ereignis !== PULL_REQUEST) return [];
      if (nummer === undefined) return ["die PR-Nummer fehlt (--pr), die Force-Push-Ereignisse sind nicht lesbar"];
      vorher ??= await koepfe();
      const vorgaenger = vorgaengerMitKette(sha, nachricht, { alteStaende: vorher.staende, ab: 0 });
      return [...vorher.probleme, ...gruendeGegen(vorgaenger, { sha, nachricht }, root)];
    },
  };
}
