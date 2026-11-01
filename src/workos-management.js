const HTTP_NOT_FOUND = 404;
const NUTZER_LOESCHEN_FRIST_MS = 15_000;
const NUTZER_PRUEFEN_FRIST_MS = 10_000;

export function makeWorkosManagement(config, { _fetch = fetch } = {}) {
  const usersEndpoint = `${config.auth.workosApiBase}/user_management/users`;

  return {
    async deleteUser(subject) {
      const response = await _fetch(`${usersEndpoint}/${encodeURIComponent(subject)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${config.auth.workosManagementApiKey}` },
        signal: AbortSignal.timeout(NUTZER_LOESCHEN_FRIST_MS),
      });
      if (response.status === HTTP_NOT_FOUND) return { deleted: true, alreadyGone: true };
      if (!response.ok) throw new Error(`workos_management deleteUser HTTP ${response.status}`);
      return { deleted: true, alreadyGone: false };
    },

    async userExists(subject) {
      const response = await _fetch(`${usersEndpoint}/${encodeURIComponent(subject)}`, {
        headers: { Authorization: `Bearer ${config.auth.workosManagementApiKey}` },
        signal: AbortSignal.timeout(NUTZER_PRUEFEN_FRIST_MS),
      });
      if (response.status === HTTP_NOT_FOUND) return false;
      if (!response.ok) throw new Error(`workos_management userExists HTTP ${response.status}`);
      return true;
    },
  };
}
