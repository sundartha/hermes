#!/usr/bin/env node
// GitHub-Wache: modellfrei. Fragt GitHub alle ~60 s (bedingte Abfragen, 304 kostet nichts) und
// weckt sundartha-engineering NUR bei einem neuen Anlass. Entdoppelt ueber state.json.
// Nutzung: node github-wache.mjs [--einmal] [--trocken]
// WECKFILTER-1116 (Antonio: „Kleinkram soll nicht wecken“): Geweckt wird nur, wenn eine Handlung des Agenten noetig sein kann
// (Mensch schreibt; PR rot oder aus der Warteschlange gefallen, ohne dass eine Kette dran ist). Alles andere wird gemerkt, im
// Protokoll weckfilter.jsonl festgehalten und dem naechsten echten Weckruf als kurze Zeilen mitgegeben.
// Probe ohne GitHub, ohne Wecken, ohne Schreiben: WACHE_PROBE_ANLAESSE=<Datei> node github-wache.mjs
//   (eine Meldung je Zeile, Runden durch eine Zeile --- getrennt; WACHE_LAGE_BIN / WACHE_LAGE_CACHE ersetzen die Kettenauskunft)
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
const ex = promisify(execFile);
const appToken = () => { try { return execFileSync('/Users/antonio/Claude/Projects/Agentic Calling MCP/pakete-prompts/app-token.sh', { encoding: 'utf8' }).trim() || process.env.GH_TOKEN; } catch { return process.env.GH_TOKEN; } };   // 45 Minuten zwischengespeichert; ohne App-Token bleibt das bisherige Konto

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, 'state.json');
const LOG = path.join(DIR, 'wache.log');
const PRS = '/Users/antonio/Bereiche/sundartha/engineering/beobachtete-prs.txt';
const REPOS = ['sundartha/hermes'];            // Antonios Fork-Repos sind nicht Teil der Sundartha-Repos
const ICH = ['Antonio20045'];                  // eigene Kommentare wecken nicht (Ausnahme: Marker)
const EIGENE_BOTS = ['sundartha-agent[bot]'];   // Kommentare des Engineers selbst wecken nie (Selbstweck-Schleife, 06.11.)
const TEST_MARKER = '[wache-test]';
const INTERVALL = 60_000;                       // Abfrage bleibt minuetlich (304 kostet nichts) ...
const WECK_ABSTAND = 30 * 60_000;               // ... geweckt wird gebuendelt hoechstens alle 30 min (Antonio, 06.11.)
const SITZUNG = 'agent:sundartha-engineering:wache'; // eigene Sitzung, nicht Antonios Chat (Antonio, 06.11.)
const LAGE_BIN = process.env.WACHE_LAGE_BIN || '/Users/antonio/Bereiche/openclaw/lage/lage';                      // WECKFILTER-1116: die eine Auskunft ueber Ketten
const LAGE_CACHE = process.env.WACHE_LAGE_CACHE || '/Users/antonio/Bereiche/openclaw/lage/cache/ketten.json';
const FILTER_LOG = process.env.WECKFILTER_LOG || '/Users/antonio/Bereiche/openclaw/lage/weckfilter.jsonl';        // je nicht weckender Meldung eine Zeile
const OPENCLAW_BIN = process.env.WACHE_OPENCLAW_BIN || '/Users/antonio/.openclaw/bin/openclaw';                   // WECKFILTER-1116: nur fuer die Pruefung des Fehlerwegs ersetzbar
const STILLE_BOTS = /^(?:github-actions|dependabot)\[bot\]$/;   // WECKFILTER-1116: bekannte Automaten ohne Auftrag; jeder andere fremde Bot weckt (lieber wecken als schweigen)
const SICHERHEIT = 'github-advanced-security[bot]';             // WECKFILTER-1116: CodeQL-Alarm am PR: weckt, ausser eine Kette arbeitet an diesem PR
const PROBE = process.env.WACHE_PROBE_ANLAESSE || '';                                                              // Probeschalter, siehe Kopf
const eigen = (wer, body) => (ICH.includes(wer) && !(body || '').includes(TEST_MARKER)) || EIGENE_BOTS.includes(wer);
const argv = process.argv.slice(2);
const TROCKEN = argv.includes('--trocken') || !!PROBE, EINMAL = argv.includes('--einmal') || !!PROBE;
const log = (m) => (PROBE ? console.log(`[log] ${m}`) : fs.appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`));
let st = { seen: {}, etag: {}, baseline: false, pr: {} };
try { st = { ...st, ...JSON.parse(fs.readFileSync(STATE, 'utf8')) }; } catch {}
if (PROBE) st = { ...st, baseline: true, puffer: [], gemerkt: null, letztesWecken: 0 };   // Probe: echter Puffer und Merker bleiben unberuehrt
const probeRunden = PROBE ? fs.readFileSync(PROBE, 'utf8').split(/^---\s*$/m).map((t) => t.split('\n').map((z) => z.trim()).filter(Boolean)) : [];
const save = () => { if (PROBE) return; fs.writeFileSync(`${STATE}.neu`, JSON.stringify(st), { mode: 0o600 }); fs.renameSync(`${STATE}.neu`, STATE); };   // WECKFILTER-1116 (Gegenlesung): atomar, ein Abbruch mitten im Schreiben laesst die alte Datei heil

// gh api mit ETag; liefert {status, body}
async function api(url, etagKey) {
  const args = ['api', '-i', url];
  if (etagKey && st.etag[etagKey]) args.push('-H', `If-None-Match: ${st.etag[etagKey]}`);
  let out;
  try { out = (await ex('gh', args, { maxBuffer: 32e6, env: url.startsWith('notifications') ? process.env : { ...process.env, GH_TOKEN: appToken() } })).stdout; }   // 17.11.: Lesen ueber die App (15.000/h), das Nutzerkonto (5.000/h) teilen sich Ketten und Werkzeuge
  catch (e) { out = e.stdout || ''; if (!/^HTTP\/[\d.]+ 304/.test(out)) throw new Error((e.stderr || e.message).slice(0, 200)); }
  const [head, ...rest] = out.split(/\r?\n\r?\n/);
  const status = +head.match(/^HTTP\/[\d.]+ (\d+)/)[1];
  const et = head.match(/^etag:\s*(.+)$/im);
  if (etagKey && et) st.etag[etagKey] = et[1].trim();
  return { status, body: status === 304 ? null : JSON.parse(rest.join('\n\n') || 'null') };
}
const neu = (key) => { if (st.seen[key]) return false; st.seen[key] = Date.now(); return true; };

async function sammeln() {
  if (PROBE) return probeRunden.shift() ?? [];
  const a = [];
  const seit = new Date(Date.now() - 3 * 3600e3).toISOString();
  for (const r of REPOS) {
    // Kommentare an Issues/PRs, Review-Kommentare, Reviews (ueber Events), neue Issues
    const offenePRs = (await api(`repos/${r}/pulls?state=open&per_page=100`)).body || [];   // WECKFILTER-1116 (Gegenlesung): dieselbe eine Abfrage wie bisher, nur frueher – liefert auch den Zweig je PR
    const zw = (n) => { const z = offenePRs.find((p) => String(p.number) === String(n))?.head?.ref; return z ? ` [${z}]` : ''; };
    const c = await api(`repos/${r}/issues/comments?sort=updated&direction=desc&per_page=30&since=${seit}`, `c:${r}`);
    for (const x of c.body || []) {
      const wer = x.user?.login;
      if (eigen(wer, x.body)) { neu(`ic:${x.id}:${x.updated_at}`); continue; }
      if (x.user?.type === 'Bot' && /github-actions|dependabot/.test(wer)) { neu(`ic:${x.id}:${x.updated_at}`); continue; }
      const nr = x.issue_url.split('/').pop();
      if (neu(`ic:${x.id}:${x.updated_at}`)) a.push(`Kommentar von ${wer} an #${nr}: ${x.body.replace(/\s+/g, ' ').slice(0, 300)} (${x.html_url})`);
    }
    const rc = await api(`repos/${r}/pulls/comments?sort=updated&direction=desc&per_page=30&since=${seit}`, `rc:${r}`);
    for (const x of rc.body || []) {
      if (eigen(x.user?.login, x.body)) { neu(`rc:${x.id}:${x.updated_at}`); continue; }
      if (neu(`rc:${x.id}:${x.updated_at}`)) a.push(`Review-Kommentar von ${x.user?.login} an PR #${x.pull_request_url.split('/').pop()}${zw(x.pull_request_url.split('/').pop())}: ${x.body.replace(/\s+/g, ' ').slice(0, 300)} (${x.html_url})`);
    }
    const is = await api(`repos/${r}/issues?state=open&sort=created&direction=desc&per_page=20`, `i:${r}`);
    for (const x of is.body || []) {
      if (x.pull_request) continue;
      if (neu(`is:${x.id}`)) a.push(`Neues Issue #${x.number} von ${x.user?.login}: ${x.title} (${x.html_url})`);
    }
    // Reviews und CI-Ergebnis je beobachtetem PR
    const liste = fs.existsSync(PRS) ? fs.readFileSync(PRS, 'utf8').split(/\s+/).filter((n) => /^\d+$/.test(n)) : [];
    // Jeder offene paket/-PR wird beobachtet, ohne dass ihn jemand von Hand eintragen muss
    const offenePakete = offenePRs   // WECKFILTER-1116: Liste von oben
      .filter((p) => p.head?.ref?.startsWith('paket/')).map((p) => String(p.number));
    const nums = [...new Set([...liste, ...offenePakete])];
    for (const n of nums) {
      const rv = await api(`repos/${r}/pulls/${n}/reviews?per_page=30`, `rv:${r}:${n}`);
      for (const x of rv.body || []) {
        if (eigen(x.user?.login, x.body)) { neu(`rv:${x.id}`); continue; }
        if (neu(`rv:${x.id}`)) a.push(`Review (${x.state}) von ${x.user?.login} an PR #${n}${zw(n)}: ${(x.body || '').replace(/\s+/g, ' ').slice(0, 300)} (${x.html_url})`);
      }
      const pr = (await api(`repos/${r}/pulls/${n}`)).body;
      if (!pr) continue;
      const cr = (await api(`repos/${r}/commits/${pr.head.sha}/check-runs?per_page=100`)).body?.check_runs || [];
      const offen = cr.filter((c) => c.status !== 'completed').length;
      const rot = cr.filter((c) => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(c.conclusion));
      const zustand = pr.merged ? 'gemergt' : pr.state === 'closed' ? 'geschlossen' : rot.length ? 'rot' : (cr.length && !offen) ? 'gruen' : 'laeuft';
      if (zustand === 'geschlossen') {
        // Steuerprogramm P25 eroeffnet PRs unter der App neu und schreibt „Ersetzt durch #N“: Nummer in der Liste nachziehen
        const kom = (await api(`repos/${r}/issues/${n}/comments?per_page=50`)).body || [];
        const m = kom.map((k) => (k.body || '').match(/Ersetzt durch #(\d+)/)).find(Boolean);
        if (m && !nums.includes(m[1])) {
          const liste = fs.readFileSync(PRS, 'utf8').split(/\s+/).filter(Boolean).map((x) => (x === n ? m[1] : x));
          fs.writeFileSync(PRS, liste.join('\n') + '\n');
          log(`Liste: #${n} ersetzt durch #${m[1]}`);
        }
      }
      // Merge-Warteschlange: Ihre Laeufe haengen nicht am PR-Kopf, ein Rauswurf zeigt sich nur in der Zeitleiste
      if (!pr.merged && pr.state === 'open') {
        const tl = (await api(`repos/${r}/issues/${n}/timeline?per_page=100`)).body || [];
        for (const e of tl.filter((x) => x.event === 'removed_from_merge_queue')) {
          if (neu(`mq:${n}:${e.id || e.created_at}`)) a.push(`PR #${n} [${pr.head.ref}] ist aus der Merge-Warteschlange gefallen (${e.created_at}, Grund: ${e.reason || 'unbekannt'}) (${pr.html_url})`);
        }
      }
      if (zustand !== 'laeuft' && neu(`pr:${n}:${pr.head.sha}:${zustand}`))
        a.push(`PR #${n} [${pr.head.ref}]: ${zustand}${rot.length ? ' (' + rot.map((c) => c.name).slice(0, 5).join(', ') + ')' : ''} (${pr.html_url})`);
    }
  }
  // Erwaehnungen / Zuweisungen aus der Benachrichtigungsliste (ungelesen)
  const nt = await api('notifications?per_page=30', 'n');
  for (const x of nt.body || []) {
    if (!REPOS.includes(x.repository.full_name) || !['mention', 'assign', 'review_requested', 'team_mention'].includes(x.reason)) continue;
    // updated_at des Threads springt bei jeder PR-Aenderung; gemeldet wird nur ein neuer Grund je Thread (Befund 27)
    if (neu(`n:${x.id}:${x.reason}`)) a.push(`${x.reason}: ${x.subject.title} (${x.subject.url.replace('api.github.com/repos', 'github.com').replace('/pulls/', '/pull/')})`);
  }
  return a;
}

