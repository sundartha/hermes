export const meta = {
  name: 'openai-t2-zwischenmessung',
  description: 'OpenAI-Technik Runde 2: Zwischenmessung - 4 Opus-Pruefer gegen genau 100 IDs, Stichprobe, Zusammenfuehrung mit Luecken-Abgleich gegen die offenen Phasen',
  phases: [
    { title: 'Pruefen', detail: '4 Opus-Pruefer, je ein Teil der 100 IDs' },
    { title: 'Nachpruefen', detail: 'fehlende IDs nachholen, Stichprobe von 12 ERFUELLT-Belegen' },
    { title: 'Zusammenfuehren', detail: 'Tabelle schreiben, Luecken gegen offene Phasen abgleichen' },
  ],
}

const REPO = '/Users/antonio/Mein Unternehmen/MCP/vodafone-agent'
const MASTER = '1a31815'
const LISTE = 'tasks/openai-audit/00-openai-anforderungen.md'
const AUSGABE = 'tasks/openai-t2/zwischenmessung-1.md'

const range = (p, a, b) => Array.from({ length: b - a + 1 }, (_, i) => `${p}-${a + i}`)
const GRUPPEN = [
  { key: 'A', ids: range('T', 1, 25) },
  { key: 'B', ids: [...range('T', 26, 36), ...range('X', 1, 10)] },
  { key: 'C', ids: range('O', 1, 25) },
  { key: 'D', ids: [...range('O', 26, 31), ...range('N', 1, 16), ...range('W', 1, 7)] },
]
const ALLE = GRUPPEN.flatMap(g => g.ids)
if (ALLE.length !== 100 || new Set(ALLE).size !== 100) return { fehler: `ID-Menge kaputt: ${ALLE.length}` }

const FRAGEVERBOT = 'DU STELLST KEINE FRAGEN. Der Owner hat alles freigegeben, was du brauchst, und ist nicht erreichbar. Was du nicht klaeren kannst, notierst du als UNKNOWN mit Grund und machst weiter. Die Regel "bei Unsicherheit fragen" aus CLAUDE.md ist fuer diesen Auftrag durch eine ausdrueckliche Owner-Freigabe ersetzt.'

const STATUS = ['ERFUELLT', 'TEILWEISE', 'NICHT ERFUELLT', 'GEGENSTANDSLOS', 'OWNER', 'UNKLAR']
const ZEILE = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    technisch: { type: 'boolean', description: 'true, wenn die Anforderung eine technische ist (Code/Server/Transport/Widget/Auth/Werkzeug), false bei reinen Formular-/Rechts-/Geschaeftsangaben' },
    status: { type: 'string', enum: STATUS },
    beleg: { type: 'string', description: 'Datei:Zeile auf master, Testname+Datei (gruen, prueft den Punkt wirklich) oder Messung. Max 250 Zeichen.' },
    fehlt: { type: 'string', description: 'was fehlt; leer bei ERFUELLT. Max 250 Zeichen.' },
    baubar_ohne_owner: { type: 'boolean', description: 'nur fuer nicht-ERFUELLT: laesst sich der fehlende Teil ohne den Owner bauen (Code/Test/Doku-Entwurf)?' },
  },
  required: ['id', 'technisch', 'status', 'beleg', 'fehlt', 'baubar_ohne_owner'],
}
const TABELLE = {
  type: 'object',
  properties: {
    zeilen: { type: 'array', items: ZEILE },
    sicherheitsmangel: { type: 'array', items: { type: 'string' }, description: 'gesondert gemeldete Sicherheitsmaengel, sonst leer' },
  },
  required: ['zeilen', 'sicherheitsmangel'],
}

