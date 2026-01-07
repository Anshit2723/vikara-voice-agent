import express from "express";
import cors, { CorsOptions } from "cors";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import dotenv from "dotenv";
import fs from "fs";

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();
const PORT = process.env.PORT || 8000;

// ============================================================================
// ENVIRONMENT VARIABLES (Production Only - No Fallbacks)
// ============================================================================

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || "Asia/Kolkata";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN!;
const TOKEN_PATH = process.env.GOOGLE_TOKEN_PATH || "./token.json";
const NODE_ENV = process.env.NODE_ENV || "production";

// ============================================================================
// VALIDATION - All Required Env Vars Must Be Present
// ============================================================================

const requiredEnvs = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "FRONTEND_ORIGIN",
];

const missing = requiredEnvs.filter((e) => !process.env[e]);

if (missing.length) {
  console.error("❌ CRITICAL: Missing required environment variables:");
  missing.forEach((e) => console.error(`   - ${e}`));
  console.error("\n⚠️  Cannot start in production without all env vars!");
  process.exit(1);
}

console.log("✅ Environment validation passed");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("📍 Configuration:");
console.log(`   Environment: ${NODE_ENV}`);
console.log(`   Frontend Origin: ${FRONTEND_ORIGIN}`);
console.log(`   OAuth Redirect: ${GOOGLE_REDIRECT_URI}`);
console.log(`   Calendar ID: ${GOOGLE_CALENDAR_ID}`);
console.log(`   Timezone: ${DEFAULT_TIMEZONE}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// ============================================================================
// CORS CONFIGURATION (Production Only)
// ============================================================================

const allowedOrigins: (string | RegExp)[] = [
  FRONTEND_ORIGIN,
  // Allow preview deployments (*.vercel.app)
  /^https:\/\/.*\.vercel\.app$/,
];

const corsOptions: CorsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());

// Log CORS requests in production for debugging
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (NODE_ENV === "production" && origin) {
    console.log(`[CORS] ${req.method} ${req.path} from ${origin}`);
  }
  next();
});

// ============================================================================
// SESSION STORAGE (In-Memory)
// NOTE: For production scaling, upgrade to Redis or database
// ============================================================================

interface SessionData {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  email?: string;
}

const sessions = new Map<string, SessionData>();

function generateSessionId(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

function createSession(
  userId: string,
  accessToken: string,
  refreshToken?: string
): string {
  const sessionId = generateSessionId();
  sessions.set(sessionId, {
    userId,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + 3600000, // 1 hour
    email: undefined,
  });
  console.log(`[Session] Created: ${sessionId.substring(0, 8)}...`);
  return sessionId;
}

function getSession(sessionId: string): SessionData | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    console.log(`[Session] Expired: ${sessionId.substring(0, 8)}...`);
    return null;
  }

  return session;
}

function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
  console.log(`[Session] Deleted: ${sessionId.substring(0, 8)}...`);
}

// ============================================================================
// GOOGLE OAUTH2 CLIENT
// ============================================================================

const oauth2Client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

// Load tokens from file if they exist
function loadTokens(): void {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
      oauth2Client.setCredentials(tokens);
      console.log("✅ OAuth tokens loaded from file");
    }
  } catch (error) {
    console.warn("⚠️  Could not load cached tokens (first login?)");
  }
}

function saveTokens(tokens: any): void {
  try {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log("✅ OAuth tokens saved to file");
  } catch (error) {
    console.error("❌ Error saving tokens:", error);
  }
}

loadTokens();

// ============================================================================
// API ENDPOINTS
// ============================================================================

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Vikara Backend running",
    environment: NODE_ENV,
  });
});

// Get OAuth URL
app.get("/api/auth/url", (req, res) => {
  try {
    const scopes = [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",
    });

    console.log("[Auth] Generated OAuth URL");
    res.json({ url: authUrl });
  } catch (error: any) {
    console.error("❌ Error generating auth URL:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Handle OAuth callback
app.get("/api/auth/callback", async (req, res) => {
  try {
    const code = req.query.code;
    
    // Strict type check for code
    if (typeof code !== "string" || !code) {
      console.error("[Auth] No authorization code provided");
      return res.status(400).json({ error: "No authorization code provided" });
    }

    console.log("[Auth] Processing OAuth callback");
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    saveTokens(tokens);

    const sessionId = createSession(
      "user_" + Date.now(),
      tokens.access_token!,
      tokens.refresh_token || undefined
    );

    // Redirect to frontend with session ID
    const redirectUrl = new URL(FRONTEND_ORIGIN);
    redirectUrl.searchParams.set("session", sessionId);

    console.log("[Auth] Redirecting to: " + FRONTEND_ORIGIN);
    res.redirect(redirectUrl.toString());
  } catch (error: any) {
    console.error("❌ Error handling callback:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Check auth status
app.get("/api/auth/status", (req, res) => {
  try {
    // FIX: Strict type handling for TS2345
    const sessionIdRaw = req.query.session;
    const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw : "";

    if (!sessionId) {
      const credentials = oauth2Client.credentials;
      const connected = Boolean(credentials.access_token);
      return res.json({ connected, sessionId: null });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.json({ connected: false, sessionId: null });
    }

    res.json({ connected: true, sessionId, email: session.email });
  } catch (error: any) {
    console.error("❌ Error checking auth status:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  try {
    // FIX: Strict type handling for TS2345
    const sessionIdRaw = req.query.session;
    const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw : "";

    if (sessionId) {
      deleteSession(sessionId);
    }
    oauth2Client.revokeCredentials();
    if (fs.existsSync(TOKEN_PATH)) {
      fs.unlinkSync(TOKEN_PATH);
    }
    console.log("[Auth] User logged out");
    res.json({ message: "Logged out successfully" });
  } catch (error: any) {
    console.error("❌ Error logging out:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get free/busy information
app.get("/api/calendar/freebusy", async (req, res) => {
  try {
    const { timeMin, timeMax } = req.query;

    if (typeof timeMin !== "string" || typeof timeMax !== "string") {
      return res.status(400).json({
        error: "Missing or invalid parameters: timeMin, timeMax",
      });
    }

    console.log(`[Calendar] Checking availability: ${timeMin} - ${timeMax}`);
    
    // Check if we have a session token to use
    const sessionIdRaw = req.query.session;
    const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw : "";
    let auth = oauth2Client;

    if (sessionId) {
        const session = getSession(sessionId);
        if (session) {
            const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
            client.setCredentials({ access_token: session.accessToken, refresh_token: session.refreshToken });
            auth = client as any;
        }
    }

    const calendar = google.calendar({ version: "v3", auth });

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: [{ id: GOOGLE_CALENDAR_ID }],
      },
    });

    const busySegments =
      response.data.calendars?.[GOOGLE_CALENDAR_ID]?.busy || [];
    const isFree = busySegments.length === 0;

    console.log(`[Calendar] ${isFree ? "✅ Free" : "❌ Busy"}`);
    res.json({
      isFree,
      busy: busySegments,
      timeMin,
      timeMax,
    });
  } catch (error: any) {
    console.error("❌ Error querying free/busy:", error.message);
    res.status(500).json({
      error: error.message || "Failed to query calendar",
      details: error.errors?.[0]?.message,
    });
  }
});

// Schedule a meeting
app.post("/api/calendar/schedule", async (req, res) => {
  try {
    const {
      title,
      attendeeEmail,
      attendeeName,
      startIso,
      endIso,
      timezone,
      description,
    } = req.body;

    // Validate required fields
    if (!title || !attendeeEmail || !startIso || !endIso) {
      return res.status(400).json({
        ok: false,
        error:
          "Missing required fields: title, attendeeEmail, startIso, endIso",
      });
    }

    // Check if we have a session token to use
    const sessionIdRaw = req.query.session;
    const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw : "";
    let auth = oauth2Client;

    if (sessionId) {
        const session = getSession(sessionId);
        if (session) {
            const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
            client.setCredentials({ access_token: session.accessToken, refresh_token: session.refreshToken });
            auth = client as any;
        }
    }

    console.log(`[Calendar] Scheduling: "${title}" with ${attendeeEmail}`);
    const calendar = google.calendar({ version: "v3", auth });

    const event = {
      summary: title,
      description: description || "",
      start: {
        dateTime: startIso,
        timeZone: timezone || DEFAULT_TIMEZONE,
      },
      end: {
        dateTime: endIso,
        timeZone: timezone || DEFAULT_TIMEZONE,
      },
      attendees: [
        {
          email: attendeeEmail,
          displayName: attendeeName || attendeeEmail,
        },
      ],
      conferenceData: {
        createRequest: {
          requestId: Math.random().toString(36).substring(7),
          conferenceSolutionKey: { type: "hangoutsMeet" }
        }
      }
    };

    const response = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody: event,
      sendUpdates: "all",
      conferenceDataVersion: 1
    });

    console.log(`[Calendar] ✅ Event created: ${response.data?.id}`);
    res.json({
      ok: true,
      eventId: response.data?.id,
      eventLink: response.data?.htmlLink,
      message: `Meeting "${title}" scheduled with ${attendeeEmail}`,
    });
  } catch (error: any) {
    console.error("❌ Error scheduling meeting:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to schedule meeting",
      details: error.errors?.[0]?.message,
    });
  }
});

// List upcoming events
app.get("/api/calendar/events", async (req, res) => {
  try {
    const { timeMin, timeMax, maxResults = "10" } = req.query;

    if (typeof timeMin !== "string" || typeof timeMax !== "string") {
      return res.status(400).json({
        error: "Missing required parameters: timeMin, timeMax",
      });
    }

    // Check if we have a session token to use
    const sessionIdRaw = req.query.session;
    const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw : "";
    let auth = oauth2Client;

    if (sessionId) {
        const session = getSession(sessionId);
        if (session) {
            const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
            client.setCredentials({ access_token: session.accessToken, refresh_token: session.refreshToken });
            auth = client as any;
        }
    }

    console.log(`[Calendar] Listing events: ${timeMin} - ${timeMax}`);
    const calendar = google.calendar({ version: "v3", auth });

    const response = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin: String(timeMin),
      timeMax: String(timeMax),
      maxResults: parseInt(String(maxResults)),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items || [];
    console.log(`[Calendar] Found ${events.length} events`);
    res.json({
      events,
      timeMin,
      timeMax,
    });
  } catch (error: any) {
    console.error("❌ Error listing events:", error.message);
    res.status(500).json({
      error: error.message || "Failed to list events",
      details: error.errors?.[0]?.message,
    });
  }
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("❌ Unhandled error:", err);
    res.status(500).json({
      error: "Internal server error",
      message: NODE_ENV === "development" ? err.message : undefined,
    });
  }
);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.path,
  });
});

// ============================================================================
// START SERVER
// ============================================================================

const server = app.listen(PORT, () => {
  console.log("\n");
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║                                                            ║");
  console.log("║           ✅ VIKARA BACKEND - PRODUCTION READY            ║");
  console.log("║                                                            ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${NODE_ENV}`);
  console.log(`📍 Frontend: ${FRONTEND_ORIGIN}`);
  console.log(`🔐 OAuth Redirect: ${GOOGLE_REDIRECT_URI}`);
  console.log("\n📚 Available endpoints:");
  console.log("   GET  /health                        - Server health");
  console.log("   GET  /api/auth/url                  - Get OAuth URL");
  console.log("   GET  /api/auth/callback             - OAuth callback");
  console.log("   GET  /api/auth/status               - Check auth status");
  console.log("   POST /api/auth/logout               - Logout");
  console.log("   GET  /api/calendar/freebusy         - Check availability");
  console.log("   POST /api/calendar/schedule         - Schedule meeting");
  console.log("   GET  /api/calendar/events           - List events");
  console.log("\n");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n📴 SIGTERM received, shutting down gracefully...");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

export default app;