// ---------- WECKFILTER-1116 ----------
// Kettenstand aus lage: Liste der Ketten, oder null = unbekannt (lage antwortet nicht und der Zwischenspeicher ist aelter als 15 min, oder lage hatte kein GitHub).
async function kettenstand() {
  const cache = (maxAlter) => { try { return Date.now() - fs.statSync(LAGE_CACHE).mtimeMs < maxAlter ? JSON.parse(fs.readFileSync(LAGE_CACHE, 'utf8')) : null; } catch { return null; } };
  let j = cache(60_000);
  if (!j) {
    let uhr;   // Gegenlesung: harte Grenze – SIGKILL nach 20 s; spaetestens nach 25 s geht die Runde weiter, auch wenn ein Kindprozess von lage die Leitung offen haelt
    try {
      const lauf = ex(LAGE_BIN, ['ketten', '--json', '--alle'], { timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 16e6 });
      lauf.catch(() => {});
      j = JSON.parse((await Promise.race([lauf, new Promise((_, nein) => { uhr = setTimeout(() => nein(new Error('lage: Zeitgrenze')), 25_000); })])).stdout);
    } catch { j = cache(15 * 60_000); }
    clearTimeout(uhr);
  }
  return Array.isArray(j?.ketten) && j.github_ok !== false ? j.ketten : null;
}
// Kein Auftrag: der eigene Bot, bekannte Automaten (github-actions, dependabot) und Antonios Name (unter ihm schreiben die Agenten; Ausnahme wie bisher: Marker).
// Gegenlesung: NICHT mehr pauschal jedes Konto auf [bot] – ein unbekannter Bot weckt, die Sicherheitsmeldung (CodeQL) folgt der Kettenregel.
const keinMensch = (wer, text) => EIGENE_BOTS.includes(wer) || STILLE_BOTS.test(wer) || (ICH.includes(wer) && !text.includes(TEST_MARKER));
const AUTOR = /^(?:Kommentar|Review-Kommentar|Review \(\w+\)) von ([\w-]+(?:\[bot\])?) an |^Neues Issue #\d+ von ([\w-]+(?:\[bot\])?): /;
const PR_FRAGE = /^PR #(\d+)(?: \[([^\]]*)\])?(?:: rot| ist aus der Merge-Warteschlange gefallen)/;
const brauchtKetten = (x) => PR_FRAGE.test(x) || x.includes(` von ${SICHERHEIT} an `);
// Kette zu einem PR: am Zweig (paket/<Nummer>-… oder system/<Nummer>-…), ohne solchen Zweig ueber die PR-Nummer in lage. kuemmert = „arbeitet“, oder „wartet“ ohne Team-Entscheidung (wie in lage.py).
function ketteAmPr(n, zweig, ketten) {
  const nr = /^(?:paket|system)\/(\d+)-/.exec(zweig ?? '')?.[1];
  const k = nr ? ketten.find((e) => String(e.nr) === nr) : ketten.find((e) => String(e.pr_nr) === n || (e.wartet_auf === `PR ${n}` && ['ci', 'merge-queue'].includes(e.bei_wem)));
  if (!k) return { k: null };
  return { k, stand: `Kette #${k.nr} ${k.zustand}: ${String(k.phase ?? '').slice(0, 80)}`, kuemmert: k.zustand === 'arbeitet' || (k.zustand === 'wartet' && k.entschieden !== 'team') };
}
// Ordnet eine Meldung ein: {weckt, grund, zusatz}. ketten = Liste aus lage oder null (unbekannt); zweige = {PR-Nummer: Zweig} nur fuer alte Meldungen ohne Zweig im Text.
export function einordnen(a, ketten, zweige = {}) {
  let m;
  if ((m = AUTOR.exec(a))) {
    const wer = m[1] || m[2];
    if (wer === SICHERHEIT) {   // Gegenlesung: CodeQL-Alarm weckt, ausser eine Kette arbeitet an genau diesem PR (z. B. PR eines Menschen, Zweig ohne Kette, Kette haengt)
      const p = / an (?:PR )?#(\d+)(?: \[([^\]]*)\])?: /.exec(a);
      if (!ketten || !p) return { weckt: true, grund: 'Sicherheitsmeldung (CodeQL), Kettenstand unbekannt', zusatz: ' [Kettenstand unbekannt]' };
      const { k, stand, kuemmert } = ketteAmPr(p[1], p[2] ?? zweige[p[1]], ketten);
      if (!k) return { weckt: true, grund: 'Sicherheitsmeldung (CodeQL) an einem PR ohne Kette laut lage', zusatz: ' [keine Kette laut lage]' };
      return kuemmert ? { weckt: false, grund: `Sicherheitsmeldung (CodeQL) an einem PR, an dem die Kette arbeitet: ${stand}` }
        : { weckt: true, grund: `Sicherheitsmeldung (CodeQL), ${stand} (niemand kuemmert sich)`, zusatz: ` [${stand}]` };
    }
    if (keinMensch(wer, a)) return { weckt: false, grund: `${wer} ist kein Mensch (eigener Bot, bekannter Automat oder Name, unter dem die Agenten schreiben)` };
    if (/\[bot\]$/.test(wer)) return { weckt: true, grund: `unbekannter Bot (${wer}): lieber wecken` };
    return { weckt: true, grund: `von einem Menschen (${wer})` };
  }
  if (/^review_requested: /.test(a)) return { weckt: false, grund: 'Review-Anfrage an Antonios Namen, kein Auftrag an den Agenten' };
  if (/^(mention|assign|team_mention): /.test(a)) return { weckt: true, grund: 'Erwaehnung oder Zuweisung' };
  if ((m = PR_FRAGE.exec(a))) {
    if (!ketten) return { weckt: true, grund: 'Kettenstand unbekannt (lage nicht erreichbar)', zusatz: ' [Kettenstand unbekannt]' };
    const { k, stand, kuemmert } = ketteAmPr(m[1], m[2] ?? zweige[m[1]], ketten);
    if (!k) return { weckt: true, grund: 'keine Kette zu diesem PR laut lage', zusatz: ' [keine Kette laut lage]' };
    return kuemmert ? { weckt: false, grund: `${stand} (die Kette kuemmert sich selbst)` } : { weckt: true, grund: `${stand} (niemand kuemmert sich)`, zusatz: ` [${stand}]` };
  }
  if (/^PR #\d+(?: \[[^\]]*\])?: (?:gruen|gemergt|geschlossen)/.test(a)) return { weckt: false, grund: 'PR gruen, gemergt oder geschlossen: nichts zu tun' };
  return { weckt: true, grund: 'unbekannte Meldungsart: lieber wecken' };
}
function protokoll(anlass, grund, weckruf) {
  const z = JSON.stringify({ zeit: new Date().toISOString(), quelle: 'github-wache', anlass, grund, weckruf });
  if (PROBE) return console.log(`[weckfilter] ${z}`);
  try { fs.appendFileSync(FILTER_LOG, z + '\n'); } catch (e) { log(`Weckfilter-Protokoll nicht schreibbar: ${e.message}`); }
}
// Gegenlesung: Das Protokoll bleibt klein – ab 5.500 Zeilen auf die letzten 5.000 gekuerzt (atomar: neue Datei, dann umbenennen).
function protokollKuerzen(datei = FILTER_LOG, max = 5000) {
  try {
    if (fs.statSync(datei).size < max * 60) return;   // so klein kann die Datei mit max Zeilen nicht sein: gar nicht erst lesen
    const z = fs.readFileSync(datei, 'utf8').split('\n').filter(Boolean);
    if (z.length < max * 1.1) return;
    fs.writeFileSync(`${datei}.neu-${process.pid}`, z.slice(-max).join('\n') + '\n'); fs.renameSync(`${datei}.neu-${process.pid}`, datei);
  } catch { /* Kuerzen ist nie ein Grund, die Wache anzuhalten */ }
}

// anlaesse: was eine Handlung brauchen kann; g: {n, zeilen} seit dem letzten Wecken Gemerktes ohne Handlungsbedarf; unbekannt: Kettenstand war nicht zu bekommen; roh: dieselben Anlaesse ohne Zusatz (fuer den Fehlerweg)
function wecken(anlaesse, g = { n: 0, zeilen: [] }, unbekannt = false, roh = anlaesse) {
  const neben = g.n ? `\n\nSeit dem letzten Wecken außerdem, ohne Handlungsbedarf (nur zur Kenntnis):\n- ${g.zeilen.map((z) => (z.length > 200 ? z.slice(0, 199) + '…' : z)).join('\n- ')}${g.n > g.zeilen.length ? `\n- und ${g.n - g.zeilen.length} weitere` : ''}` : '';
  const text = `Wache GitHub (gebündelt, höchstens alle 30 min, ${new Date().toLocaleTimeString('de-DE')}): ${anlaesse.length} Meldung(en) in den Sundartha-Repos, bei denen eine Handlung von dir nötig sein kann:\n- ${anlaesse.join('\n- ')}${unbekannt ? '\n\nDer Kettenstand war beim Wecken unbekannt (lage nicht erreichbar oder Zwischenspeicher älter als 15 min). Die PR-Meldungen sind deshalb ungefiltert: Sieh zuerst nach, ob eine Kette den PR schon bearbeitet.' : ''}\n\nDies ist die eigene Wache-Sitzung, nicht Antonios Chat. Das ist dein Stück: Ist ein PR rot, aus der Warteschlange gefallen oder trägt er eine Sicherheitsmeldung (CodeQL), finde die Ursache am Stand (PR, CI-Lauf, Kette) und behebe sie. Schreibt ein Mensch, lies seinen ganzen Text am Ort (oben steht nur der Anfang) und erledige oder beantworte dort, was er will. Bring es zu Ende – behoben, oder entschieden und umgesetzt. Du hast dafür Zeit. Du hast Antonios Dauerfreigabe vom 04.11. (AGENTS.md). Erst wenn es erledigt ist oder bei jemand anderem liegt (dann: bei wem, was genau, bis wann du nachsiehst), schreibst du zwei, drei Sätze Ergebnis als Antwort (das System hält sie fest; keine Stand-Datei); Antonio schreibst du von hier aus nichts. Stellst du am Stand fest, dass nichts zu tun ist, sag in einem Satz, woran du das gesehen hast.${neben}`;
  log(`WECKEN (${anlaesse.length}): ${anlaesse.join(' | ')}`);
  if (TROCKEN) return console.log(text);
  const start = Date.now(), ab = (() => { try { return fs.statSync(LOG).size; } catch { return 0; } })();
  const p = spawn(OPENCLAW_BIN, ['agent', '--agent', 'sundartha-engineering', '--session-key', SITZUNG, '--timeout', '1800', '-m', text],
    { detached: true, stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')] });
  // Gegenlesung: Scheitert das Wecken sofort (Programm fehlt, Gateway/Agent nicht erreichbar: Ende mit Fehler in unter 2 min und ohne „accepted run“ in der Ausgabe),
  // gehen die Anlaesse zurueck in den Puffer: 2 Versuche nach je 5 min, 3 weitere im 30-Minuten-Takt; nach dem 6. Fehlschlag bleiben sie als Nebenzeile gemerkt und stehen im Protokoll.
  // Ein Zeitablauf nach angenommenem Lauf („accepted run“) gilt NICHT als gescheitert – sonst wuerde doppelt geweckt.
  let erledigt = false;
  const zurueck = (warum) => {
    if (erledigt) return; erledigt = true;
    const versuch = (st.weckFehl = (st.weckFehl || 0) + 1), alt = st.gemerkt || { n: 0, zeilen: [] };
    if (versuch < 6) {
      st.puffer = [...new Set([...roh, ...(st.puffer || [])])];
      st.gemerkt = { n: g.n + alt.n, zeilen: [...g.zeilen, ...alt.zeilen].slice(-6) };
      if (versuch <= 2) st.letztesWecken = Date.now() - WECK_ABSTAND + 5 * 60_000;
      log(`WECKEN GESCHEITERT (${warum}), Fehlschlag ${versuch} von 6: ${roh.length} Meldung(en) zurueck im Puffer, naechster Versuch in ${versuch <= 2 ? 5 : 30} min`);
    } else {
      st.weckFehl = 0;
      st.gemerkt = { n: g.n + alt.n + roh.length, zeilen: [...g.zeilen, ...alt.zeilen, ...roh].slice(-6) };
      for (const x of roh) protokoll(x, `Wecken sechsmal gescheitert (${warum})`, 'scheiterte; geht als Nebenzeile mit dem naechsten Weckruf');
      log(`WECKEN ENDGUELTIG GESCHEITERT (${warum}): ${roh.length} Meldung(en) bleiben als Nebenzeile gemerkt: ${roh.join(' | ')}`);
    }
    try { save(); } catch (e) { log(`FEHLER ${e.message}`); }
  };
  p.on('error', (e) => zurueck(`Start: ${e.message}`));
  p.on('exit', (code, signal) => {
    const dauer = Date.now() - start;
    let aus = '';
    try { const fd = fs.openSync(LOG, 'r'), b = Buffer.alloc(Math.min(20_000, Math.max(0, fs.statSync(LOG).size - ab))); fs.readSync(fd, b, 0, b.length, ab); fs.closeSync(fd); aus = b.toString('utf8'); } catch { /* Ausgabe nicht lesbar */ }
    if (code !== 0 && dauer < 120_000 && !/accepted run/.test(aus)) zurueck(`Ende ${code ?? signal} nach ${Math.round(dauer / 1000)} s`);
    else if (!erledigt) { erledigt = true; if (st.weckFehl) { st.weckFehl = 0; try { save(); } catch { /* naechste Runde speichert */ } } }
  });
  p.unref();
}

let rundeSeit = 0;   // Gegenlesung: Eine Runde, die laenger als 60 s braucht (viele PRs, lage langsam), laeuft nicht doppelt; nach 10 min gilt sie als verloren
async function runde() {
  if (rundeSeit && Date.now() - rundeSeit < 10 * 60_000) return log('Runde ausgelassen: die vorige laeuft noch');
  const ich = (rundeSeit = Date.now());
  try {
    const a = await sammeln();
    if (!st.baseline) { st.baseline = true; log(`Baseline gesetzt, ${a.length} Altmeldungen verworfen`); }
    else {
      // Sammeln statt sofort wecken; Puffer liegt in state.json und uebersteht Neustarts
      st.puffer = [...new Set([...(st.puffer || []), ...a])];
      const faellig = Date.now() - (st.letztesWecken || 0) >= WECK_ABSTAND;
      if (st.puffer.length && faellig) {   // WECKFILTER-1116: erst einordnen, dann nur bei echtem Anlass wecken
        const ketten = st.puffer.some(brauchtKetten) ? await kettenstand() : [];
        const e = st.puffer.map((x) => ({ text: x, ...einordnen(x, ketten) }));
        const echt = e.filter((x) => x.weckt), still = e.filter((x) => !x.weckt);
        for (const x of still) protokoll(x.text, x.grund, echt.length ? 'lief wegen anderer Meldung, diese ging als Nebenzeile mit' : 'entfiel');
        if (still.length && !PROBE) protokollKuerzen();
        const g = st.gemerkt || { n: 0, zeilen: [] };
        g.n += still.length; g.zeilen = [...g.zeilen, ...still.map((x) => x.text)].slice(-6);
        if (echt.length) { st.gemerkt = null; st.letztesWecken = Date.now(); st.puffer = []; wecken(echt.map((x) => x.text + (x.zusatz || '')), g, ketten === null, echt.map((x) => x.text)); }
        else { st.gemerkt = g; log(`NICHT GEWECKT: ${still.length} Meldung(en) ohne Handlungsbedarf gemerkt (seit dem letzten Wecken ${g.n}): ${still.map((x) => x.text).join(' | ')}`); }
        st.puffer = [];
      }
      else if (a.length) log(`gepuffert: ${a.length} neu, ${st.puffer.length} wartend`);
    }
    for (const k of Object.keys(st.seen)) if (Date.now() - st.seen[k] > 14 * 864e5) delete st.seen[k];
    save();
  } catch (e) { log(`FEHLER ${e.message}`); }
  finally { if (rundeSeit === ich) rundeSeit = 0; }
}
export const _pruef = { wecken, protokollKuerzen, zustand: () => st };   // nur fuer die Pruefung (WACHE_NUR_LADEN=1)
if (!process.env.WACHE_NUR_LADEN) {   // WACHE_NUR_LADEN=1: nur die Funktionen laden (Nachspiel/Pruefung), nichts abfragen
  await runde();
  while (probeRunden.length) { st.letztesWecken = 0; await runde(); }   // Probe: jede weitere Runde gilt als faellig
  if (!EINMAL) setInterval(runde, INTERVALL);
}
