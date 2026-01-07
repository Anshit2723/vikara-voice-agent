import { google } from "googleapis";
import { z } from "zod";
import { env } from "./env.js";
import { getAuthedClientOrThrow } from "./googleAuth.js";

const freeBusySchema = z.object({
  timeMin: z.string().min(1),
  timeMax: z.string().min(1)
});

const scheduleSchema = z.object({
  title: z.string().min(2),
  attendeeEmail: z.string().email(), // required
  attendeeName: z.string().optional(),
  startIso: z.string().min(1),
  endIso: z.string().min(1),
  timezone: z.string().optional(),
  description: z.string().optional()
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractMeetLink(event: any): string | null {
  // Best-effort extraction: either direct hangoutLink or entryPoints.uri. [web:34][web:301]
  const direct = event?.hangoutLink;
  if (typeof direct === "string" && direct.startsWith("http")) return direct;

  const entryPoints = event?.conferenceData?.entryPoints;
  if (Array.isArray(entryPoints)) {
    const video = entryPoints.find((ep: any) => ep?.entryPointType === "video" && ep?.uri);
    if (video?.uri) return String(video.uri);
  }
  return null;
}

export function calendarApi() {
  const auth = getAuthedClientOrThrow();
  return google.calendar({ version: "v3", auth });
}

export async function freeBusyQuery(input: unknown) {
  const req = freeBusySchema.parse(input);
  const cal = calendarApi();

  const res = await cal.freebusy.query({
    requestBody: {
      timeMin: req.timeMin,
      timeMax: req.timeMax,
      items: [{ id: env.GOOGLE_CALENDAR_ID }]
    }
  });

  const busy = res.data.calendars?.[env.GOOGLE_CALENDAR_ID]?.busy ?? [];
  return { busy, isFree: busy.length === 0 };
}

export async function scheduleMeeting(input: unknown) {
  const req = scheduleSchema.parse(input);
  const cal = calendarApi();

  const tz = req.timezone || env.DEFAULT_TIMEZONE;

  // 1) Check availability first
  const fb = await freeBusyQuery({ timeMin: req.startIso, timeMax: req.endIso });
  if (!fb.isFree) {
    return { ok: false, reason: "conflict", busy: fb.busy };
  }

  // 2) Create event with Meet request.
  // Meet creation requires conferenceData + conferenceDataVersion=1. [web:101][web:34]
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const insert = await cal.events.insert({
    calendarId: env.GOOGLE_CALENDAR_ID,
    conferenceDataVersion: 1,
    sendUpdates: "all",
    requestBody: {
      summary: req.title,
      description: req.description || "",
      start: { dateTime: req.startIso, timeZone: tz },
      end: { dateTime: req.endIso, timeZone: tz },
      attendees: [
        {
          email: req.attendeeEmail,
          displayName: req.attendeeName || req.attendeeEmail
        }
      ],
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: "hangoutsMeet" }
        }
      }
    }
  });

  const eventId = insert.data.id || "";
  let meetLink = extractMeetLink(insert.data);

  // 3) Meet link may appear after insert; poll events.get briefly. [web:34][web:301]
  if (!meetLink && eventId) {
    for (let attempt = 0; attempt < 10; attempt++) {
      await sleep(800);

      // Cast to any to avoid TS overload mismatch in googleapis typings.
      const got = await (cal.events.get as any)({
        calendarId: env.GOOGLE_CALENDAR_ID,
        eventId,
        conferenceDataVersion: 1
      });

      meetLink = extractMeetLink(got?.data);
      if (meetLink) break;
    }
  }

  return {
    ok: true,
    eventId,
    htmlLink: insert.data.htmlLink || null,
    meetLink
  };
}
export async function listEvents(timeMin: string, timeMax: string) {
  const cal = calendarApi();
  
  // Use the server's authenticated client to fetch events
  const res = await cal.events.list({
    calendarId: env.GOOGLE_CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
  });

  return res.data.items || [];
}