import { getAuthClient, getAuthUrlDiagnostic, getDisplayName, getInitials, getStorageKey, hasAuthConfig, removeLegacyStorageKey } from "./auth-client";

const params = new URLSearchParams(window.location.search);
const redirectTo = params.get("redirectTo") || "/tips";

const form = document.getElementById("auth-form") as HTMLFormElement | null;
const nameInput = document.getElementById("auth-name") as HTMLInputElement | null;
const emailInput = document.getElementById("auth-email") as HTMLInputElement | null;
const passwordInput = document.getElementById("auth-password") as HTMLInputElement | null;
const title = document.getElementById("auth-title");
const copy = document.getElementById("auth-copy");
const submit = document.getElementById("auth-submit") as HTMLButtonElement | null;
const modeButton = document.getElementById("auth-mode") as HTMLButtonElement | null;
const switchCopy = document.getElementById("auth-switch-copy");
const errorEl = document.getElementById("auth-error");
const statusEl = document.getElementById("auth-status");
const sessionEl = document.getElementById("auth-session");
const sessionName = document.getElementById("auth-session-name");
const sessionEmail = document.getElementById("auth-session-email");
const sessionInitials = document.getElementById("auth-session-initials");
const signOutButton = document.getElementById("auth-sign-out") as HTMLButtonElement | null;

let isSignUp = params.get("mode") === "signup";
const initialError = params.get("error");

function setMessage(el: HTMLElement | null, message: string) {
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("hidden", !message);
}

function formatAuthError(error: unknown) {
  if (!error) return "Authentication failed.";
  if (typeof error === "string") return error;

  const err = error as { message?: string; status?: number; statusText?: string; code?: string; cause?: unknown };
  const parts = [err.message, err.status ? `HTTP ${err.status}` : null, err.statusText, err.code]
    .filter(Boolean);

  return parts.join(" · ") || "Authentication failed.";
}

function syncMode() {
  if (!title || !copy || !submit || !modeButton || !switchCopy || !nameInput) return;

  title.textContent = isSignUp ? "Create account" : "Sign in";
  copy.textContent = isSignUp
    ? "Create a Neon Auth account to join groups and save your tips."
    : "Use your Neon Auth account to access your tips and groups.";
  submit.textContent = isSignUp ? "Create account" : "Sign in";
  modeButton.textContent = isSignUp ? "Sign in" : "Create one";
  switchCopy.textContent = isSignUp ? "Already have an account?" : "Don't have an account?";
  nameInput.closest("label")?.classList.toggle("hidden", !isSignUp);
  nameInput.required = isSignUp;
}

function showSignedIn(user: { name?: string | null; email?: string | null }) {
  const displayName = getDisplayName(user);
  form?.classList.add("hidden");
  sessionEl?.classList.remove("hidden");
  if (sessionName) sessionName.textContent = displayName;
  if (sessionEmail) sessionEmail.textContent = user.email || "";
  if (sessionInitials) sessionInitials.textContent = getInitials(displayName);
}

async function bootAuthPage() {
  syncMode();

  if (initialError === "session") {
    setMessage(errorEl, `Could not check your Neon Auth session. Auth URL: ${getAuthUrlDiagnostic()}`);
  }

  if (!hasAuthConfig()) {
    setMessage(errorEl, "PUBLIC_NEON_AUTH_URL is not configured. Add it to .env from Neon Auth > Configuration.");
    form?.classList.add("hidden");
    return;
  }

  let user: { name?: string | null; email?: string | null } | undefined;

  try {
    const auth = getAuthClient();
    const sessionResult = await auth.getSession();
    user = sessionResult.data?.user;
  } catch (error) {
    setMessage(errorEl, `${formatAuthError(error)}. Auth URL: ${getAuthUrlDiagnostic()}`);
    console.error("Neon Auth getSession failed", error);
    return;
  }

  if (user) {
    showSignedIn(user);
  }
}

modeButton?.addEventListener("click", () => {
  isSignUp = !isSignUp;
  setMessage(errorEl, "");
  setMessage(statusEl, "");
  syncMode();
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(errorEl, "");
  setMessage(statusEl, "");

  if (!emailInput || !passwordInput || !submit) return;

  submit.disabled = true;
  submit.textContent = isSignUp ? "Creating..." : "Signing in...";

  try {
    const auth = getAuthClient();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const result = isSignUp
      ? await auth.signUp.email({
          email,
          password,
          name: nameInput?.value.trim() || email.split("@")[0] || "Tipper",
        })
      : await auth.signIn.email({ email, password });

    if (result.error) {
      setMessage(errorEl, `${formatAuthError(result.error)}. Auth URL: ${getAuthUrlDiagnostic()}`);
      console.error("Neon Auth error", result.error);
      return;
    }

    let user: { id?: string; name?: string | null; email?: string | null } | undefined;
    try {
      const sessionResult = await auth.getSession();
      user = sessionResult.data?.user;
    } catch (error) {
      setMessage(errorEl, `${formatAuthError(error)}. Account may have been created, but session lookup failed.`);
      console.error("Neon Auth post-submit getSession failed", error);
      return;
    }

    if (user) {
      removeLegacyStorageKey("authUser");
      localStorage.setItem(getStorageKey("authUser"), JSON.stringify({
        id: user.id,
        name: getDisplayName(user),
        email: user.email,
        initials: getInitials(getDisplayName(user)),
      }));
      window.location.href = redirectTo;
      return;
    }

    setMessage(statusEl, "Check your email to finish signing in.");
  } catch (error) {
    setMessage(errorEl, `${formatAuthError(error)}. Auth URL: ${getAuthUrlDiagnostic()}`);
    console.error("Neon Auth submit failed", error);
  } finally {
    submit.disabled = false;
    syncMode();
  }
});

signOutButton?.addEventListener("click", async () => {
  const auth = getAuthClient();
  try {
    await auth.signOut();
  } catch (error) {
    console.error("Neon Auth signOut failed", error);
  }
  localStorage.removeItem(getStorageKey("authUser"));
  removeLegacyStorageKey("authUser");
  window.location.href = "/auth";
});

void bootAuthPage();
