const BREVO_API_BASE = "https://api.brevo.com/v3";

export function makeBrevoMailer(config, { _fetch = fetch } = {}) {
  return {
    async sendMail({ to, subject, text }) {
      const res = await _fetch(`${BREVO_API_BASE}/smtp/email`, {
        method: "POST",
        headers: {
          "api-key": config.mail.brevoApiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: config.mail.mailFrom },
          to: [{ email: to }],
          subject,
          textContent: text,
        }),
      });
      if (!res.ok) {
        const err = new Error("brevo sendMail fehlgeschlagen");
        err.code = `http_${res.status}`;
        throw err;
      }
    },
  };
}

export async function verifyBrevoAccount(config, { _fetch = fetch } = {}) {
  const res = await _fetch(`${BREVO_API_BASE}/account`, {
    headers: { "api-key": config.mail.brevoApiKey, accept: "application/json" },
  });
  if (!res.ok) {
    const err = new Error("brevo account check fehlgeschlagen");
    err.code = `http_${res.status}`;
    throw err;
  }
}
