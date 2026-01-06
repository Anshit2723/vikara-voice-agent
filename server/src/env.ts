import dotenv from "dotenv";
dotenv.config();

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const env = {
  PORT: parseInt(process.env.PORT || "8000", 10),
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || "http://localhost:3000",

  GOOGLE_CLIENT_ID: req("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: req("GOOGLE_CLIENT_SECRET"),
  GOOGLE_REDIRECT_URI: req("GOOGLE_REDIRECT_URI"),
  GOOGLE_TOKEN_PATH: process.env.GOOGLE_TOKEN_PATH || "./token.json",

  GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID || "primary",
  DEFAULT_TIMEZONE: process.env.DEFAULT_TIMEZONE || "Asia/Kolkata"
};
