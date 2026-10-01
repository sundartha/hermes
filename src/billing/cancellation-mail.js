// 312k-Phase 5: Kuendigungsbestaetigung per E-Mail (§ 312k BGB verlangt, dass der
// Unternehmer dem Verbraucher den Inhalt der Kuendigung UNVERZUEGLICH in Textform auf
// einem dauerhaften Datentraeger bestaetigt). Haengt an der ERFOLGREICHEN Kuendigung
// (self-service-routes.js cancel-Route), NICHT am Vertragsende - anders als
// contract-end-cleanup.js (312k-Phase 4), das erst beim SUSPEND-Webhook laeuft. Der
// Kunde soll die Bestaetigung SOFORT nach seiner Kuendigung bekommen ("unverzueglich").
//
// Retry-Mechanik EXAKT im Muster von contract-end-cleanup.js: ein offener Vermerk am
// Tenant (state-ops.js setCancellationMailPending), ein periodischer Sweep
// (runCancellationMailSweep) versucht es erneut, jeder Versuch UND jeder Ausgang landet
// im durablen Nachweis (auditStore.record). Darf die Kuendigung NIEMALS scheitern lassen
// (fail-soft, wirft nie) - ein nicht erreichbarer Mailserver ist kein Grund, eine
// Kuendigung abzulehnen; ist SMTP nicht konfiguriert, wird gar nicht erst versucht,
// sondern nur vermerkt (Muster WORKOS_MANAGEMENT_API_KEY fehlt).
//
// Niemals die Empfaenger-Adresse oder das SMTP-Passwort loggen/audit (Regel 4 - eine
// Email-Adresse IST personenbezogen, genauso wie ein Secret).
import { findPlan } from "../plans.js";

const AUDIT_ACTION = Object.freeze({
  MAIL_SENT: "cancellation_mail_sent",
  MAIL_SEND_FAILED: "cancellation_mail_send_failed",
  MAIL_SEND_SKIPPED: "cancellation_mail_send_skipped",
});

const RECEIVED_FORMAT = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  dateStyle: "medium",
  timeStyle: "short",
});
const EFFECTIVE_DATE_FORMAT = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  dateStyle: "medium",
});

// Eingangszeitpunkt in der Schreibweise der Kuendigungs-Mail (deutsche Ortszeit).
function formatReceivedAt(receivedAt) {
  return `${RECEIVED_FORMAT.format(new Date(receivedAt))} Uhr`;
}

// Der Bestaetigungstext lebt an GENAU dieser einen Stelle (kein zweites Vorkommen im
// Code, G5) - schlichtes Deutsch, reiner Text (Textform verlangt keine Gestaltung, s.
// Auftrag). Traegt alle sechs Pflichtangaben: Eingang (Datum+Uhrzeit), gekuendigter
// Vertrag (Tarifname), Hinweis "ordentliche Kuendigung zum Periodenende", Wirkungsdatum,
// Hinweis auf die unveraenderte Nutzbarkeit bis dahin, Absender-/Anbieterangabe + Verweis
// aufs Impressum. Keine erfundenen Firmenangaben - das Impressum traegt noch Platzhalter
// (apps/web/src/data/legal/imprint.de.json), der Text verweist deshalb NUR dorthin.
export function buildCancellationMailText({ planSlug, currentPeriodEnd, receivedAt, publicUrl }) {
  const planName = findPlan(planSlug)?.name ?? planSlug ?? "Ihr Tarif";
  const receivedText = formatReceivedAt(receivedAt);
  const effectiveText =
    currentPeriodEnd != null
      ? EFFECTIVE_DATE_FORMAT.format(new Date(currentPeriodEnd * 1000))
      : "dem Ende des laufenden Abrechnungszeitraums";
  const impressumUrl = `${publicUrl}/impressum`;

  const subject = "Bestätigung Ihrer Kündigung";
  const text = [
    "Hallo,",
    "",
    `hiermit bestätigen wir den Eingang Ihrer Kündigung vom ${receivedText}.`,
    "",
    `Gekündigter Vertrag: ${planName}`,
    "",
    "Es handelt sich um eine ordentliche Kündigung zum Ende des laufenden " +
      `Abrechnungszeitraums. Sie wird wirksam zum ${effectiveText}.`,
    "",
    "Bis zu diesem Zeitpunkt können Sie den Dienst unverändert weiter nutzen.",
    "",
    "Mit freundlichen Grüßen",
    "Sundartha — Anbieter des Telefon-Assistenten Hermes",
    `Anbieterangaben: ${impressumUrl}`,
  ].join("\n");

  return { subject, text };
}

