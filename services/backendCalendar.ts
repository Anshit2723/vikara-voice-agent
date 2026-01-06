// services/backendCalendar.ts

export interface BackendEvent {
  id: string;
  summary: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  htmlLink?: string;
  attendees?: { email: string }[];
}

export type AuthStatusResponse = { connected: boolean };

export type FreeBusyResponse = {
  busy: Array<{ start: string; end: string }>;
  isFree: boolean;
};

export type ScheduleOkResponse = {
  ok: true;
  eventId: string;
  htmlLink: string | null;
  meetLink: string | null;
};

export type ScheduleConflictResponse = {
  ok: false;
  reason: "conflict";
  busy: Array<{ start: string; end: string }>;
};

export type ScheduleResponse = ScheduleOkResponse | ScheduleConflictResponse;

type ApiError = { error: string };

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------

// In Production (Vercel), VITE_BACKEND_URL will be set to your Render URL.
// In Development (Localhost), it is undefined, so we use "" (which implies relative path /api).
const BASE_URL = import.meta.env.VITE_BACKEND_URL || "";

// ------------------------------------------------------------------
// HELPER
// ------------------------------------------------------------------

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Construct the full URL. 
  // e.g. "https://vikara-backend.onrender.com/api/health" OR "/api/health"
  const url = `${BASE_URL}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as ApiError;
      if (err?.error) msg = err.error;
    } catch {
      // ignore JSON parse errors if response isn't JSON
    }
    throw new Error(msg);
  }

  return (await res.json()) as T;
}

// ------------------------------------------------------------------
// SERVICE
// ------------------------------------------------------------------

export const BackendCalendar = {
  health: () => apiFetch<{ ok: boolean }>("/api/health"),

  authStatus: () => apiFetch<AuthStatusResponse>("/api/auth/status"),

  authUrl: () => apiFetch<{ url: string }>("/api/auth/url"),

  logout: () =>
    apiFetch<{ ok: boolean }>("/api/auth/logout", {
      method: "POST"
    }),

  listEvents: (timeMin: string, timeMax: string) => 
    apiFetch<BackendEvent[]>(`/api/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`),

  freeBusy: (timeMin: string, timeMax: string) =>
    apiFetch<FreeBusyResponse>("/api/calendar/freebusy", {
      method: "POST",
      body: JSON.stringify({ timeMin, timeMax })
    }),

  schedule: (payload: {
    title: string;
    attendeeEmail: string;
    attendeeName?: string;
    startIso: string;
    endIso: string;
    timezone?: string;
    description?: string;
  }) =>
    apiFetch<ScheduleResponse>("/api/calendar/schedule", {
      method: "POST",
      body: JSON.stringify(payload)
    })
};