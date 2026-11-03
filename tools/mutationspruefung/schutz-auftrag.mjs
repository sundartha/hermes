import { auftragsCommits, git } from "../auftrag/git.mjs";

const AUFTRAG_ZEILE = /^Auftrag: ([^\s/]+\/\S+)$/;
const BLAME_KOPF = /^([0-9a-f]{40}) \d+ (\d+)/;

function auftragDes(trailer) {
  const auftraege = [...trailer].flatMap((zeile) => AUFTRAG_ZEILE.exec(zeile)?.slice(1) ?? []);
  return auftraege.length === 1 ? auftraege[0] : null;
}

function auftraegeSeit(basis, root) {
  const commits = auftragsCommits(root, `${basis}..HEAD`);
  return new Map(commits.flatMap(({ sha, trailer }) => (auftragDes(trailer) === null ? [] : [[sha, auftragDes(trailer)]])));
}

function einfuehrenderCommit(fall, basis, root) {
  const shas = git(["log", "--reverse", "--format=%H", `-S${fall.name}`, `${basis}..HEAD`, "--", fall.pfad], { cwd: root });
  return shas.split("\n").find(Boolean) ?? null;
}

function zeilenVon(datei, [von, bis], root) {
  const ausgabe = git(["blame", "--porcelain", "-L", `${von},${bis}`, "--", datei], { cwd: root });
  return ausgabe.split("\n").flatMap((zeile) => {
    const kopf = BLAME_KOPF.exec(zeile);
    return kopf === null ? [] : [{ sha: kopf[1], zeile: Number(kopf[2]) }];
  });
}

function alsBereiche(zeilen) {
  const bereiche = [];
  for (const zeile of [...zeilen].sort((links, rechts) => links - rechts)) {
    const letzter = bereiche.at(-1);
    if (letzter !== undefined && letzter[1] === zeile - 1) letzter[1] = zeile;
    else bereiche.push([zeile, zeile]);
  }
  return bereiche;
}

function herkunftJeZeile(einheiten, root) {
  return einheiten.map(({ datei, bereiche }) => ({ datei, zeilen: bereiche.flatMap((bereich) => zeilenVon(datei, bereich, root)) }));
}

function eigeneEinheiten(herkunft, shas) {
  return herkunft.flatMap(({ datei, zeilen }) => {
    const eigene = zeilen.filter(({ sha }) => shas.has(sha)).map(({ zeile }) => zeile);
    return eigene.length === 0 ? [] : [{ datei, bereiche: alsBereiche(eigene) }];
  });
}

function vollstaendigGemessen(eigene, gemessen) {
  const dateien = new Set(gemessen.map(({ datei }) => datei));
  return eigene.every(({ datei }) => dateien.has(datei));
}

export function schutzzuordnung(basis, root) {
  return (faelle, { gemessen, geaendert }) => {
    const auftraege = auftraegeSeit(basis, root);
    if (auftraege.size === 0) return new Map();
    const herkunft = herkunftJeZeile(geaendert, root);
    const zuordnung = new Map();
    for (const fall of faelle) {
      const commit = einfuehrenderCommit(fall, basis, root);
      const auftrag = auftraege.get(commit);
      if (auftrag === undefined) continue;
      const shas = new Set([...auftraege].filter(([, name]) => name === auftrag).map(([sha]) => sha));
      const eigene = eigeneEinheiten(herkunft, shas);
      if (vollstaendigGemessen(eigene, gemessen)) zuordnung.set(fall, { auftrag, commit, einheiten: eigene });
    }
    return zuordnung;
  };
}
