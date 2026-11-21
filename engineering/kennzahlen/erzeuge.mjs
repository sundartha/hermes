#!/usr/bin/env node
// Kennzahlenseite Bausystem (Neubau 10.11.2026). Aufruf: node erzeuge.mjs [--voll] [--ohne-gh] [--aus <html>]
// Liest: lokale Protokolle der Paketsteuerung (/tmp/paket-*) -> sichert sie dauerhaft nach zustand/roh,
//        GitHub sundartha/hermes (nur lesend, inkrementell) -> zustand/gh.json.
// Schreibt: eine eigenständige HTML-Datei (Daten eingebettet) nach /Users/antonio/.openclaw/canvas/engineering/index.html.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ZUSTAND = path.join(HIER, 'zustand');
const ROH = path.join(ZUSTAND, 'roh');
const GHDATEI = path.join(ZUSTAND, 'gh.json');
const AUS = process.argv.includes('--aus') ? process.argv[process.argv.indexOf('--aus') + 1] : '/Users/antonio/.openclaw/canvas/engineering/index.html';
const VOLL = process.argv.includes('--voll');
const OHNE_GH = process.argv.includes('--ohne-gh');
const REPO = 'sundartha/hermes';
const GH = fs.existsSync('/opt/homebrew/bin/gh') ? '/opt/homebrew/bin/gh' : 'gh';
const TAGE = 14;
const JETZT = Date.now();
const t0 = JETZT;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const ms = (s) => (s ? Date.parse(s) : NaN);
const log = (...a) => console.error(...a);
fs.mkdirSync(ROH, { recursive: true });

// ---------- Sperre: nie zwei Läufe gleichzeitig ----------
const SPERRE = path.join(ZUSTAND, 'lauf.lock');
try {
  const alt = fs.existsSync(SPERRE) ? fs.statSync(SPERRE).mtimeMs : 0;
  if (alt && JETZT - alt < 5 * 60e3) { log('Es läuft schon ein Lauf.'); process.exit(0); }
  fs.writeFileSync(SPERRE, String(process.pid));
} catch { /* weiter */ }
process.on('exit', () => { try { fs.unlinkSync(SPERRE); } catch { /* egal */ } });

// ---------- 1. Rohdaten sichern ----------
const TMP = '/Users/antonio/Bereiche/sundartha/engineering/ketten';   // Zustandsordner der Ketten (wie KETTEN in paket.sh)
function kopiere(von, nach) {
  let s;
  try { s = fs.statSync(von); } catch { return; }
  let d = null;
  try { d = fs.statSync(nach); } catch { /* neu */ }
  if (d && d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 1500) return;
  fs.copyFileSync(von, nach);
  fs.utimesSync(nach, s.atime, s.mtime);
}
function sichere() {
  let n = 0;
  for (const e of fs.readdirSync(TMP)) {
    if (!/^paket-\d+$/.test(e)) continue;
    const q = path.join(TMP, e);
    let st;
    try { st = fs.statSync(q); } catch { continue; }
    if (!st.isDirectory()) continue;
    const z = path.join(ROH, e);
    fs.mkdirSync(z, { recursive: true });
    for (const f of fs.readdirSync(q)) {
      if (/\.(txt|jsonl)$/.test(f) || f === 'pr.json') { kopiere(path.join(q, f), path.join(z, f)); n++; }
    }
    // Zeitstempel von .start (Beginn des letzten Laufs der Kette) und Vorhandensein von halt.txt festhalten
    const meta = path.join(z, '_meta.json');
    let m = {};
    try { m = JSON.parse(fs.readFileSync(meta, 'utf8')); } catch { /* neu */ }
    try { m.startTouch = fs.statSync(path.join(q, '.start')).mtimeMs; } catch { /* kein .start */ }
    m.gesehen = JETZT;
    fs.writeFileSync(meta, JSON.stringify(m));
  }
  kopiere(path.join(TMP, 'paket-starts.log'), path.join(ROH, 'paket-starts.log'));
  kopiere(path.join(TMP, 'paket-warteschlange.txt'), path.join(ROH, 'paket-warteschlange.txt'));
  // Warteschlange auch als Live-Wert merken (Rohkopie spiegelt /tmp; ist /tmp leer, bleibt der letzte Stand)
  return n;
}
const nGesichert = sichere();
const tmpDa = fs.readdirSync(TMP).some((e) => /^paket-\d+$/.test(e));

// ---------- 2. GitHub, inkrementell ----------
function gh(pfad, params = {}) {
  const args = ['api', '-X', 'GET', pfad];
  for (const [k, v] of Object.entries(params)) args.push('-f', `${k}=${v}`);
  return JSON.parse(execFileSync(GH, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 25000 }));
}
let G = { pr: {}, prVon: null, issues: {}, issVon: null, kom: {}, komVon: null, runs: {}, runsVon: null, mg: {}, mgVon: null };
try { G = { ...G, ...JSON.parse(fs.readFileSync(GHDATEI, 'utf8')) }; } catch { /* erster Lauf */ }
const ghStat = { abfragen: 0, fehler: [] };
const horizont = iso(JETZT - (TAGE + 3) * 864e5);
const SEITEN = VOLL ? 60 : 8;

