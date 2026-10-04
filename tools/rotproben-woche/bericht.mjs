const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_TECHNIK = 2;
const TABELLENTRENNER = /\|/g;

export function gruen(text) {
  return { text, ok: true };
}

export function rot(text) {
  return { text, ok: false };
}

export function technisch(text) {
  return { text, ok: false, technisch: true };
}

export function exitCode(urteile) {
  if (urteile.some(({ ok, technisch: technik }) => !ok && !technik)) return EXIT_ROT;
  return urteile.some(({ ok }) => !ok) ? EXIT_TECHNIK : EXIT_GRUEN;
}

function zelle(text) {
  return String(text).replace(TABELLENTRENNER, "\\|");
}

function probenZeile({ fall, pr, workflow, job, schritt, ergebnis }) {
  const nummer = pr === undefined ? "–" : `#${pr}`;
  return `| ${fall} | ${nummer} | ${workflow} / ${job} / ${schritt} | ${zelle(ergebnis.text)} |`;
}

function probenTeil(proben) {
  if (proben === undefined) return [];
  return [
    "",
    "| Fall | PR | erwarteter Schritt | Ergebnis |",
    "|---|---|---|---|",
    ...proben.map(probenZeile),
  ];
}

function berichtZeilen({ proben, push, menschen, aufgeraeumt }) {
  return [
    ...(push?.sperreFehlt ? [push.text, ""] : []),
    "## Rot-Proben",
    ...probenTeil(proben),
    ...(push ? ["", `Push-Probe (push-auf-master): ${push.text}`] : []),
    ...(menschen ? ["", "### Ohne Menschen", "", menschen.text] : []),
    ...(aufgeraeumt ? ["", aufgeraeumt.text] : []),
  ];
}

function alleUrteile({ proben = [], push, menschen, aufgeraeumt }) {
  return [...proben.map(({ ergebnis }) => ergebnis), push, menschen, aufgeraeumt].filter(Boolean);
}

export function alsBericht(teile) {
  return { zeilen: berichtZeilen(teile), urteile: alleUrteile(teile) };
}