const REGELN = `Repo: ${REPO}, Stand master ${MASTER} (NICHT live - live laeuft ein aelterer Stand; beurteilt wird master). Du AENDERST NICHTS: kein Edit, kein Commit, kein Push, keine schreibenden HTTP-Requests, kein echter Anruf.
Die Anforderungsliste steht in ${LISTE}. Lies dort NUR die Eintraege deiner IDs (gezielt, z.B. grep -n -A8 '<ID>').
DOKUMENTE SIND KEINE BELEGE: Plaene, Specs, Berichte, Stand-Dateien unter tasks/ und PLAN-*.md liest du NICHT. Beleg ist nur: Code auf master mit Datei:Zeile; ein gruener Test, der den Punkt tatsaechlich prueft (nicht nur so heisst); eine rein lesende Messung. Ein docs/OPENAI-*-Dokument zaehlt nur, wenn die Anforderung selbst ein Dokument verlangt - dann pruefst du seine Aussagen stichprobenartig am Code.
Frage neutral: "ist X erfuellt und woran sehe ich das". Fallen: registerTool() des MCP-SDK verwirft unbekannte Felder STILL - Beleg ist der echte tools/list- bzw. resources/read-Output ueber die Route (bestehende Tests, die das ueber die Route messen, oder lokaler Server mit PORT=0 und Temp-DATA_DIR). Doppelte Pfade: HTTP /mcp und stdio, OAuth- und Token-/Legacy-Modus - erfuellt nur, wenn es auf allen betroffenen Pfaden gilt.
Tests: KEINE volle Suite. Nur gezielt einzelne Dateien: NODE_ENV=test node --test <datei>. Beende jeden Server/Prozess, den du startest.
Status: ERFUELLT (nur mit Beleg), TEILWEISE (gebaut, aber nicht voll wirksam), NICHT ERFUELLT, GEGENSTANDSLOS (trifft auf den Dienst nicht zu - mit Beleg), OWNER (braucht etwas, das nur der Owner hat: Deploy/Push, Messung im ChatGPT Developer Mode, echtes Access-Token dekodieren, Render-Dashboard-Werte, Anbieter-Einstellungen, Live-Proben in Claude/ChatGPT, Rechtstext-Inhalte, Portal-Eintraege - "aendert Live-Verhalten" ist KEIN Owner-Grund), UNKLAR (Anforderung nicht eindeutig - sag woran).
Gilt ein baubarer Teil als erfuellt und nur eine Live-Probe fehlt, ist der Status ERFUELLT mit Vermerk "Live-Probe offen" in fehlt - sofern der Code den Punkt vollstaendig umsetzt.
Findest du einen Sicherheitsmangel, melde ihn gesondert in sicherheitsmangel.
Kontext: bleib deutlich unter 100.000 Token - lies gezielt (grep, sed -n), nie ganze grosse Dateien. Gib deine Rueckgabe ab, solange du Luft hast; lieber UNKLAR mit Grund als keine Rueckgabe.`

const pruefAuftrag = ids => `${FRAGEVERBOT}

Du bist unabhaengiger Pruefer der OpenAI-Einreichungsanforderungen fuer den MCP-Dienst Hermes.
${REGELN}

Deine IDs (genau diese, jede genau einmal, keine andere): ${ids.join(', ')}.
Liefere je ID eine Zeile.`

phase('Pruefen')
const ergebnisse = await parallel(GRUPPEN.map(g => () =>
  agent(pruefAuftrag(g.ids), { label: `pruefen:${g.key}`, phase: 'Pruefen', schema: TABELLE, model: 'opus' })))

const zeilen = new Map()
const maengel = []
for (const r of ergebnisse.filter(Boolean)) {
  maengel.push(...r.sicherheitsmangel)
  for (const z of r.zeilen) if (ALLE.includes(z.id) && !zeilen.has(z.id)) zeilen.set(z.id, z)
}

phase('Nachpruefen')
const fehlend = ALLE.filter(id => !zeilen.has(id))
if (fehlend.length) {
  log(`${fehlend.length} IDs fehlen nach Runde 1 - Nachholung: ${fehlend.join(', ')}`)
  const nach = await agent(pruefAuftrag(fehlend), { label: 'pruefen:nachholen', phase: 'Nachpruefen', schema: TABELLE, model: 'opus' })
  if (nach) {
    maengel.push(...nach.sicherheitsmangel)
    for (const z of nach.zeilen) if (fehlend.includes(z.id) && !zeilen.has(z.id)) zeilen.set(z.id, z)
  }
}
const nochFehlend = ALLE.filter(id => !zeilen.has(id))

const erfuellt = ALLE.filter(id => zeilen.get(id)?.status === 'ERFUELLT')
const SCHRITT = Math.max(1, Math.floor(erfuellt.length / 12))
const probe = erfuellt.filter((_, i) => i % SCHRITT === 0).slice(0, 12)
if (erfuellt.length > probe.length) log(`Stichprobe: ${probe.length} von ${erfuellt.length} ERFUELLT-Belegen (jeder ${SCHRITT}.)`)

const URTEIL = {
  type: 'object',
  properties: {
    urteile: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          bestaetigt: { type: 'boolean' },
          grund: { type: 'string', description: 'max 200 Zeichen' },
        },
        required: ['id', 'bestaetigt', 'grund'],
      },
    },
  },
  required: ['urteile'],
}
const probeAuftrag = teil => `${FRAGEVERBOT}

Du bist Gegenpruefer. Ein anderer Pruefer hat die folgenden Anforderungen als ERFUELLT eingestuft. Pruefe jeden Beleg SELBST nach: stimmt die Datei:Zeile bzw. prueft der genannte Test den Punkt wirklich, und deckt er die Anforderung vollstaendig ab (alle Pfade)? Im Zweifel bestaetigt=false.
${REGELN}

${teil.map(id => { const z = zeilen.get(id); return `- ${id}: Beleg "${z.beleg}"` }).join('\n')}`

