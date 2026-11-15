import {
  defaultSessionDurationSeconds,
  isSessionDurationSeconds,
} from "../shared/session";

type DemoSession = { durationSeconds: number; expiresAt: string };
const storageKey = "cloudseed-demo-session";

export function saveDemoSession(durationSeconds: number): DemoSession {
  const session = {
    durationSeconds,
    expiresAt: new Date(Date.now() + durationSeconds * 1000).toISOString(),
  };
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(session));
  } catch {
    // The demo remains usable when browser storage is unavailable.
  }
  return session;
}

export function loadDemoSession(): DemoSession {
  try {
    const session = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (
      session &&
      isSessionDurationSeconds(session.durationSeconds) &&
      typeof session.expiresAt === "string" &&
      Date.parse(session.expiresAt) > Date.now()
    )
      return session;
  } catch {
    // Start a fresh simulated session if storage is unavailable or invalid.
  }
  return saveDemoSession(defaultSessionDurationSeconds);
}

export function resetDemoSession(): void {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // The other demo data is still reset by the page reload.
  }
}
