// Neutrale Media-Event-Typen (Port 4). Provider-agnostisch: der Adapter
// uebersetzt Twilio start/media/stop bzw. Telnyx-Events darauf. OTHER = vom
// Core ignoriert (kein stiller Fehler bei unbekannten Provider-Events).
export const MEDIA_EVENT = Object.freeze({
  START: "start",
  MEDIA: "media",
  STOP: "stop",
  OTHER: "other",
});
