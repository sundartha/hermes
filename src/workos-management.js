const HTTP_NOT_FOUND = 404;

export function makeWorkosManagement(config, { _fetch = fetch } = {}) {
  const usersEndpoint = `${config.auth.workosApiBase}/user_management/users`;

  return {
    async deleteUser(subject) {
      const r = await _fetch(`${usersEndpoint}/${encodeURIComponent(subject)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${config.auth.workosManagementApiKey}` },
      });
      if (r.status === 404) return { deleted: true, alreadyGone: true };
      if (!r.ok) throw new Error(`workos_management deleteUser HTTP ${r.status}`);
      return { deleted: true, alreadyGone: false };
    },

    async userExists(subject) {
      const response = await _fetch(`${usersEndpoint}/${encodeURIComponent(subject)}`, {
        headers: { Authorization: `Bearer ${config.auth.workosManagementApiKey}` },
      });
      if (response.status === HTTP_NOT_FOUND) return false;
      if (!response.ok) throw new Error(`workos_management userExists HTTP ${response.status}`);
      return true;
    },
  };
}
