import { existsSync, readFileSync } from "node:fs";
import { env } from "node:process";

import {
  DURCHGELASSEN,
  FEHLALARME_DIR,
  GESTOPPT,
  LOCKERER,
  NICHT_AUSGEFUEHRT,
  fileAt,
} from "./pruefungen-messen.mjs";
import { getJson, repositoryName } from "./testschutz/github.mjs";

export const WERKZEUGTEXTE_FILE = "test/werkzeuge/werkzeugtexte.json";
const COMMENT_MARKER = "<!-- freigabe-zusammenfassung -->";
const GITHUB_API = "https://api.github.com";
const COMMENTS_PER_PAGE = 100;
const NUMBER_FORMAT = new Intl.NumberFormat("de-DE");

function flatten(value, prefix = []) {
  if (value === null || typeof value !== "object") return [[prefix.join(" › "), value]];
  return Object.entries(value).flatMap(([key, inner]) => flatten(inner, [...prefix, key]));
}

export function textChanges(basis) {
  const read = (text) => new Map(text === undefined ? [] : flatten(JSON.parse(text)));
  const pinned = fileAt(basis, WERKZEUGTEXTE_FILE);
  const before = read(pinned);
  const after = read(
    existsSync(WERKZEUGTEXTE_FILE) ? readFileSync(WERKZEUGTEXTE_FILE, "utf8") : undefined,
  );
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes = keys
    .filter((key) => before.get(key) !== after.get(key))
    .map((key) => ({ ort: key, vorher: before.get(key), nachher: after.get(key) }));
  const firstPin = pinned === undefined && after.size > 0;
  return { erstmals: firstPin, anzahl: after.size, aenderungen: firstPin ? [] : changes };
}

function formatCount(value) {
  if (value?.count !== undefined) return NUMBER_FORMAT.format(value.count);
  return value?.error === undefined ? "nicht gemessen" : `nicht messbar (${value.error})`;
}

function ruleChanges({ basis = {}, pr = {} }) {
  const before = basis.perRule ?? {};
  const after = pr.perRule ?? {};
  const rules = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const parts = rules
    .filter((rule) => (before[rule] ?? 0) !== (after[rule] ?? 0))
    .map((rule) => `${rule} ${before[rule] ?? 0} → ${after[rule] ?? 0}`);
  return parts.length === 0 ? "" : ` Je Regel: ${parts.join(", ")}.`;
}

function countLine(label, { basis, pr }, isNew) {
  if (isNew) return `- ${label} mit diesem PR: ${formatCount(pr)}.`;
  return `- ${label}: auf master ${formatCount(basis)}, mit diesem PR ${formatCount(pr)}.`;
}

function caseLines(label, verdicts) {
  if (verdicts.length === 0) return [];
  const count = (verdict) => verdicts.filter(({ pr }) => pr === verdict).length;
  const skipped = count(NICHT_AUSGEFUEHRT);
  const note = skipped === 0 ? "" : `, ${skipped} nicht ausgeführt`;
  const lines = [
    `- ${label}: ${count(GESTOPPT)} von ${verdicts.length} mit diesem PR gestoppt${note}.`,
  ];
  for (const { titel, basis, pr } of verdicts.filter((verdict) => verdict.pr === DURCHGELASSEN)) {
    const before = basis === undefined ? "" : `auf master ${basis}, `;
    lines.push(`  - „${titel}“: ${before}mit diesem PR ${pr}`);
  }
  return lines;
}

