/**
 * BackendCalendar Service - Production Version
 * Handles all communication with the Vikara backend
 * Configured for Vite + Vercel + Render
 */

// 1. Explicitly export the BackendEvent interface
// This fixes the import error in App.tsx
export interface BackendEvent {
  id: string;
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
  organizer?: { email: string };
  htmlLink?: string;
  attendees?: { email: string }[];
}

export class BackendCalendar {
  private static baseUrl: string = "";
  private static sessionId: string | null = null;
  private static initialized = false;

  /**
   * Initialize the service with backend URL from environment
   * Handles Vite environment variables correctly
   */
  static initialize(): void {
    if (this.initialized) return;

    // FIX: Use import.meta.env for Vite environment (Vercel)
    this.baseUrl = import.meta.env.VITE_BACKEND_URL || "";
    
    // Fallback for local dev if env var is missing
    if (!this.baseUrl && typeof window !== "undefined" && window.location.hostname === "localhost") {
        console.warn("VITE_BACKEND_URL missing, defaulting to localhost:8000");
        this.baseUrl = "http://localhost:8000"; 
    }

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const sessionFromUrl = params.get("session");
      
      if (sessionFromUrl) {
        // We just got redirected back from Google
        this.sessionId = sessionFromUrl;
        sessionStorage.setItem("vikara_session_id", sessionFromUrl);
        // Clean the URL so the user doesn't see the messy session ID
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        // Try to restore from storage
        this.sessionId = sessionStorage.getItem("vikara_session_id");
      }
    }

    this.initialized = true;
  }

  static async authUrl(): Promise<{ url: string }> {
    if (!this.initialized) this.initialize();
    
    try {
      const res = await fetch(`${this.baseUrl}/api/auth/url`);
      if (!res.ok) throw new Error("Backend unreachable");
      return res.json();
    } catch (e) {
      console.error("Failed to get auth URL:", e);
      throw e;
    }
  }

  static async authStatus(): Promise<{ connected: boolean; email?: string; sessionId?: string }> {
    if (!this.initialized) this.initialize();
    
    let url = `${this.baseUrl}/api/auth/status`;
    if (this.sessionId) url += `?session=${this.sessionId}`;
    
    try {
        const res = await fetch(url);
        if (!res.ok) return { connected: false };
        const data = await res.json();
        
        // If backend returns a valid session, ensure we sync it
        if (data.connected && data.sessionId) {
            this.sessionId = data.sessionId;
            sessionStorage.setItem("vikara_session_id", data.sessionId);
        }
        return data;
    } catch (e) {
        // Fail silently so the UI just shows "Disconnected"
        return { connected: false };
    }
  }

  static async logout(): Promise<void> {
    if (!this.initialized) this.initialize();

    let url = `${this.baseUrl}/api/auth/logout`;
    if (this.sessionId) url += `?session=${this.sessionId}`;
    
    try {
        await fetch(url, { method: "POST" });
    } catch (e) {
        console.warn("Logout failed on server, clearing local anyway");
    }
    
    this.sessionId = null;
    sessionStorage.removeItem("vikara_session_id");
  }

  static async freeBusy(timeMin: string, timeMax: string) {
    if (!this.initialized) this.initialize();

    const url = new URL(`${this.baseUrl}/api/calendar/freebusy`);
    url.searchParams.append("timeMin", timeMin);
    url.searchParams.append("timeMax", timeMax);
    if (this.sessionId) url.searchParams.append("session", this.sessionId);
    
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("FreeBusy check failed");
    return res.json();
  }

  static async schedule(payload: any) {
    if (!this.initialized) this.initialize();

    let url = `${this.baseUrl}/api/calendar/schedule`;
    if (this.sessionId) url += `?session=${this.sessionId}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Scheduling failed");
    return data;
  }

  static async listEvents(timeMin: string, timeMax: string): Promise<BackendEvent[]> {
    if (!this.initialized) this.initialize();
    
    const url = new URL(`${this.baseUrl}/api/calendar/events`);
    url.searchParams.append("timeMin", timeMin);
    url.searchParams.append("timeMax", timeMax);
    if (this.sessionId) url.searchParams.append("session", this.sessionId);

    try {
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error("Failed to fetch events");
        const data = await res.json();
        return data.events || [];
    } catch (e) {
        console.error("Fetch events failed", e);
        return [];
    }
  }
}

// Auto-initialize if running in browser
if (typeof window !== "undefined") {
  BackendCalendar.initialize();
}