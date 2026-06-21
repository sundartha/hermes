// MCP-Tool-Definitionen (gemeinsam fuer stdio-Transport und Streamable HTTP /mcp).
// Die Tools sprechen mit der REST-API des Gateways.
import { z } from "zod";

// Zur Aufrufzeit lesen (server.js setzt GATEWAY_URL ggf. erst beim Start)
const GATEWAY = () => (process.env.GATEWAY_URL || "http://localhost:3000").replace(/\/$/, "");

// identity (optional): wird als interner X-Internal-Identity-Header an die
// localhost-REST-API gereicht (Rechteprofile, Phase 2). Das Gateway akzeptiert
// den Header nur von localhost-Sockets. Ohne identity -> Owner-Verhalten.
async function api(method, path, body, identity) {
  const headers = { "Content-Type": "application/json" };
  if (identity) headers["X-Internal-Identity"] = identity;
  const res = await fetch(GATEWAY() + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

const text = (s) => ({ content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] });
// Fehler-Tool-Ergebnis (MCP-Konvention isError): der LLM-Client sieht eine klare,
// generische Meldung statt eines process-level Crashes. KEIN roher Gateway-Body.
const errText = (s) => ({ content: [{ type: "text", text: s }], isError: true });
const fmt = (iso) => new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// AC5 Result-Guard: prueft, ob das api()-Ergebnis die erwarteten Felder mit dem
// erwarteten Typ traegt, BEVOR ein Handler verschachtelt deref't. api() degradiert
// bei Parse-Fehler zu `{}` (mcp-tools.js: res.json().catch(() => ({}))); ein blinder
// Deref (`s.calendar.length`, `r.callId`) crasht darauf mit TypeError. Geprueft wird
// Existenz/Typ, NICHT Nicht-Leere (leerer Kalender `[]` bleibt valide). Wirft eine
// generische, provider-freie Tool-Fehlermeldung (kein roher Gateway-Body, Regel 5).
function requireFields(obj, specs) {
  if (obj == null || typeof obj !== "object")
    throw new Error("Der Telefon-Agent hat keine gueltige Antwort geliefert. Bitte spaeter erneut versuchen.");
  for (const [field, type] of Object.entries(specs)) {
    const v = obj[field];
    const ok = type === "array" ? Array.isArray(v) : type === "object" ? v != null && typeof v === "object" : typeof v === type;
    if (!ok)
      throw new Error("Der Telefon-Agent hat eine unvollstaendige Antwort geliefert. Bitte spaeter erneut versuchen.");
  }
  return obj;
}

// Status-Mapping laut Vertrag: dialing | in_progress | completed | failed | cancelled
function mapStatus(c) {
  if (c.status === "active") return c.answeredAt ? "in_progress" : "dialing";
  return c.status;
}
function durationS(c) {
  const start = c.answeredAt || c.startedAt;
  const end = c.endedAt || new Date().toISOString();
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000));
}

