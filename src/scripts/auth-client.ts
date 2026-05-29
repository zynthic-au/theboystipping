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

export type CachedAuthUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  initials?: string | null;
};

declare global {
  interface Window {
    __tbtAuthUser?: CachedAuthUser | null;
  }
}

export function readCachedAuthUser(): CachedAuthUser | null {
  if (window.__tbtAuthUser) return window.__tbtAuthUser;

  try {
    const cached = JSON.parse(localStorage.getItem(getStorageKey("authUser")) || "null") as CachedAuthUser | null;
    removeLegacyStorageKey("authUser");
    return cached?.id ? cached : null;
  } catch {
    localStorage.removeItem(getStorageKey("authUser"));
    removeLegacyStorageKey("authUser");
    return null;
  }
}

export function writeCachedAuthUser(user: CachedAuthUser | null) {
  if (!user?.id) {
    localStorage.removeItem("tbt.authUser");
    localStorage.removeItem(getStorageKey("authUser"));
    window.__tbtAuthUser = null;
    return;
  }

  const cachedUser = {
    id: user.id,
    name: user.name || getDisplayName(user),
    email: user.email,
    initials: user.initials || getInitials(getDisplayName(user)),
  };

  removeLegacyStorageKey("authUser");
  localStorage.setItem(getStorageKey("authUser"), JSON.stringify(cachedUser));
  window.__tbtAuthUser = cachedUser;
}