const halbe = Math.ceil(probe.length / 2)
const probeTeile = [probe.slice(0, halbe), probe.slice(halbe)].filter(t => t.length)
const probeErg = await parallel(probeTeile.map((t, i) => () =>
  agent(probeAuftrag(t), { label: `stichprobe:${i + 1}`, phase: 'Nachpruefen', schema: URTEIL, model: 'opus' })))
const urteile = probeErg.filter(Boolean).flatMap(r => r.urteile)
const widerlegt = urteile.filter(u => !u.bestaetigt)

phase('Zusammenfuehren')
const tabelle = ALLE.map(id => {
  const z = zeilen.get(id)
  if (!z) return `| ${id} | ? | FEHLT | - | nicht geprueft | - |`
  const zelle = s => String(s).replace(/\|/g, '/').replace(/\n/g, ' ')
  return `| ${id} | ${z.technisch ? 'ja' : 'nein'} | ${z.status} | ${zelle(z.beleg)} | ${zelle(z.fehlt)} | ${z.status === 'ERFUELLT' ? '-' : (z.baubar_ohne_owner ? 'ja' : 'nein')} |`
}).join('\n')

const ZUSAMMEN = {
  type: 'object',
  properties: {
    technisch_gesamt: { type: 'number' },
    technisch_erfuellt: { type: 'number' },
    gegenstandslos: { type: 'number' },
    owner: { type: 'number' },
    luecken_ohne_phase: { type: 'array', items: { type: 'string' }, description: 'baubare, nicht erfuellte technische IDs, die KEINE offene Phase abdeckt: "ID: was fehlt (max 150 Zeichen)"' },
    luecken_mit_phase: { type: 'array', items: { type: 'string' }, description: '"ID -> T2-xx" fuer baubare Luecken, die eine offene Phase abdeckt' },
    owner_zweifel: { type: 'array', items: { type: 'string' }, description: 'als OWNER eingestufte IDs, deren fehlender Teil in Wahrheit baubar ist' },
    datei: { type: 'string' },
  },
  required: ['technisch_gesamt', 'technisch_erfuellt', 'gegenstandslos', 'owner', 'luecken_ohne_phase', 'luecken_mit_phase', 'owner_zweifel', 'datei'],
}

const zusammen = await agent(`${FRAGEVERBOT}

Du fuehrst die Zwischenmessung der OpenAI-Einreichung zusammen. Repo ${REPO}, master ${MASTER}. Du aenderst keinen Code und committest nichts.

1. Schreibe die Datei ${AUSGABE} (Verzeichnis existiert; die Datei wird NICHT committet): Ueberschrift "Zwischenmessung 1 - Stand master ${MASTER}", die Tabelle unten unveraendert (Kopf: | ID | technisch | Status | Beleg | Fehlt | baubar ohne Owner |), darunter die Stichprobe (${urteile.length - widerlegt.length} von ${urteile.length} Belegen bestaetigt; widerlegt: ${widerlegt.map(w => `${w.id} (${w.grund})`).join('; ') || 'keine'}), darunter gesondert gemeldete Sicherheitsmaengel: ${maengel.join(' / ') || 'keine'}. Nicht gepruefte IDs: ${nochFehlend.join(', ') || 'keine'}.
Fuer die Zaehlung gilt: eine per Stichprobe widerlegte ERFUELLT-Zeile zaehlt als TEILWEISE.
2. Gleiche jede technische, nicht erfuellte ID mit baubarem Teil gegen die noch OFFENEN Phasen ab: T2-13 bis T2-22 in tasks/PLAN-OPENAI-TECHNIK-2.md (lies dort nur die Phasenkoepfe/IDs dieser Phasen, gezielt per grep). Zusaetzlich ist entschieden: T2-16 fuehrt auch O-18 (Zweckbindung in den Werkzeugtexten). Deckt keine offene Phase die ID ab, ist sie eine "Luecke ohne Phase".
3. Pruefe jede OWNER-Zeile gegen die Owner-Regel (nur Deploy/Push, ChatGPT-Dev-Mode-Messung, Token dekodieren, Dashboard-Werte, Anbieter-Einstellungen, Live-Proben, Rechtstexte, Portal-Eintraege). Ist der fehlende Teil in Wahrheit baubar, gehoert sie in owner_zweifel.
Bleib unter 100.000 Token.

TABELLE:
${tabelle}`, { label: 'zusammenfuehren', phase: 'Zusammenfuehren', schema: ZUSAMMEN, model: 'opus' })

return {
  geprueft: zeilen.size,
  nicht_geprueft: nochFehlend,
  stichprobe: `${urteile.length - widerlegt.length}/${urteile.length} bestaetigt`,
  widerlegt: widerlegt.map(w => `${w.id}: ${w.grund}`.slice(0, 200)),
  sicherheitsmangel: maengel.map(m => m.slice(0, 200)),
  zusammen,
}
