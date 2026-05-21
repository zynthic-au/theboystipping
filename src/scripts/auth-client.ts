import { createAuthClient } from "@neondatabase/neon-js/auth";

const authUrl = import.meta.env.PUBLIC_NEON_AUTH_URL;
const appEnv = import.meta.env.PUBLIC_APP_ENV || import.meta.env.MODE || "development";

export function getStorageKey(name: string) {
  return `tbt.${appEnv}.${name}`;
}

export function removeLegacyStorageKey(name: string) {
  localStorage.removeItem(`tbt.${name}`);
  sessionStorage.removeItem(`tbt.${name}`);
}

export function hasAuthConfig() {
  return Boolean(authUrl);
}

export function getAuthClient() {
  if (!authUrl) {
    throw new Error("PUBLIC_NEON_AUTH_URL is not set. Add your Neon Auth Base URL to .env.");
  }

  return createAuthClient(authUrl);
}

export function getAuthUrlDiagnostic() {
  if (!authUrl) return "PUBLIC_NEON_AUTH_URL is missing";

  try {
    const url = new URL(authUrl);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "PUBLIC_NEON_AUTH_URL is not a valid URL";
  }
}

export function getDisplayName(user: { name?: string | null; email?: string | null }) {
  return user.name || user.email?.split("@")[0] || "Account";
}

export function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}