function checkLines(check) {
  const lines = ["", `**${check.titel}: ${check.urteil}**`];
  if (check.fehlt !== undefined) {
    lines.push(`- Nicht gemessen: ${check.fehlt} ist in diesem Lauf nicht installiert.`);
  }
  const { treffer, ausnahmen, neu } = check;
  if (treffer.pr !== undefined) {
    const perRule = neu ? "" : ruleChanges(treffer);
    lines.push(`${countLine("Treffer im ganzen Repo", treffer, neu)}${perRule}`);
  }
  if (ausnahmen.pr !== undefined) {
    lines.push(countLine(ausnahmen.bezeichnung ?? "Erlaubte Altlasten", ausnahmen, neu));
  }
  lines.push(...caseLines("Rot-Proben", check.proben));
  lines.push(...caseLines("Fehlalarm-Beispiele", check.fehlalarme));
  if (check.urteil === LOCKERER && !check.fehlalarmBelegt) {
    const where = `${FEHLALARME_DIR}/${check.id}/`;
    lines.push(
      `- Es fehlt ein Fehlalarm-Beispiel unter \`${where}\`, das master meldet und dieser PR nicht mehr.`,
    );
  }
  return lines;
}

function packageLine({ name, version, alterTage, downloads, lizenz, meldungen, fehler }) {
  const title = `- **${name} ${version}**`;
  if (fehler !== undefined) return `${title}: Angaben nicht abrufbar (${fehler}).`;
  const advisories = meldungen.length === 0 ? "keine" : meldungen.join("; ");
  const age = `veröffentlicht vor ${NUMBER_FORMAT.format(alterTage)} Tagen`;
  const usage = `${NUMBER_FORMAT.format(downloads)} Downloads in der letzten Woche`;
  return `${title}: ${age}, ${usage}, Lizenz ${lizenz}, bekannte Sicherheitsmeldungen: ${advisories}.`;
}

function quote(text) {
  return text === undefined ? "(nicht vorhanden)" : `„${text}“`;
}

function textLines({ ort, vorher, nachher }) {
  return [`- ${ort}`, `  - vorher: ${quote(vorher)}`, `  - nachher: ${quote(nachher)}`];
}

function textSection({ erstmals, anzahl, aenderungen }) {
  if (!erstmals) return aenderungen.flatMap(textLines);
  const count = NUMBER_FORMAT.format(anzahl);
  return [
    `Die Werkzeugtexte werden erstmals festgehalten (${count} Texte); am Draht ändert sich nichts.`,
  ];
}

function section(title, lines) {
  return lines.length === 0 ? [] : ["", `### ${title}`, "", ...lines];
}

export function summaryText(report) {
  const status = report.gruende.map((grund) => `- ${grund}`);
  const checks = report.pruefungen.flatMap(checkLines);
  return [
    COMMENT_MARKER,
    "## Freigabe-Prüfung: Zusammenfassung",
    "",
    `Art des PRs: **art:${report.art}**`,
    ...section("Was noch fehlt", status.length === 0 ? ["Nichts, keine Freigabe nötig."] : status),
    ...section(
      "Nur strenger, ohne Freigabe",
      report.strenger.map(({ path, fall }) => `- \`${path}\`: ${fall}`),
    ),
    ...section("Geänderte Prüfungen", checks.slice(1)),
    ...section(
      "Geänderte Prüfungsdateien ohne Messung",
      report.ohneMessung.map((path) => `- \`${path}\``),
    ),
    ...section("Neue Pakete", report.pakete.map(packageLine)),
    ...section("Werkzeugtexte aus tools/list", textSection(report.texte)),
    "",
  ].join("\n");
}

export async function sendToGitHub(method, path, body) {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN fehlt; die Prüfung braucht die GitHub-API.");
  const response = await fetch(`${env.GITHUB_API_URL || GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "hermes-freigabe",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Die GitHub-API antwortet auf ${method} ${path} mit HTTP ${response.status}.`);
  }
}

export async function writeSummary(pullRequest, report, relevant) {
  const { full } = repositoryName();
  const path = `/repos/${full}/issues/${pullRequest}/comments`;
  const comments = await getJson(`${path}?per_page=${COMMENTS_PER_PAGE}`);
  const existing = comments.find(({ body }) => body?.startsWith(COMMENT_MARKER));
  if (existing === undefined && !relevant) return;
  const body = { body: summaryText(report) };
  if (existing === undefined) await sendToGitHub("POST", path, body);
  else await sendToGitHub("PATCH", `/repos/${full}/issues/comments/${existing.id}`, body);
}
