import express from "express";
import cors from "cors";

import { env } from "./env.js";
import { getAuthUrl, oauthClient, saveToken, loadToken, clearToken } from "./googleAuth.js";
import { freeBusyQuery, scheduleMeeting , listEvents } from "./calendar.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
    credentials: false
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/auth/status", (_req, res) => {
  res.json({ connected: Boolean(loadToken()) });
});

app.get("/api/auth/url", (_req, res) => {
  res.json({ url: getAuthUrl() });
});

app.get("/api/auth/callback", async (req, res) => {
  const code = String(req.query.code || "");
  if (!code) return res.status(400).send("Missing code");

  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  saveToken(tokens);

  // Simple UX: show a message and let user close tab.
  res.type("html").send(`
    <html>
      <body style="font-family: sans-serif; padding: 24px;">
        <h2>Calendar connected ✅</h2>
        <p>You can close this tab and return to the app.</p>
      </body>
    </html>
  `);
});

app.post("/api/auth/logout", (_req, res) => {
  clearToken();
  res.json({ ok: true });
});

app.post("/api/calendar/freebusy", async (req, res) => {
  try {
    const out = await freeBusyQuery(req.body);
    res.json(out);
  } catch (e: any) {
    res.status(e?.statusCode || 400).json({ error: e?.message || "Bad request" });
  }
});

app.post("/api/calendar/schedule", async (req, res) => {
  try {
    const out = await scheduleMeeting(req.body);
    res.json(out);
  } catch (e: any) {
    res.status(e?.statusCode || 400).json({ error: e?.message || "Bad request" });
  }
});

app.get("/api/calendar/events", async (req, res) => {
  try {
    const { timeMin, timeMax } = req.query;
    
    // Basic validation
    if (!timeMin || !timeMax) {
      return res.status(400).json({ error: "Missing timeMin or timeMax query parameters" });
    }

    const events = await listEvents(String(timeMin), String(timeMax));
    res.json(events);
  } catch (e: any) {
    // If token is missing (not logged in), 401 is appropriate
    const status = e.message.includes("Calendar not connected") ? 401 : 500;
    res.status(status).json({ error: e.message || "Failed to fetch events" });
  }
});

app.listen(env.PORT, () => {
  console.log(`Vikara server running on http://localhost:${env.PORT}`);
});