// ctx (Phase 2): { identity, allowCalendar }. identity wird per Closure an jeden
// REST-Aufruf gehaengt (X-Internal-Identity). allowCalendar steuert, ob das
// get_calendar-Tool ueberhaupt registriert wird. stdio ruft registerTools(server)
// ohne ctx -> identity null (Owner), allowCalendar true.
export function registerTools(server, { identity = null, allowCalendar = true } = {}) {
  const call = (method, path, body) => api(method, path, body, identity);

  // AC6 per-handler Throw-Schutz (gilt stdio UND HTTP /mcp, da registerTools geteilt
  // ist): wickelt JEDEN Handler in ein catch. Ein Tool-Throw (Gateway-Fehler,
  // Result-Guard, Deref) wird zu einer sauberen MCP-Fehlerantwort (isError) statt
  // einer process-level unhandled rejection. requireFields-Meldungen sind bereits
  // generisch; alles andere bekommt eine stabile, provider-freie Meldung (kein Leak).
  const tool = (name, desc, schema, handler) =>
    server.tool(name, desc, schema, async (...args) => {
      try {
        return await handler(...args);
      } catch (err) {
        return errText(err?.message || "Der Telefon-Agent ist momentan nicht erreichbar. Bitte spaeter erneut versuchen.");
      }
    });

  tool(
    "place_call",
    "Startet einen echten Telefonanruf des KI-Agenten an eine Telefonnummer und verfolgt dabei das angegebene Ziel. Welche Ziele erlaubt sind, entscheidet der Server ueber seine Safety-Gates (Rechteprofil/Allowlist, Denylist, Land, Limits) - einfach aufrufen; unerlaubte Ziele weist der Server mit einer klaren Meldung ab. Gibt sofort eine call_id zurueck. WICHTIG: Danach alle ~10 Sekunden get_call_status aufrufen, bis status=completed, und erst dann mit get_transcript das Ergebnis holen.",
    {
      to: z.string().describe("Zielrufnummer in E.164, z.B. +4917212345678. Wird serverseitig durch die Safety-Gates geprueft (Rechteprofil/Allowlist, Denylist, Land)."),
      objective: z.string().describe("Das Ziel des Anrufs in einem Satz, z.B. 'Vereinbare einen Friseurtermin fuer Samstag vormittag.'"),
      briefing: z.string().optional().describe("Kontext fuer den Agenten (Namen, Vorlieben, Hintergrund)."),
      constraints: z.string().optional().describe("Einschraenkungen, z.B. 'Nicht vor 10 Uhr, maximal 40 Euro.'"),
      language: z.string().optional().describe("Gespraechssprache, Default 'de'."),
      max_duration_s: z.number().optional().describe("Maximale Gespraechsdauer in Sekunden (Default 180, Max 300)."),
      caller_name: z.string().optional().describe("Name des Auftraggebers fuer die Offenlegung am Gespraechsbeginn."),
    },
    async (args) => {
      const r = await call("POST", "/api/calls", args);
      requireFields(r, { callId: "string" });
      return text({ call_id: r.callId, status: "dialing" });
    }
  );

  tool(
    "get_call_status",
    "Liefert den Live-Zustand eines Anrufs: status (dialing|in_progress|completed|failed|cancelled), Dauer und die letzten Transkriptzeilen. Waehrend eines laufenden Anrufs alle ~10 Sekunden aufrufen.",
    { call_id: z.string().describe("Die call_id aus place_call") },
    async ({ call_id }) => {
      const c = await call("GET", `/api/calls/${call_id}`);
      requireFields(c, { transcript: "array" });
      return text({
        status: mapStatus(c),
        duration_s: durationS(c),
        last_transcript_lines: c.transcript.slice(-6).map((t) => `${t.role === "agent" ? "Agent" : "Gegenseite"}: ${t.text}`),
      });
    }
  );

  tool(
    "get_transcript",
    "Liefert nach Gespraechsende die Ergebnis-Zusammenfassung und ob das Ziel erreicht wurde. Aus Datenschutzgruenden wird das Roh-Transkript nach der Zusammenfassung nicht aufbewahrt (Datenminimierung) - das transcript-Feld ist fuer abgeschlossene Calls daher leer. Erst aufrufen, wenn get_call_status status=completed meldet.",
    { call_id: z.string().describe("Die call_id aus place_call") },
    async ({ call_id }) => {
      const c = await call("GET", `/api/calls/${call_id}`);
      if (c.status === "active") return text({ error: "Anruf laeuft noch. Bitte get_call_status pollen und spaeter erneut versuchen." });
      requireFields(c, { transcript: "array" });
      return text({
        transcript: c.transcript.map((t) => ({ role: t.role === "agent" ? "agent" : "callee", text: t.text, t: t.at })),
        result_summary: c.summary || "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)",
        objective_achieved: c.objectiveAchieved ?? "unclear",
      });
    }
  );

  tool(
    "cancel_call",
    "Bricht einen laufenden Anruf sauber ab.",
    { call_id: z.string().describe("Die call_id aus place_call") },
    async ({ call_id }) => {
      await call("POST", `/api/calls/${call_id}/cancel`);
      return text({ status: "cancelled" });
    }
  );

  tool(
    "get_my_number",
    "Liefert die Rufnummer des Telefon-Agenten (die Twilio-Nummer).",
    {},
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { agent: "object" });
      return text({ number: s.agent.number });
    }
  );

  // ---- Bonus-Tools (ueber den Brief hinaus, fuer die Hermes-Demo) ----
  tool(
    "list_calls",
    "Listet die letzten Telefonate des Agenten (inbound und outbound) mit Status und Summary.",
    {},
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { calls: "array" });
      if (!s.calls.length) return text("Noch keine Anrufe.");
      return text(
        s.calls
          .map((c) => `[${c.id}] ${c.direction === "outbound" ? "->" : "<-"} ${c.direction === "outbound" ? c.to : c.from} | ${mapStatus(c)} | ${fmt(c.startedAt)}${c.summary ? " | " + c.summary : ""}`)
          .join("\n")
      );
    }
  );

  tool(
    "list_action_items",
    "Listet offene Action Items aus allen Telefonaten.",
    {},
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { actionItems: "array" });
      const open = s.actionItems.filter((a) => !a.done);
      if (!open.length) return text("Keine offenen Action Items.");
      return text(open.map((a) => `[${a.id}] ${a.type === "appointment" ? "(Termin) " : ""}${a.text}`).join("\n"));
    }
  );

  // Kalender-Tool nur registrieren, wenn das Profil es erlaubt (Phase 2). Ein
  // restriktives Profil sieht get_calendar gar nicht erst.
  if (allowCalendar)
    tool(
      "get_calendar",
      "Zeigt die naechsten Kalendereintraege des Besitzers.",
      {},
      async () => {
        const s = await call("GET", "/api/state");
        // Existenz/Typ pruefen, NICHT Nicht-Leere: leerer Kalender ([]) ist valide
        // und behaelt den bestehenden "Kalender ist leer."-Pfad.
        requireFields(s, { calendar: "array" });
        if (!s.calendar.length) return text("Kalender ist leer.");
        return text(s.calendar.map((e) => `${e.title}: ${fmt(e.start)} bis ${fmt(e.end)}`).join("\n"));
      }
    );

  tool(
    "get_agent_status",
    "Status des Telefon-Agenten: Rufnummer, Voice-Engine, Modell, Kosten/Budget, Berechtigungen.",
    {},
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { agent: "object", usage: "object", settings: "object" });
      return text(
        `Agent-Nummer: ${s.agent.number}\nBesitzer: ${s.agent.owner}\nVoice-Engine: ${s.agent.voiceEngine}\nModell: ${s.agent.model}\n` +
          `Calls bisher: ${s.usage.calls}\nKI-Kosten: ${s.usage.costEur.toFixed(3)} EUR von max. ${s.usage.maxBudgetEur} EUR\n` +
          `Allowlist: ${s.agent.allowedNumbers?.join(", ") || "(leer - Outbound gesperrt)"}\n` +
          `Berechtigungen: Kalender=${s.settings.allowCalendar}, Buchen=${s.settings.allowBooking}, Summaries=${s.settings.allowSummaries}, PersoenlicheDaten=${s.settings.allowPersonalData}, Bankdaten=${s.settings.allowBankData}`
      );
    }
  );
}