// Ein Versandversuch. Liefert true = noch OFFEN (Retry noetig), false = erledigt (Mail
// verschickt ODER nichts zu tun, weil schon bestaetigt). Jeder Versuch UND jeder Ausgang
// landet im durablen Nachweis (auditStore.record) - console/logger sind nur die
// operative Sicht daneben. Niemals die Empfaengeradresse in Log/Audit-Detail.
async function attemptSend({ store, mailer, accounts, auditStore, logger, config, tenantId }) {
  const { pending, receivedAt } = store.cancellationMailPending(tenantId);
  if (!pending) return false; // nie ausgeloest ODER bereits bestaetigt - nichts zu tun

  if (!mailer) {
    // Owner-Entscheidung (Auslieferungszustand): ohne eigens gesetzte SMTP_*-Variablen
    // wird der Versand NICHT versucht - offen vermerkt, protokolliert, der Rest der
    // Kuendigung bleibt gueltig (Muster attemptWorkosDelete key_missing).
    logger.warn(`[cancellation-mail] SMTP nicht konfiguriert - Bestaetigung offen tenant=${tenantId}`);
    await auditStore.record({
      tenantId,
      action: AUDIT_ACTION.MAIL_SEND_SKIPPED,
      detail: "reason=smtp_not_configured",
    });
    return true;
  }

  // Empfaenger-Adresse AUSSCHLIESSLICH ueber den bestehenden Lesepfad (account.email via
  // accounts.accountByTenant, web-auth.js) - NIE aus einem Request-Body (kein Spoofing).
  // null = kein eindeutiger Account (0 oder mehrdeutig, fail-closed) -> kein Versand.
  const account = await accounts.accountByTenant(tenantId);
  if (!account?.email) {
    logger.warn(`[cancellation-mail] keine Empfaengeradresse hinterlegt - Bestaetigung offen tenant=${tenantId}`);
    await auditStore.record({
      tenantId,
      action: AUDIT_ACTION.MAIL_SEND_SKIPPED,
      detail: "reason=no_address",
    });
    return true;
  }

  const { planSlug, currentPeriodEnd } = store.tenantSubscription(tenantId);
  const { subject, text } = buildCancellationMailText({
    planSlug,
    currentPeriodEnd,
    receivedAt,
    publicUrl: config.server.publicUrl,
  });

  try {
    await mailer.sendMail({ to: account.email, subject, text });
  } catch (err) {
    // NUR err.code/err.name loggen, NIE err.message (koennte bei einem SMTP-Auth-Fehler
    // Nutzer-/Server-Details tragen) - striktere Vorsicht als beim WorkOS-Pendant, weil
    // hier zusaetzlich eine Email-Adresse im Spiel ist (Regel 4).
    logger.warn(
      `[cancellation-mail] Versand fehlgeschlagen tenant=${tenantId}: ${err.code || err.name || "error"}`,
    );
    await auditStore.record({
      tenantId,
      action: AUDIT_ACTION.MAIL_SEND_FAILED,
      detail: "reason=provider_error",
    });
    return true;
  }

  store.setCancellationMailPending(tenantId, { pending: false });
  await auditStore.record({ tenantId, action: AUDIT_ACTION.MAIL_SENT, detail: null });
  return false;
}

// Oeffentlicher Einstieg fuer BEIDE Aufrufer (self-service-routes.js cancel-Route UND
// runCancellationMailSweep) - EIN Codepfad (G5). Wirft NIE (Muster
// attemptContractEndCleanup): ein aeusserer try/catch ist ein zusaetzlicher Riegel gegen
// einen unerwarteten Store-/Config-Fehler, der die aufrufende Kuendigung sonst zu Fall
// braechte.
export async function attemptCancellationMailConfirm({
  store,
  mailer,
  accounts,
  config,
  auditStore = { record: async () => {} },
  logger = console,
  tenantId,
}) {
  try {
    return await attemptSend({ store, mailer, accounts, auditStore, logger, config, tenantId });
  } catch (err) {
    logger.warn(`[cancellation-mail] Aufraeumen fehlgeschlagen tenant=${tenantId}: ${err.message}`);
    return true;
  }
}

// Periodischer Retry-Sweep (Muster runContractEndCleanupSweep): findet alle Tenants mit
// noch offener Bestaetigung (Selektor tenantsPendingCancellationMail, state-ops.js) und
// versucht jeden erneut. Idempotent: ein Tenant ohne offenen Rest verlaesst den Selektor
// und wird nicht mehr angefasst - keine doppelte Mail nach einem bereits erfolgreichen
// Versand.
export async function runCancellationMailSweep({ store, mailer, accounts, config, auditStore, logger = console }) {
  const pending = store.tenantsPendingCancellationMail();
  for (const tenant of pending) {
    await attemptCancellationMailConfirm({ store, mailer, accounts, config, auditStore, logger, tenantId: tenant.id });
  }
  return { attempted: pending.length };
}
