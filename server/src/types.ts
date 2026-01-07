export type FreeBusyRequest = {
  timeMin: string; // ISO
  timeMax: string; // ISO
};

export type ScheduleRequest = {
  title: string;
  attendeeEmail: string;
  attendeeName?: string;
  startIso: string; // ISO
  endIso: string;   // ISO
  timezone?: string;
  description?: string;
};

export type ApiError = {
  error: string;
};
