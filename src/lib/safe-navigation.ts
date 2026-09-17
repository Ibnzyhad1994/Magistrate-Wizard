/**
 * Guard for in-app navigation targets that come from data (for example
 * `notifications.link`). Only a same-origin absolute path is accepted: it
 * must start with a single "/", must not be protocol-relative ("//host"),
 * and must not smuggle a scheme ("javascript:", "https:") anywhere in it.
 * Anything else is treated as untrusted and the caller should not navigate.
 */
export const isSafeInternalPath = (path: unknown): path is string => {
  if (typeof path !== "string") return false;
  // eslint-disable-next-line no-control-regex
  const trimmed = path.trim().replace(/[\u0000-\u001F\u007F]/g, "");
  if (!trimmed.startsWith("/")) return false;
  if (trimmed.startsWith("//")) return false;
  if (trimmed.startsWith("/\\")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  return true;
};