const refsAus = (titel, body, branch) => {
  const s = new Set();
  const b = /^paket\/(\d+)/.exec(branch || ''); if (b) s.add(+b[1]);
  for (const m of (body || '').matchAll(/(?:Teil von|Closes|Fixes|Refs?|Resolves)\s+#(\d+)/gi)) s.add(+m[1]);
  for (const m of (titel || '').matchAll(/\(#(\d+)\)|Paket\s+(\d{3,5})\b/g)) s.add(+(m[1] || m[2]));
  return [...s].slice(0, 8);
};
const ersteZeile = (t) => (t || '').split('\n').find((z) => z.trim()) || '';
const letzteZeile = (t) => (t || '').split('\n').map((z) => z.trim()).filter(Boolean).at(-1) || '';

function holePRs() {
  const seit = G.prVon ? iso(ms(G.prVon) - 10 * 60e3) : horizont;
  let neuestes = null, fertig = false;
  for (let p = 1; p <= SEITEN && !fertig; p++) {
    const liste = gh(`repos/${REPO}/pulls`, { state: 'all', sort: 'updated', direction: 'desc', per_page: 100, page: p }); ghStat.abfragen++;
    if (!liste.length) break;
    for (const x of liste) {
      if (!neuestes) neuestes = x.updated_at;
      if (x.updated_at < seit) { fertig = true; break; }
      G.pr[x.number] = {
        nr: x.number, titel: x.title, status: x.merged_at ? 'gemergt' : x.state === 'open' ? 'offen' : 'geschlossen',
        erstellt: x.created_at, gemergt: x.merged_at, geschlossen: x.closed_at, aktualisiert: x.updated_at,
        zweig: x.head.ref, kopf: x.head.sha, entwurf: !!x.draft, autor: x.user?.login, paket: refsAus(x.title, x.body, x.head.ref),
      };
    }
  }
  if (fertig || !neuestes) G.prVon = neuestes || G.prVon || iso(JETZT);
  else ghStat.fehler.push('PR-Liste nicht vollständig gelesen (Seitengrenze)');
}
// Dateiliste je PR (nur lesend, inkrementell): gemergte PRs ändern sich nie, offene werden bei neuem Kopf neu gelesen.
// Gespeichert wird nur: ändert der PR etwas unter src/ (s), nach der alten Regel (src/, public/, apps/) Produkt (a), Zahl der Dateien (n).
const MAX_DATEIEN = 450;
function holeDateien() {
  G.dat ||= {};
  const todo = Object.values(G.pr).filter((p) => p.status !== 'geschlossen' && (!G.dat[p.nr] || (p.status === 'offen' && G.dat[p.nr].k !== p.kopf)))
    .sort((a, b) => (b.gemergt || b.aktualisiert || '').localeCompare(a.gemergt || a.aktualisiert || '')).slice(0, MAX_DATEIEN);
  let ausgelassen = 0;
  for (const p of todo) {
    try {
      let s = 0, a = 0, n = 0;
      for (let pg = 1; pg <= 30; pg++) {
        const l = gh(`repos/${REPO}/pulls/${p.nr}/files`, { per_page: 100, page: pg }); ghStat.abfragen++;
        for (const f of l) { n++; const pf = [f.filename, f.previous_filename].filter(Boolean); if (pf.some((x) => x.startsWith('src/'))) s = 1; if (pf.some((x) => /^(src|public|apps)\//.test(x))) a = 1; }
        if (l.length < 100) break;
      }
      G.dat[p.nr] = { k: p.kopf, s, a, n };
    } catch (e) { ausgelassen++; if (ausgelassen > 5) throw e; }
  }
  const rest = Object.values(G.pr).filter((p) => p.status !== 'geschlossen' && !G.dat[p.nr]).length;
  if (rest) ghStat.fehler.push(`Dateilisten: noch ${rest} PRs offen (werden in den nächsten Läufen gelesen)`);
}
function holeIssues() {
  if (G.planV !== 2) { G.planV = 2; G.issVon = null; } // einmalig: Issue-Texte für die vorläufige Einordnung nachlesen
  let seit = G.issVon || horizont;
  for (let p = 1; p <= SEITEN; p++) {
    const liste = gh(`repos/${REPO}/issues`, { state: 'all', since: seit, sort: 'updated', direction: 'asc', per_page: 100, page: p }); ghStat.abfragen++;
    for (const x of liste) {
      if (x.pull_request) continue;
      G.issues[x.number] = { nr: x.number, titel: x.title, erstellt: x.created_at, geschlossen: x.closed_at, status: x.state, labels: x.labels.map((l) => l.name),
        planSrc: /(^|[\s`(\/"'])src\//.test(x.body || '') ? 1 : 0, planWerk: /(^|[\s`(\/"'])(tools|\.github|\.claude|scripts)\//.test(x.body || '') ? 1 : 0 };
    }
    if (liste.length) G.issVon = liste.at(-1).updated_at;
    if (liste.length < 100) return;
  }
  ghStat.fehler.push('Issues nicht vollständig (Seitengrenze, setzt im nächsten Lauf fort)');
}
function holeKommentare() {
  let seit = G.komVon || horizont;
  for (let p = 1; p <= SEITEN; p++) {
    const liste = gh(`repos/${REPO}/issues/comments`, { since: seit, per_page: 100, page: p }); ghStat.abfragen++;
    for (const x of liste) {
      const nr = +x.issue_url.split('/').pop();
      const erste = ersteZeile(x.body), letzte = letzteZeile(x.body);
      const bot = /\[bot\]$/.test(x.user?.login || '');
      let urteil = null;
      if (/^PASS\b/.test(erste) || /^PASS\b/.test(letzte)) urteil = 'PASS';
      else if (/^FAIL\b/.test(letzte) || /^FAIL\b/.test(erste) || /^Urteil.*FAIL/.test(erste)) urteil = 'FAIL';
      const konflikt = /^Konflikt mit master auf Kopf/.test(erste);
      if (!bot && !urteil) continue; // nur Kommentare der Agenten und Urteile
      G.kom[x.id] = { id: x.id, nr, zeit: x.created_at, von: x.user?.login, urteil, konflikt, kopf: (/\b([0-9a-f]{7})\b/.exec(erste) || [])[1] || null, text: (urteil ? letzte : erste).slice(0, 220) };
    }
    if (liste.length) G.komVon = liste.reduce((m, x) => (x.updated_at > m ? x.updated_at : m), seit);
    if (liste.length < 100) return;
  }
  ghStat.fehler.push('Kommentare nicht vollständig (Seitengrenze, setzt im nächsten Lauf fort)');
}
function holeLaeufe(ereignis, ablage, vonSchluessel) {
  const offene = Object.values(G[ablage]).filter((r) => r.status !== 'completed').map((r) => ms(r.erstellt));
  let ab = G[vonSchluessel] ? Math.min(ms(G[vonSchluessel]) - 10 * 60e3, ...offene) : ms(horizont);
  ab = Math.max(ab, ms(horizont));
  const ist = Math.max(ab, 0);
  let neuestes = null;
  for (let p = 1; p <= SEITEN; p++) {
    const antwort = gh(`repos/${REPO}/actions/runs`, { event: ereignis, created: `>=${iso(ist)}`, per_page: 100, page: p }); ghStat.abfragen++;
    const liste = antwort.workflow_runs || [];
    for (const r of liste) {
      if (!neuestes || r.created_at > neuestes) neuestes = r.created_at;
      G[ablage][r.id] = { id: r.id, name: r.name, kopf: r.head_sha, zweig: r.head_branch, status: r.status, ergebnis: r.conclusion, erstellt: r.created_at, start: r.run_started_at, ende: r.updated_at };
    }
    if (liste.length < 100) { if (neuestes) G[vonSchluessel] = neuestes; return; }
  }
  ghStat.fehler.push(`Läufe (${ereignis}) nicht vollständig (Seitengrenze)`);
}
if (!OHNE_GH) {
  for (const [name, f] of [['PRs', holePRs], ['Dateilisten', holeDateien], ['Issues', holeIssues], ['Kommentare', holeKommentare], ['CI-Läufe', () => holeLaeufe('pull_request', 'runs', 'runsVon')], ['Merge-Queue-Läufe', () => holeLaeufe('merge_group', 'mg', 'mgVon')]]) {
    try { f(); } catch (e) { ghStat.fehler.push(`${name}: ${String(e.message || e).split('\n')[0].slice(0, 160)}`); }
  }
  G.stand = iso(JETZT);
  // Aufräumen: alles, was älter als der Horizont ist, wird verworfen (hält die Datei klein)
  const alt = iso(JETZT - (TAGE + 8) * 864e5);
  for (const k of Object.keys(G.runs)) if (G.runs[k].erstellt < alt) delete G.runs[k];
  for (const k of Object.keys(G.mg)) if (G.mg[k].erstellt < alt) delete G.mg[k];
  for (const k of Object.keys(G.kom)) if (G.kom[k].zeit < alt) delete G.kom[k];
  fs.writeFileSync(GHDATEI + '.tmp', JSON.stringify(G)); fs.renameSync(GHDATEI + '.tmp', GHDATEI);
}

// ---------- 3. Lokale Protokolle lesen ----------
const lies = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const zeilen = (p) => lies(p).split('\n').map((z) => z.trim()).filter(Boolean);
const mt = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return NaN; } };

// laufende Ketten (paket.sh <nr>)
const laufend = new Set();
try {
  for (const z of execFileSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8', maxBuffer: 16e6 }).split('\n')) {
    const m = /(?:^|\/|\s)paket\.sh (\d+)/.exec(z); if (m && !/grep/.test(z)) laufend.add(+m[1]);
  }
} catch { /* ps fehlt */ }

// Start-Protokoll: je Paket gestartet / wartet
const starts = {};
for (const z of zeilen(path.join(ROH, 'paket-starts.log'))) {
  const m = /^(\S+Z) (\d+) (\d) (gestartet|wartet|gesperrt|doppelt)\b/.exec(z); if (!m) continue;
  (starts[m[2]] ||= []).push({ t: ms(m[1]), art: m[4] });
}
const warteschlange = zeilen(path.join(ROH, 'paket-warteschlange.txt')).map((z) => z.split(' ')[0]);

const STATIONEN = ['bau', 'ci', 'pruefer', 'ruecklauf', 'konflikt', 'platz', 'queue', 'halt', 'sonst'];
const NAMEN = { bau: 'Bau', ci: 'CI-Warten', pruefer: 'Prüfer', ruecklauf: 'Rücklauf', konflikt: 'Konflikt', platz: 'Warten auf Platz', queue: 'Merge-Queue', halt: 'Halt (Kette steht)', sonst: 'Übergaben, Sonstiges' };

function sitzungArt(name) {
  let m;
  if ((m = /^pruefer-(\d+)-(\d+)$/.exec(name))) return { art: 'pruefer', h: +m[1], r: +m[2], etikett: `Prüfer ${m[2]}` };
  if ((m = /^bau-(\d+)-ruecklauf-(\d+)$/.exec(name))) return { art: 'ruecklauf', h: +m[1], r: +m[2], etikett: `Rücklauf ${m[2]}` };
  if ((m = /^bau-(\d+)-bewerten-(\d+)$/.exec(name))) return { art: 'ruecklauf', h: +m[1], r: +m[2], etikett: 'Bewertung nach zwei Rückläufen' };
  if ((m = /^bau-(\d+)-schneiden$/.exec(name))) return { art: 'bau', h: +m[1], etikett: 'Häppchen kleiner schneiden' };
  if ((m = /^bau-(\d+)$/.exec(name))) return { art: 'bau', h: +m[1], etikett: 'Bau / Steuerung' };
  return { art: 'bau', h: 0, etikett: name };
}

// Gewichte der Tokens: nur an einer Stelle (messung/messen.py GEWICHT), hier übernommen.
const GEW = JSON.parse(execFileSync('/opt/homebrew/bin/python3', [path.join(HIER, '..', '..', 'messung', 'messen.py'), '--gewicht'], { encoding: 'utf8' }));
const gewichtet = (o) => (o.ein || 0) * GEW.input_tokens + (o.aus || 0) * GEW.output_tokens + (o.cache_neu || 0) * GEW.cache_creation_input_tokens + (o.cache_lesen || 0) * GEW.cache_read_input_tokens;
const horizontMs = JETZT - TAGE * 864e5;
const pakete = [];
for (const e of fs.readdirSync(ROH)) {
  if (!/^paket-\d+$/.test(e)) continue;
  const nr = +e.slice(6);
  const d = path.join(ROH, e);
  const meta = (() => { try { return JSON.parse(lies(path.join(d, '_meta.json'))); } catch { return {}; } })();
  const sitz = [];
  for (const z of zeilen(path.join(d, 'verbrauch.jsonl'))) {
    let o; try { o = JSON.parse(z); } catch { continue; }
    if (!o.sitzung || !o.ende) continue;
    const a = sitzungArt(o.sitzung);
    const ende = o.ende * 1000;
    const dauer = (o.sek || 0) * 1000;
    sitz.push({ name: o.sitzung, ...a, ende, start: ende - dauer, dauer, fehler: !!o.fehler, limit: !!o.limit, modell: o.modell || '', usd: o.kosten_usd || 0,
      tok: gewichtet(o), tokAus: o.aus || 0 });
  }
  sitz.sort((a, b) => a.start - b.start);
  const startTxt = zeilen(path.join(d, 'start.txt'))[0];
  const gemergt = zeilen(path.join(d, 'gemergt.txt')).map((z) => { const [pr, t] = z.split(' '); return { pr: +pr, t: ms(t) }; }).filter((x) => x.pr && x.t);
  const fertigT = ms(zeilen(path.join(d, 'fertig.txt'))[0]);
  const konto = zeilen(path.join(d, 'konto.txt')).map((z) => ms(z.split(' ')[1])).filter((x) => x);
  const erstStart = ms(startTxt) || Math.min(...[konto[0], sitz[0]?.start].filter(Boolean));
  const aktiv = Math.max(sitz.at(-1)?.ende || 0, gemergt.at(-1)?.t || 0, fertigT || 0, mt(path.join(d, 'halt.txt')) || 0, ...(starts[nr] || []).map((s) => s.t));
  if (!erstStart || !(aktiv > horizontMs)) continue;

  // Halts: halt*.txt (mtime = Zeitpunkt)
  const halts = [];
  for (const f of fs.readdirSync(d)) {
    if (!/^halt.*\.txt/.test(f)) continue;
    const t = mt(path.join(d, f)); const txt = zeilen(path.join(d, f)).filter((x) => !/^Nächster Schritt:/.test(x)).at(-1) || '';
    if (!txt || /^wartet auf Platz/.test(txt)) continue;
    halts.push({ t, datei: f, grund: txt.slice(0, 400) });
  }
  halts.sort((a, b) => a.t - b.t);
  const haltAktuell = (() => {
    const p = path.join(d, 'halt.txt');
    if (!fs.existsSync(p)) return null;
    const t = mt(p); if (meta.startTouch && t < meta.startTouch) return null; // Altlast vor dem letzten Start
    const txt = zeilen(p).filter((x) => !/^Nächster Schritt:/.test(x)).at(-1) || '';
    return { t, grund: txt, platz: /^wartet auf Platz/.test(txt) };
  })();
  const wartetAuf = (() => { const p = path.join(d, 'wartet-auf.txt'); return fs.existsSync(p) ? zeilen(p)[0] : null; })();

  // Status
  const ersteGemergt = gemergt.length;
  let status;
  if (laufend.has(nr)) status = 'laufend';
  else if (!isNaN(fertigT) && (!meta.startTouch || fertigT >= meta.startTouch - 1000)) status = 'fertig';
  else if (warteschlange.includes(String(nr)) || (haltAktuell?.platz && !laufend.has(nr))) status = 'wartend';
  else if (haltAktuell || wartetAuf) status = 'angehalten';
  else status = 'ruht';
  // "wartet auf Platz" aus dem Startprotokoll: letzter Eintrag ist wartet
  const sl = starts[nr] || [];
  if (status === 'ruht' && sl.filter((s) => s.art !== 'doppelt').at(-1)?.art === 'wartet') status = 'wartend';

  pakete.push({ nr, d, sitz, gemergt, fertigT, erstStart, konto, halts, haltAktuell, wartetAuf, status, startTouch: meta.startTouch, aktiv });
}

// ---------- 4. Zeitleisten bauen ----------
const prUeberPaket = {};
for (const p of Object.values(G.pr)) for (const n of p.paket) (prUeberPaket[n] ||= []).push(p);
const kommentareJePR = {};
for (const k of Object.values(G.kom)) (kommentareJePR[k.nr] ||= []).push(k);
const laeufeJeZweig = {};
for (const r of Object.values(G.runs)) (laeufeJeZweig[r.zweig] ||= []).push(r);
const queueJePR = {};
for (const r of Object.values(G.mg)) { const m = /\/pr-(\d+)-/.exec(r.zweig || ''); if (m) (queueJePR[m[1]] ||= []).push(r); }
const PRIO = { bau: 9, ruecklauf: 9, konflikt: 9, pruefer: 9, queue: 7, ci: 6, platz: 5, halt: 4, sonst: 0 };

function zeitleiste(P, ende) {
  const start = P.erstStart;
  const iv = []; // {s,e,art,prio,tok,etikett,h}
  // Sitzungen; Konflikt-Rückläufe erkennen
  const prs = prUeberPaket[P.nr] || [];
  const konfliktZeiten = prs.flatMap((p) => (kommentareJePR[p.nr] || []).filter((k) => k.konflikt).map((k) => ms(k.zeit)));
  for (const s of P.sitz) {
    let art = s.art, etikett = s.etikett;
    if (art === 'ruecklauf' && /ruecklauf/.test(s.name) && konfliktZeiten.some((t) => t >= s.start - 240e3 && t <= s.start + 60e3)) { art = 'konflikt'; etikett = 'Rebase wegen Konflikt'; }
    s.station = art; s.etikett = etikett;
    if (s.dauer > 0) iv.push({ s: s.start, e: s.ende, art, prio: PRIO[art], tok: s.tok, etikett, h: s.h, name: s.name });
  }
  // Merge-Queue und CI je PR
  const pass = {};
  for (const p of prs) {
    for (const k of kommentareJePR[p.nr] || []) if (k.urteil === 'PASS') pass[p.nr] = Math.max(pass[p.nr] || 0, ms(k.zeit));
    const q = (queueJePR[p.nr] || []).sort((a, b) => (a.erstellt < b.erstellt ? -1 : 1));
    if (q.length) {
      const nachPass = q.find((r) => ms(r.erstellt) >= (pass[p.nr] || 0) - 60e3) || q[0];
      const qs = ms(nachPass.erstellt);
      const qe = p.gemergt ? ms(p.gemergt) : Math.max(...q.map((r) => ms(r.ende)));
      if (qe > qs) iv.push({ s: qs, e: qe, art: 'queue', prio: PRIO.queue, tok: 0, etikett: `Merge-Queue PR ${p.nr}`, pr: p.nr });
    }
    const nachSha = {};
    for (const r of laeufeJeZweig[p.zweig] || []) (nachSha[r.kopf] ||= []).push(r);
    for (const [sha, rs] of Object.entries(nachSha)) {
      const cs = Math.min(...rs.map((r) => ms(r.start || r.erstellt)));
      const ce = Math.max(...rs.map((r) => ms(r.ende)));
      const offen = rs.some((r) => r.status !== 'completed');
      if (ce > cs) iv.push({ s: cs, e: offen ? Math.min(Math.max(ce, cs), ende) : ce, art: 'ci', prio: PRIO.ci, tok: 0, etikett: `CI läuft (PR ${p.nr}, Stand ${sha.slice(0, 7)})`, pr: p.nr });
    }
  }
  // Warten auf Platz und Halt
  const sl = (starts[P.nr] || []).filter((x) => x.art === 'gestartet' || x.art === 'wartet').sort((a, b) => a.t - b.t);
  // Zulassungen: Startprotokoll plus konto.txt (für die Zeit vor dem Startprotokoll)
  const zul = sl.filter((x) => x.art === 'gestartet').map((x) => x.t);
  for (const t of P.konto) if (!zul.some((z) => Math.abs(z - t) < 360e3)) zul.push(t);
  zul.sort((a, b) => a - b);
  const wartePhasen = [];
  for (let i = 0; i < sl.length; i++) {
    if (sl[i].art !== 'wartet') continue;
    if (i > 0 && sl[i - 1].art === 'wartet') continue; // nur der erste Eintrag einer Wartephase
    const nach = sl.slice(i + 1).find((x) => x.art === 'gestartet');
    wartePhasen.push({ s: sl[i].t, e: nach ? nach.t : (P.status === 'wartend' ? ende : sl[i].t) });
  }
  for (const w of wartePhasen) if (w.e > w.s) iv.push({ s: w.s, e: w.e, art: 'platz', prio: PRIO.platz, tok: 0, etikett: 'wartet auf einen freien Kettenplatz' });
  const aktivVor = (t) => Math.max(start, ...P.sitz.filter((s) => s.ende <= t).map((s) => s.ende), ...P.gemergt.filter((g) => g.t <= t).map((g) => g.t),
    ...P.halts.filter((h) => h.t <= t && h.t >= start).map((h) => h.t));
  zul.slice(1).forEach((g) => {
    const trig = Math.min(g, ...wartePhasen.filter((w) => w.e <= g + 1000 && w.e >= g - 2000).map((w) => w.s));
    const e0 = aktivVor(trig);
    if (trig - e0 > 90e3) iv.push({ s: e0, e: trig, art: 'halt', prio: PRIO.halt, tok: 0, etikett: 'Kette stand (angehalten, bis zum Neustart)' });
  });
  // aktuell angehalten: seit dem letzten Halt bis jetzt
  if (P.status === 'angehalten') {
    const e0 = aktivVor(ende);
    if (ende - e0 > 90e3) iv.push({ s: e0, e: ende, art: 'halt', prio: PRIO.halt, tok: 0, etikett: 'Kette steht: ' + (P.haltAktuell?.grund || P.wartetAuf ? `wartet auf PR ${P.wartetAuf}` : 'angehalten').slice(0, 120) });
  }
  // Ausgleichen: Prioritäten auflösen
  const grenzen = [...new Set(iv.flatMap((x) => [x.s, x.e]).concat([start, ende]).filter((t) => t >= start && t <= ende))].sort((a, b) => a - b);
  const seg = [];
  for (let i = 0; i < grenzen.length - 1; i++) {
    const a = grenzen[i], b = grenzen[i + 1];
    if (b - a < 1) continue;
    let best = null;
    for (const x of iv) if (x.s <= a && x.e >= b && (!best || x.prio > best.prio)) best = x;
    const art = best ? best.art : 'sonst';
    const letztes = seg.at(-1);
    if (letztes && letztes.art === art && letztes.ref === (best?.name || best?.etikett || '') && letztes.e === a) letztes.e = b;
    else seg.push({ s: a, e: b, art, ref: best?.name || best?.etikett || '', etikett: best?.etikett || 'Übergaben der Kette (Befehle, Abfragen, kurze Pausen)', tok: 0, h: best?.h, pr: best?.pr });
  }
  // Tokens den Sitzungs-Segmenten zuordnen (volle Sitzung, auch wenn geschnitten)
  const segSitz = new Map();
  for (const s of P.sitz) {
    const x = seg.find((q) => q.ref === s.name && q.s >= s.start - 1 && q.e <= s.ende + 1 && !segSitz.has(q));
    if (x) { x.tok = s.tok; x.modell = s.modell; x.usd = s.usd; segSitz.set(x, 1); }
  }
  return seg;
}

// ---------- 4b. Einordnung Produkt / Werkzeug ----------
// Produkt = mindestens ein PR des Pakets (gemergt oder offen) ändert eine Datei unter src/. Sonst Werkzeug.
// Ohne PR (oder ohne gelesene Dateiliste): vorläufig nach dem Issue (Plantext nennt src/ -> Produkt; nennt tools/.github/.claude/scripts und kein src/ -> Werkzeug (test/ und docs/ allein reichen nicht, die nennt jeder Plan)), sonst „offen“.
const prArt = (nr) => (G.dat?.[nr] ? (G.dat[nr].s ? 'produkt' : 'werkzeug') : null);
function ordneEin(nr, prs) {
  const zaehl = prs.filter((p) => p.status !== 'geschlossen');
  const bekannt = zaehl.filter((p) => G.dat?.[p.nr]);
  const srcPrs = bekannt.filter((p) => G.dat[p.nr].s).map((p) => p.nr);
  const alt = bekannt.some((p) => G.dat[p.nr].a);
  if (srcPrs.length) return { art: 'produkt', quelle: 'pr', srcPrs, alt };
  if (zaehl.length && bekannt.length === zaehl.length) return { art: 'werkzeug', quelle: 'pr', srcPrs, alt };
  const iss = G.issues[nr];
  const PRODUKT_LABELS = ['verhalten-geaendert', 'bug', 'enhancement']; // in der Stichprobe der PR-geprüften Pakete nie Werkzeug (siehe Bericht)
  if (iss?.planSrc || (!iss?.planWerk && iss?.labels?.some((l) => PRODUKT_LABELS.includes(l)))) return { art: 'produkt', quelle: 'vorlaeufig', srcPrs, alt };
  if (false) return { art: 'produkt', quelle: 'vorlaeufig', srcPrs, alt };
  if (iss?.planWerk) return { art: 'werkzeug', quelle: 'vorlaeufig', srcPrs, alt };
  return { art: 'offen', quelle: 'offen', srcPrs, alt };
}

// ---------- 5. Pakete zusammenfassen ----------
const berlinTag = (t) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(t));
const median = (a) => { const b = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!b.length) return null; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const mittel = (a) => { const b = a.filter((x) => Number.isFinite(x)); return b.length ? b.reduce((x, y) => x + y, 0) / b.length : null; };

const haeppchenAlle = [];
const ausgabe = [];
for (const P of pakete) {
  const status = P.status;
  const ende = status === 'fertig' ? (P.gemergt.at(-1)?.t || P.fertigT || P.aktiv) : ['laufend', 'wartend', 'angehalten'].includes(status) ? JETZT : P.aktiv;
  const seg = zeitleiste(P, ende);
  const prs = [...(prUeberPaket[P.nr] || [])];
  for (const g of P.gemergt) if (G.pr[g.pr] && !prs.includes(G.pr[g.pr])) prs.push(G.pr[g.pr]); // gemergte PRs aus gemergt.txt, auch wenn Titel/Text das Paket nicht nennen
  prs.sort((a, b) => a.nr - b.nr);
  const issue = G.issues[P.nr];
  const einordnung = ordneEin(P.nr, prs);
  P.art = einordnung.art;
  const summe = Object.fromEntries(STATIONEN.map((s) => [s, 0]));
  const tokSt = Object.fromEntries(STATIONEN.map((s) => [s, 0]));
  for (const x of seg) { summe[x.art] += x.e - x.s; tokSt[x.art] += x.tok || 0; }
  // Häppchen
  const hae = [];
  P.gemergt.forEach((g, i) => {
    const h = i + 1;
    const ss = P.sitz.filter((s) => s.h === h);
    const vor = i ? P.gemergt[i - 1].t : P.erstStart;
    const start = ss.length ? Math.min(...ss.map((s) => s.start)) : vor;
    const ruck = ss.filter((s) => /-ruecklauf-\d+$/.test(s.name)).length;
    const konfl = ss.filter((s) => s.station === 'konflikt').length;
    const x = { paket: P.nr, art: P.art, h, pr: g.pr, start, ende: g.t, dauer: g.t - start, ruecklauf: ruck, konflikt: konfl, pruefer: ss.filter((s) => s.art === 'pruefer').length, sitz: ss.length, tok: ss.reduce((a, s) => a + s.tok, 0) };
    hae.push(x); haeppchenAlle.push(x);
  });
  const offenH = P.gemergt.length + 1;
  const sOffen = P.sitz.filter((s) => s.h === offenH);
  const offenePR = prs.filter((p) => p.status === 'offen').at(-1);
  const gesamt = ende - P.erstStart;
  const tokGes = P.sitz.reduce((a, s) => a + s.tok, 0);
  const ruckGes = P.sitz.filter((s) => /-ruecklauf-\d+$/.test(s.name)).length;
  const starts_n = Math.max(P.konto.length, (starts[P.nr] || []).filter((s) => s.art === 'gestartet').length);
  const halts = P.halts.map((h) => ({ t: h.t, grund: h.grund }));
  const mitHalt = starts_n > 1 || halts.some((h) => !/^(wartet auf Platz)/.test(h.grund) && h.t >= P.erstStart);
  const letzterGrund = P.haltAktuell && !P.haltAktuell.platz ? P.haltAktuell.grund : P.wartetAuf ? `wartet auf PR ${P.wartetAuf}` : '';
  ausgabe.push({
    art: einordnung.art, artQuelle: einordnung.quelle, artAlt: einordnung.alt ? 'produkt' : 'werkzeug', srcPrs: einordnung.srcPrs,
    nr: P.nr, titel: issue?.titel || prs.at(-1)?.titel || `Paket ${P.nr}`, status, start: P.erstStart, ende, gesamt, fertig: status === 'fertig',
    issueErstellt: issue?.erstellt || null,
    summe, tokSt, tok: tokGes, ruecklauf: ruckGes, haeppchenGemergt: P.gemergt.length, mitHalt, starts: starts_n,
    haltGrund: status === 'fertig' ? '' : letzterGrund || (status === 'wartend' ? 'wartet auf einen freien Kettenplatz' : ''),
    halts: halts.slice(-8),
    seg: seg.map((x) => [x.s, x.e, STATIONEN.indexOf(x.art), x.etikett, x.tok || 0, x.h || 0, x.modell || '']),
    haeppchen: hae,
    offen: status === 'fertig' ? null : { h: offenH, pr: offenePR?.nr || null, sitzungen: sOffen.length },
    prs: prs.map((p) => ({ nr: p.nr, titel: p.titel, status: p.status, erstellt: p.erstellt, gemergt: p.gemergt })),
    urteile: prs.flatMap((p) => (kommentareJePR[p.nr] || []).filter((k) => k.urteil).map((k) => ({ pr: p.nr, t: ms(k.zeit), u: k.urteil, text: k.text, kopf: k.kopf }))).sort((a, b) => a.t - b.t),
    ci: prs.flatMap((p) => (laeufeJeZweig[p.zweig] || []).map((r) => ({ id: r.id, pr: p.nr, name: r.name, ergebnis: r.status === 'completed' ? r.ergebnis : r.status, start: ms(r.start || r.erstellt), ende: ms(r.ende), kopf: r.kopf.slice(0, 7) }))).sort((a, b) => a.start - b.start),
    sitzungen: P.sitz.map((s) => [s.name, s.start, s.ende, STATIONEN.indexOf(s.station), s.tok, s.modell, s.fehler ? 1 : 0, s.limit ? 1 : 0]),
  });
}
ausgabe.sort((a, b) => b.ende - a.ende);

// ---------- 6. Kennzahlen ----------
const tage = [];
for (let i = TAGE; i >= 0; i--) tage.push(berlinTag(JETZT - i * 864e5));
const imFenster = (t, von, bis) => t >= von && t < bis;
const W1 = [JETZT - 7 * 864e5, JETZT + 1], W0 = [JETZT - 14 * 864e5, JETZT - 7 * 864e5];
const ARTEN = ['produkt', 'werkzeug', 'alle'];
const passt = (art, x) => art === 'alle' || x.art === art;
const prArtVon = (p) => prArt(p.nr);
const kennzahl = {
  auftragMerge: (fen, art) => ausgabe.filter((p) => p.fertig && p.haeppchenGemergt > 0 && passt(art, p) && imFenster(p.ende, ...fen)).map((p) => p.gesamt),
  jeHaeppchen: (fen, art) => haeppchenAlle.filter((h) => passt(art, h) && imFenster(h.ende, ...fen)).map((h) => h.dauer),
  prsProTag: (fen, art) => { const n = Object.values(G.pr).filter((p) => p.gemergt && imFenster(ms(p.gemergt), ...fen) && (art === 'alle' || prArtVon(p) === art)).length; return [n / ((fen[1] - fen[0]) / 864e5)]; },
  tokens: (fen, art) => ausgabe.filter((p) => p.fertig && p.haeppchenGemergt > 0 && p.tok > 0 && passt(art, p) && imFenster(p.ende, ...fen)).map((p) => p.tok),
  tokensHaeppchen: (fen, art) => haeppchenAlle.filter((h) => h.sitz > 0 && passt(art, h) && imFenster(h.ende, ...fen)).map((h) => h.tok),
  nachbesserung: (fen, art) => haeppchenAlle.filter((h) => h.sitz > 0 && passt(art, h) && imFenster(h.ende, ...fen)).map((h) => h.ruecklauf),
  ohneHalt: (fen, art) => ausgabe.filter((p) => p.fertig && p.haeppchenGemergt > 0 && passt(art, p) && imFenster(p.ende, ...fen)).map((p) => (p.mitHalt ? 0 : 1)),
};
const fenster = (f, agg, art) => { const a = f(W1, art), b = f(W0, art); return { jetzt: agg(a), vorher: agg(b), n: a.length, nVorher: b.length }; };
const tagWerte = (f, agg, art) => tage.map((tag) => {
  // Tagesgrenzen in Berlin: grob über UTC-Mitternacht ± Offset bestimmen
  const von = Date.parse(`${tag}T00:00:00Z`) - (isSommer(tag) ? 2 : 1) * 3600e3;
  const bis = von + 864e5;
  const a = f([von, bis], art); return { tag, wert: agg(a), n: a.length };
});
function isSommer(tag) { const o = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' }).formatToParts(new Date(`${tag}T12:00:00Z`)).find((p) => p.type === 'timeZoneName').value; return o === 'GMT+2'; }
const KENN = [
  { id: 'auftragMerge', titel: 'Zeit vom Auftrag bis zum Merge', einheit: 'min', f: kennzahl.auftragMerge, agg: median, ziel: 120, besser: 'kleiner', aggName: 'Median je Paket',
    def: 'Start: die Paketsteuerung startet die Kette zum ersten Mal. Ende: das letzte Häppchen des Pakets ist gemergt. Halt-Zeiten und Warten auf einen Platz zählen mit. Nur Pakete, die fertig geworden sind.' },
  { id: 'jeHaeppchen', titel: 'Zeit je Häppchen (PR)', einheit: 'min', f: kennzahl.jeHaeppchen, agg: median, ziel: null, besser: 'kleiner', aggName: 'Median je Häppchen',
    def: 'Start: die erste Bau-Sitzung des Häppchens beginnt. Ende: sein PR ist gemergt. Rückläufe, CI-Warten und Halt dazwischen zählen mit.' },
  { id: 'prsProTag', titel: 'Gemergte PRs pro Tag', einheit: 'zahl', f: kennzahl.prsProTag, agg: (a) => a[0] ?? null, ziel: null, besser: 'groesser', aggName: 'Durchschnitt je Tag',
    def: 'Alle PRs in sundartha/hermes, die auf master gemergt wurden (nicht nur Pakete), geteilt durch die Zahl der Tage im Zeitraum.' },
  { id: 'tokens', titel: 'Tokens je Paket', einheit: 'tok', f: kennzahl.tokens, agg: median, ziel: 3e6, besser: 'kleiner', aggName: 'Median je Paket',
    def: 'Gewichtete Tokens aller Sitzungen der Kette des Pakets, Wiederholungen eingeschlossen: Bau, Rücklauf, Prüfer. Gewicht je Token: Eingabe ×1, Cache schreiben ×1,25, Cache lesen ×0,1, Ausgabe ×5 (dieselben Gewichte wie im Bericht „Stand des Bausystems“, Quelle messung/messen.py). Nur fertige Pakete mit Sitzungsprotokoll (vor dem 8.11. wurde der Verbrauch noch nicht aufgezeichnet). In der Lage vom 10.11. gilt das Ziel von 3 Mio. je Häppchen, hier ist es auf das Paket angewandt (siehe Zusatzzeile).' },
  { id: 'nachbesserung', titel: 'Nachbesserungen je Häppchen', einheit: 'zahl', f: kennzahl.nachbesserung, agg: mittel, ziel: 0.1, besser: 'kleiner', aggName: 'Mittelwert je Häppchen',
    def: 'Zahl der Rücklauf-Sitzungen (Bau bessert nach roter CI oder FAIL-Urteil nach), geteilt durch die gemergten Häppchen mit Sitzungsprotokoll. Konflikt-Rebases (ebenfalls Rücklauf-Sitzungen) zählen mit; Bewertungen nicht.' },
  { id: 'ohneHalt', titel: 'Pakete ohne Halt', einheit: 'prozent', f: kennzahl.ohneHalt, agg: (a) => (a.length ? (100 * a.reduce((x, y) => x + y, 0)) / a.length : null), ziel: null, besser: 'groesser', aggName: 'Anteil der fertigen Pakete',
    def: 'Anteil der fertig gewordenen Pakete, deren Kette vom Start bis zum Merge nie neu gestartet werden musste (also ohne Halt).' },
].map((k) => ({
  id: k.id, titel: k.titel, einheit: k.einheit, ziel: k.ziel, besser: k.besser, aggName: k.aggName, def: k.def,
  a: Object.fromEntries(ARTEN.map((art) => [art, {
    ...fenster(k.f, k.agg, art),
    zusatz: k.id === 'tokens' ? { text: 'je Häppchen', wert: median(kennzahl.tokensHaeppchen(W1, art)), n: kennzahl.tokensHaeppchen(W1, art).length } : null,
    tage: tagWerte(k.f, k.agg, art),
  }])),
}));
// Mittelwerte der Dauern in Millisekunden -> Minuten
for (const k of KENN) if (k.einheit === 'min') {
  const z = (v) => (v == null ? null : v / 60e3);
  for (const a of Object.values(k.a)) { a.jetzt = z(a.jetzt); a.vorher = z(a.vorher); a.tage.forEach((t) => { t.wert = z(t.wert); }); }
}
// Wo geht die Zeit hin: letzte 7 Tage, je Art
const zeitJeArt = Object.fromEntries(ARTEN.map((art) => [art, { summe: Object.fromEntries(STATIONEN.map((s) => [s, 0])), tok: Object.fromEntries(STATIONEN.map((s) => [s, 0])), pakete: 0, haltOffenMin: 0, haltOffenNr: new Set() }]));
for (const p of ausgabe) {
  const ziele = ['alle', ...(p.art === 'produkt' || p.art === 'werkzeug' ? [p.art] : [])].map((x) => zeitJeArt[x]);
  const dabei = new Set();
  for (const [s, e, a, , tok] of p.seg) {
    const von = Math.max(s, W1[0]), bis = Math.min(e, JETZT);
    if (STATIONEN[a] === 'halt' && p.status === 'angehalten' && e >= p.ende - 1000) { if (bis > von) for (const z of ziele) { z.haltOffenMin += (bis - von) / 60e3; z.haltOffenNr.add(p.nr); } continue; } // Halt ohne Neustart (steht noch): getrennt ausweisen
    if (bis > von) for (const z of ziele) { z.summe[STATIONEN[a]] += (bis - von) / 60e3; dabei.add(z); if (tok) z.tok[STATIONEN[a]] += tok * ((bis - von) / (e - s)); }
  }
  for (const z of dabei) z.pakete++;
}
const zeitAus = Object.fromEntries(ARTEN.map((art) => { const z = zeitJeArt[art]; return [art, { summe: z.summe, tok: z.tok, pakete: z.pakete, haltOffenMin: z.haltOffenMin, haltOffenPakete: z.haltOffenNr.size }]; }));

// ---------- Verbrauch je Tag und Konto: alle Ketten, auch nicht fertige, alle Sitzungen mit Wiederholungen ----------
const verbrauch = (() => {
  const je = {}; // tag -> konto -> {tok, usd, sitz}
  const proKette = []; // { nr, tok, sitzungen: [{tag, konto, tok, usd}] }
  for (const e of fs.readdirSync(ROH)) {
    if (!/^paket-\d+$/.test(e)) continue;
    const ss = [];
    for (const z of zeilen(path.join(ROH, e, 'verbrauch.jsonl'))) {
      let o; try { o = JSON.parse(z); } catch { continue; }
      if (!o.sitzung || !o.ende) continue;
      ss.push({ tag: berlinTag(o.ende * 1000), konto: String(o.konto || '?'), tok: gewichtet(o), usd: o.kosten_usd || 0 });
    }
    proKette.push({ nr: +e.slice(6), tok: ss.reduce((a, x) => a + x.tok, 0), ss });
  }
  const tageV = tage.slice(-8);
  const kontenV = new Set();
  const klein = {}; // tag -> Tokens in Ketten mit höchstens 3 Mio (Summe der ganzen Kette)
  for (const k of proKette) for (const x of k.ss) {
    if (!tageV.includes(x.tag)) continue;
    kontenV.add(x.konto);
    const t = ((je[x.tag] ||= {})[x.konto] ||= { tok: 0, usd: 0, sitzungen: 0 });
    t.tok += x.tok; t.usd += x.usd; t.sitzungen++;
    const g = (klein[x.tag] ||= { gesamt: 0, bisZiel: 0 });
    g.gesamt += x.tok; if (k.tok <= 3e6) g.bisZiel += x.tok;
  }
  return { konten: [...kontenV].sort(), tage: tageV.map((tag) => ({ tag, konten: je[tag] || {}, anteilBis3Mio: klein[tag]?.gesamt ? klein[tag].bisZiel / klein[tag].gesamt : null })), gewicht: GEW };
})();

const daten = {
  erzeugt: JETZT, erzeugtIso: iso(JETZT), repo: REPO, stationen: STATIONEN, namen: NAMEN,
  kennzahlen: KENN, tage, verbrauch,
  zeit: { ...zeitAus, von: W1[0] },
  arten: { zaehlung: Object.fromEntries(['produkt', 'werkzeug', 'offen'].map((x) => [x, ausgabe.filter((p) => p.art === x).length])), vorlaeufig: ausgabe.filter((p) => p.artQuelle === 'vorlaeufig').length, abweichungAlteRegel: ausgabe.filter((p) => p.artQuelle === 'pr' && p.artAlt !== p.art).map((p) => p.nr), dateienGelesen: Object.keys(G.dat || {}).length },
  pakete: ausgabe.slice(0, 120),
  quellen: {
    gh: { stand: G.stand || null, fehler: ghStat.fehler, abfragen: ghStat.abfragen, pr: Object.keys(G.pr).length, runs: Object.keys(G.runs).length },
    lokal: { dateien: nGesichert, tmpDa, ketten: [...laufend] },
  },
  dauerSek: 0,
};
daten.dauerSek = Math.round((Date.now() - t0) / 100) / 10;

// ---------- 7. Seite schreiben ----------
const vorlage = fs.readFileSync(path.join(HIER, 'vorlage.html'), 'utf8');
const json = JSON.stringify(daten).replace(/</g, '\\u003c').split(String.fromCharCode(8232)).join('').split(String.fromCharCode(8233)).join('');
const html = vorlage.replace('/*DATEN*/null', () => json);
fs.mkdirSync(path.dirname(AUS), { recursive: true });
fs.writeFileSync(AUS + '.tmp', html); fs.renameSync(AUS + '.tmp', AUS);
fs.writeFileSync(path.join(ZUSTAND, 'kennzahlen.json'), JSON.stringify(daten));
console.log(`Kennzahlen: ${ausgabe.length} Pakete, ${ghStat.abfragen} GitHub-Abfragen, ${daten.dauerSek} s${ghStat.fehler.length ? ' | Hinweise: ' + ghStat.fehler.join('; ') : ''} -> ${AUS}`);
