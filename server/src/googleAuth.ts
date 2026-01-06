import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { env } from "./env.js";

const tokenPathAbs = path.resolve(process.cwd(), env.GOOGLE_TOKEN_PATH);

export function oauthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(): string {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      // Create/update events and invite attendees. [web:160]
      "https://www.googleapis.com/auth/calendar.events",
      // Free/busy checks.
      "https://www.googleapis.com/auth/calendar.readonly"
    ]
  });
}

export function saveToken(token: unknown) {
  fs.writeFileSync(tokenPathAbs, JSON.stringify(token, null, 2), "utf-8");
}

export function loadToken(): any | null {
  // 1. First, check if we have the token in the environment (Production/Cloud approach)
  if (process.env.GOOGLE_TOKEN_JSON) {
    try {
      return JSON.parse(process.env.GOOGLE_TOKEN_JSON);
    } catch (e) {
      console.error("Failed to parse GOOGLE_TOKEN_JSON env var");
    }
  }

  // 2. Fallback to local file system (Localhost development approach)
  if (!fs.existsSync(tokenPathAbs)) return null;
  const raw = fs.readFileSync(tokenPathAbs, "utf-8");
  return JSON.parse(raw);
}

export function clearToken() {
  if (fs.existsSync(tokenPathAbs)) fs.unlinkSync(tokenPathAbs);
}

export function getAuthedClientOrThrow() {
  const token = loadToken();
  if (!token) {
    const e: any = new Error("Calendar not connected. Authorize via /api/auth/url.");
    e.statusCode = 401;
    throw e;
  }
  const client = oauthClient();
  client.setCredentials(token);
  return client;
}
