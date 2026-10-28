const JSON_INDENT_SPACES = 2;

export function jsonText(value) {
  return JSON.stringify(value, null, JSON_INDENT_SPACES);
}

export function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : jsonText(value) }] };
}

export function errText(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function notAccepted(message) {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { accepted: false, merged_facts: 0 },
  };
}

export function makeDateFormatter(dateLocale) {
  return (iso) =>
    new Date(iso).toLocaleString(dateLocale, {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
}
