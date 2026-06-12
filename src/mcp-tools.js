// MCP-Tool-Definitionen (gemeinsam fuer stdio-Transport und Streamable HTTP /mcp).
// Die Tools sprechen mit der REST-API des Gateways.
import { z } from "zod";

// Zur Aufrufzeit lesen (server.js setzt GATEWAY_URL ggf. erst beim Start)
const GATEWAY = () => (process.env.GATEWAY_URL || "http://localhost:3000").replace(/\/$/, "");

async function api(method, path, body) {
  const res = await fetch(GATEWAY() + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

const text = (s) => ({ content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] });
const fmt = (iso) => new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

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

export function registerTools(server) {
  server.tool(
    "place_call",
    "Startet einen echten Telefonanruf des KI-Agenten an eine Nummer aus der Allowlist und verfolgt dabei das angegebene Ziel. Gibt sofort eine call_id zurueck. WICHTIG: Danach alle ~10 Sekunden get_call_status aufrufen, bis status=completed, und erst dann mit get_transcript das Ergebnis holen.",
    {
      to: z.string().describe("Zielrufnummer in E.164, z.B. +4917212345678. Muss in der Allowlist (ALLOWED_NUMBERS) stehen."),
      objective: z.string().describe("Das Ziel des Anrufs in einem Satz, z.B. 'Vereinbare einen Friseurtermin fuer Samstag vormittag.'"),
      briefing: z.string().optional().describe("Kontext fuer den Agenten (Namen, Vorlieben, Hintergrund)."),
      constraints: z.string().optional().describe("Einschraenkungen, z.B. 'Nicht vor 10 Uhr, maximal 40 Euro.'"),
      language: z.string().optional().describe("Gespraechssprache, Default 'de'."),
      max_duration_s: z.number().optional().describe("Maximale Gespraechsdauer in Sekunden (Default 180, Max 300)."),
      caller_name: z.string().optional().describe("Name des Auftraggebers fuer die Offenlegung am Gespraechsbeginn."),
    },
    async (args) => {
      const r = await api("POST", "/api/calls", args);
      return text({ call_id: r.callId, status: "dialing" });
    }
  );

  server.tool(
    "get_call_status",
    "Liefert den Live-Zustand eines Anrufs: status (dialing|in_progress|completed|failed|cancelled), Dauer und die letzten Transkriptzeilen. Waehrend eines laufenden Anrufs alle ~10 Sekunden aufrufen.",
    { call_id: z.string().describe("Die call_id aus place_call") },
    async ({ call_id }) => {
      const c = await api("GET", `/api/calls/${call_id}`);
      return text({
        status: mapStatus(c),
        duration_s: durationS(c),
        last_transcript_lines: c.transcript.slice(-6).map((t) => `${t.role === "agent" ? "Agent" : "Gegenseite"}: ${t.text}`),
      });
    }
  );

  server.tool(
    "get_transcript",
    "Liefert nach Gespraechsende das Volltranskript, eine Ergebnis-Zusammenfassung und ob das Ziel erreicht wurde. Erst aufrufen, wenn get_call_status status=completed meldet.",
    { call_id: z.string().describe("Die call_id aus place_call") },
    async ({ call_id }) => {
      const c = await api("GET", `/api/calls/${call_id}`);
      if (c.status === "active") return text({ error: "Anruf laeuft noch. Bitte get_call_status pollen und spaeter erneut versuchen." });
      return text({
        transcript: c.transcript.map((t) => ({ role: t.role === "agent" ? "agent" : "callee", text: t.text, t: t.at })),
        result_summary: c.summary || "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)",
        objective_achieved: c.objectiveAchieved ?? "unclear",
      });
    }
  );

  server.tool(
    "cancel_call",
    "Bricht einen laufenden Anruf sauber ab.",
    { call_id: z.string().describe("Die call_id aus place_call") },
    async ({ call_id }) => {
      await api("POST", `/api/calls/${call_id}/cancel`);
      return text({ status: "cancelled" });
    }
  );

  server.tool(
    "get_my_number",
    "Liefert die Rufnummer des Telefon-Agenten (die Twilio-Nummer).",
    {},
    async () => {
      const s = await api("GET", "/api/state");
      return text({ number: s.agent.number });
    }
  );

  // ---- Bonus-Tools (ueber den Brief hinaus, fuer die Vodafone-Demo) ----
  server.tool(
    "list_calls",
    "Listet die letzten Telefonate des Agenten (inbound und outbound) mit Status und Summary.",
    {},
    async () => {
      const s = await api("GET", "/api/state");
      if (!s.calls.length) return text("Noch keine Anrufe.");
      return text(
        s.calls
          .map((c) => `[${c.id}] ${c.direction === "outbound" ? "->" : "<-"} ${c.direction === "outbound" ? c.to : c.from} | ${mapStatus(c)} | ${fmt(c.startedAt)}${c.summary ? " | " + c.summary : ""}`)
          .join("\n")
      );
    }
  );

  server.tool(
    "list_action_items",
    "Listet offene Action Items aus allen Telefonaten.",
    {},
    async () => {
      const s = await api("GET", "/api/state");
      const open = s.actionItems.filter((a) => !a.done);
      if (!open.length) return text("Keine offenen Action Items.");
      return text(open.map((a) => `[${a.id}] ${a.type === "appointment" ? "(Termin) " : ""}${a.text}`).join("\n"));
    }
  );

  server.tool(
    "get_calendar",
    "Zeigt die naechsten Kalendereintraege des Besitzers.",
    {},
    async () => {
      const s = await api("GET", "/api/state");
      if (!s.calendar.length) return text("Kalender ist leer.");
      return text(s.calendar.map((e) => `${e.title}: ${fmt(e.start)} bis ${fmt(e.end)}`).join("\n"));
    }
  );

  server.tool(
    "get_agent_status",
    "Status des Telefon-Agenten: Rufnummer, Voice-Engine, Modell, Kosten/Budget, Berechtigungen.",
    {},
    async () => {
      const s = await api("GET", "/api/state");
      return text(
        `Agent-Nummer: ${s.agent.number}\nBesitzer: ${s.agent.owner}\nVoice-Engine: ${s.agent.voiceEngine}\nModell: ${s.agent.model}\n` +
          `Calls bisher: ${s.usage.calls}\nKI-Kosten: ${s.usage.costEur.toFixed(3)} EUR von max. ${s.usage.maxBudgetEur} EUR\n` +
          `Allowlist: ${s.agent.allowedNumbers?.join(", ") || "(leer - Outbound gesperrt)"}\n` +
          `Berechtigungen: Kalender=${s.settings.allowCalendar}, Buchen=${s.settings.allowBooking}, Summaries=${s.settings.allowSummaries}, PersoenlicheDaten=${s.settings.allowPersonalData}, Bankdaten=${s.settings.allowBankData}`
      );
    }
  );
}
