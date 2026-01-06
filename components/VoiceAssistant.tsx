import React, { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, Type, FunctionDeclaration } from "@google/genai";
import {
  Mic,
  Calendar,
  AlertCircle,
  LogOut,
  Play,
  Info,
  CheckCircle2,
  Activity,
} from "lucide-react";
import { createBlob, decode, pcmToFloat32 } from "../services/audioUtils";
import { BackendCalendar } from "../services/backendCalendar";

type Props = {
  onRefresh: () => void;
};

type Mode = "sandbox" | "real";

function getBrowserTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}

function normalizeEmail(raw: unknown): string {
  let s = String(raw ?? "").trim().toLowerCase();

  s = s
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+underscore\s+/g, "_")
    .replace(/\s+dash\s+/g, "-")
    .replace(/\s+hyphen\s+/g, "-");

  s = s.replace(/\bat\b/g, "@").replace(/\bdot\b/g, ".");
  s = s.replace(/\s+/g, "");
  s = s.replace(/^[^\w]+/, "").replace(/[^\w]+$/, "");

  return s;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function pickMissingScheduleFields(args: any): string[] {
  const missing: string[] = [];
  if (!args?.title) missing.push("title");
  if (!args?.attendeeEmail) missing.push("attendeeEmail");
  if (!args?.startIso) missing.push("startIso");
  if (!args?.endIso) missing.push("endIso");
  return missing;
}

function pickMissingFreeBusyFields(args: any): string[] {
  const missing: string[] = [];
  if (!args?.timeMin) missing.push("timeMin");
  if (!args?.timeMax) missing.push("timeMax");
  return missing;
}

const VoiceAssistant: React.FC<Props> = ({ onRefresh }) => {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const [mode, setMode] = useState<Mode>("sandbox");
  const [organizerConnected, setOrganizerConnected] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const refreshAuthStatus = useCallback(async () => {
    try {
      const s = await BackendCalendar.authStatus();
      setOrganizerConnected(Boolean(s.connected));
      if (s.connected && mode === "sandbox") {
        setStatus("Calendar connected (Ready for Real Mode)");
      }
    } catch (e: any) {
      console.warn("Backend check failed (Is server running?)", e);
    }
  }, [mode]);

  useEffect(() => {
    refreshAuthStatus();
  }, [refreshAuthStatus]);

  const stopSession = useCallback(() => {
    console.log("[System] Stopping Session...");
    try {
      sessionRef.current?.close?.();
    } catch {}
    sessionRef.current = null;

    try {
      audioContextRef.current?.close();
    } catch {}
    try {
      outputAudioContextRef.current?.close();
    } catch {}
    audioContextRef.current = null;
    outputAudioContextRef.current = null;

    sourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {}
    });
    sourcesRef.current.clear();

    setIsActive(false);
    setStatus("Session Ended");
    setAudioLevel(0);
    onRefresh();
  }, [onRefresh]);

  const connectOrganizerCalendar = useCallback(async () => {
    setErrorMessage(null);
    setIsConnecting(true);
    try {
      const { url } = await BackendCalendar.authUrl();
      window.open(url, "_blank", "noopener,noreferrer");

      const start = Date.now();
      while (Date.now() - start < 60000) {
        await new Promise((r) => setTimeout(r, 1500));
        const s = await BackendCalendar.authStatus();
        if (s.connected) {
          setOrganizerConnected(true);
          setStatus("Connected Successfully ✅");
          setIsConnecting(false);
          return;
        }
      }
      throw new Error("Timeout waiting for Google Login.");
    } catch (e: any) {
      setIsConnecting(false);
      setErrorMessage(e?.message || "Auth failed");
    }
  }, []);

  const signOutOrganizer = useCallback(async () => {
    try {
      await BackendCalendar.logout();
      setOrganizerConnected(false);
      setMode("sandbox");
      setStatus("Disconnected. Switched to Sandbox.");
    } catch {
      setErrorMessage("Logout failed");
    }
  }, []);

  const calendarTools: FunctionDeclaration[] = [
    {
      name: "check_availability",
      description:
        "Check if a time slot is available on the organizer's Google Calendar.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          timeMin: {
            type: Type.STRING,
            description:
              "Start timestamp in RFC3339/ISO 8601 with timezone offset. Example: 2026-01-06T17:00:00+05:30",
          },
          timeMax: {
            type: Type.STRING,
            description:
              "End timestamp in RFC3339/ISO 8601 with timezone offset. Example: 2026-01-06T17:30:00+05:30",
          },
        },
        required: ["timeMin", "timeMax"],
      },
    },
    {
      name: "schedule_meeting",
      description:
        "Book a meeting on the organizer's Google Calendar. Only call when you have all required fields.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Meeting title" },
          attendeeEmail: {
            type: Type.STRING,
            description:
              "Attendee email address (required). If user says 'at'/'dot', convert to @/.",
          },
          attendeeName: { type: Type.STRING, description: "Optional name" },
          startIso: {
            type: Type.STRING,
            description:
              "Start timestamp in RFC3339/ISO 8601 with timezone offset",
          },
          endIso: {
            type: Type.STRING,
            description:
              "End timestamp in RFC3339/ISO 8601 with timezone offset",
          },
          timezone: {
            type: Type.STRING,
            description: "IANA timezone like Asia/Kolkata (optional)",
          },
          description: { type: Type.STRING, description: "Optional notes" },
        },
        required: ["title", "attendeeEmail", "startIso", "endIso"],
      },
    },
  ];

  const startSession = useCallback(async () => {
    setErrorMessage(null);

    // IMPORTANT: your Vite config exposes GEMINIAPIKEY as process.env.APIKEY in browser
    const apiKey = process.env.API_KEY;
    console.log("[Env] process.env.APIKEY present?", Boolean(apiKey));

    if (!apiKey) {
      setErrorMessage(
        "Missing Gemini API key. Ensure .env.local has GEMINIAPIKEY and restart dev server."
      );
      return;
    }

    try {
      const tz = getBrowserTz();

      if (!outputAudioContextRef.current) {
        outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
      }
      if (outputAudioContextRef.current.state === "suspended") {
        await outputAudioContextRef.current.resume();
      }

      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const ai = new GoogleGenAI({ apiKey });

      const sessionPromise = ai.live.connect({
        model: "gemini-2.0-flash-exp",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
          },
          tools: [{ functionDeclarations: calendarTools }],
          systemInstruction: `
You are Vikara, a fast voice assistant.
Current date: ${new Date().toDateString()}.
Assume user timezone: ${tz} if not specified.

Rules:
- Users speak naturally; never ask them for ISO format.
- If user asks "am I free", call check_availability with timeMin/timeMax in RFC3339/ISO with timezone.
- If user asks to book/schedule, only call schedule_meeting when you have: title, attendeeEmail, start time, end time.
- If the attendee email is unclear, ask the user to repeat it slowly like: name at domain dot com.
          `.trim(),
        },
        callbacks: {
          onopen: () => {
            console.log("✅ [Gemini] WebSocket Connected!");
            setStatus("Listening...");
          },
          onclose: (e) => {
            console.log("❌ [Gemini] WebSocket Closed", e);
            setStatus("Disconnected");
          },
          onerror: (e) => {
            console.error("🔥 [Gemini] Error:", e);
            setErrorMessage("Connection Error. See Console.");
            stopSession();
          },
          onmessage: async (message: any) => {
            // Audio output
            const audioData =
              message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              try {
                const rawBytes = decode(audioData);
                const float32Data = pcmToFloat32(rawBytes.buffer as ArrayBuffer);

                const buffer = ctx.createBuffer(1, float32Data.length, 24000);
                buffer.getChannelData(0).set(float32Data);

                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);

                const currentTime = ctx.currentTime;
                if (nextStartTimeRef.current < currentTime) {
                  nextStartTimeRef.current = currentTime;
                }

                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += buffer.duration;

                sourcesRef.current.add(source);
                source.onended = () => sourcesRef.current.delete(source);
              } catch (err) {
                console.error("[Audio] Decode Error:", err);
              }
            }

            // Tool calls
            if (message.toolCall?.functionCalls?.length) {
              console.log(
                "🛠️ [Gemini] Tool Call:",
                message.toolCall.functionCalls[0].name
              );

              for (const fc of message.toolCall.functionCalls) {
                const name = fc.name;
                const args = fc.args;

                console.log("[Tool] Args:", name, args);

                let response: any = { error: "Unknown Error" };

                try {
                  if (mode === "sandbox") {
                    if (name === "check_availability")
                      response = { isFree: true, busy: [] };
                    if (name === "schedule_meeting")
                      response = { ok: true, note: "Sandbox Booking Confirmed" };
                  } else {
                    console.log(`[Tool] Calling Backend: ${name}`);

                    if (name === "check_availability") {
                      const missing = pickMissingFreeBusyFields(args);
                      if (missing.length) {
                        response = {
                          error: `Missing required fields: ${missing.join(
                            ", "
                          )}`,
                        };
                      } else {
                        response = await BackendCalendar.freeBusy(
                          String(args.timeMin),
                          String(args.timeMax)
                        );
                      }
                    }

                    if (name === "schedule_meeting") {
                      if (!organizerConnected)
                        throw new Error("Calendar not connected");

                      const missing = pickMissingScheduleFields(args);
                      if (missing.length) {
                        response = {
                          ok: false,
                          error: `Missing required fields: ${missing.join(", ")}`,
                        };
                      } else {
                        const cleanedEmail = normalizeEmail(args.attendeeEmail);
                        if (!isValidEmail(cleanedEmail)) {
                          response = {
                            ok: false,
                            error:
                              "Invalid email. Please repeat slowly like: name at domain dot com.",
                          };
                        } else {
                          const payload = { ...args, attendeeEmail: cleanedEmail };
                          response = await BackendCalendar.schedule(payload);
                        }
                      }
                    }
                  }
                } catch (e: any) {
                  console.error("[Tool] Failed:", e);
                  response = { error: e.message || "Tool failed" };
                }

                sessionPromise.then((s) =>
                  s.sendToolResponse({
                    functionResponses: [{ id: fc.id, name, response }],
                  })
                );
              }
            }
          },
        },
      });

      // Stream mic
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(
        4096,
        1,
        1
      );

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < inputData.length; i++) sum += inputData[i] ** 2;
        const rms = Math.sqrt(sum / inputData.length);
        setAudioLevel(Math.min(1, rms * 5));

        sessionPromise.then((s) => {
          s.sendRealtimeInput({
            media: createBlob(inputData),
          });
        });
      };

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);

      sessionRef.current = await sessionPromise;
      setIsActive(true);
    } catch (e: any) {
      console.error("🔥 [Session] Init Failed:", e);
      setErrorMessage(e?.message || "Failed to start audio");
      stopSession();
    }
  }, [calendarTools, mode, organizerConnected, stopSession]);

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in zoom-in-95 duration-500">
      <div className="glass p-10 rounded-[3rem] border border-[color:var(--border)] space-y-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
          <Calendar size={180} />
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-6 z-10 relative">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-600/20 rounded-2xl flex items-center justify-center border border-blue-500/30">
              <CheckCircle2 className="text-blue-400" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black italic tracking-tighter text-[var(--text)]">
                VIKARA AGENT
              </h2>
              <div className="flex items-center gap-2 text-xs font-bold text-[var(--muted)] uppercase tracking-widest">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isActive ? "bg-green-500 animate-pulse" : "bg-slate-400/60"
                  }`}
                ></span>
                {status}
              </div>
            </div>
          </div>

          {/* Theme-aware mode switcher */}
          <div className="flex items-center gap-2 bg-[var(--chip)] p-1.5 rounded-2xl border border-[var(--chip-border)]">
            <button
              onClick={() => setMode("sandbox")}
              disabled={isActive}
              className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                mode === "sandbox"
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-600/25"
                  : "text-[var(--chip-text)] hover:bg-black/10 hover:text-[var(--text)]"
              }`}
            >
              Sandbox
            </button>
            <button
              onClick={() => setMode("real")}
              disabled={isActive}
              className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                mode === "real"
                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/25"
                  : "text-[var(--chip-text)] hover:bg-black/10 hover:text-[var(--text)]"
              }`}
            >
              Real Mode
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center py-10 z-10 relative">
          <div
            className="relative group cursor-pointer"
            onClick={isActive ? stopSession : startSession}
          >
            <div
              className={`absolute inset-0 rounded-full blur-[80px] transition-all duration-75 ${
                isActive ? "bg-blue-500/50" : "bg-transparent"
              }`}
              style={{ transform: `scale(${1 + audioLevel})` }}
            ></div>

            <div
              className={`relative w-40 h-40 rounded-full flex items-center justify-center border-4 transition-all duration-500 ${
                isActive
                  ? "bg-red-500 border-red-400"
                  : "bg-black/20 border-[color:var(--border)] hover:border-blue-500/60"
              }`}
            >
              {isActive ? (
                <Activity size={48} className="text-white animate-pulse" />
              ) : (
                <Mic size={48} className="text-[var(--muted)]" />
              )}
            </div>
          </div>

          <p className="mt-8 text-sm font-bold text-[var(--muted)] uppercase tracking-widest">
            {isActive
              ? `Input Level: ${(audioLevel * 100).toFixed(0)}%`
              : "Tap to speak"}
          </p>
        </div>

        {/* Theme-aware Real Mode panel */}
        {mode === "real" && (
          <div className="rounded-2xl p-6 border flex items-center justify-between gap-4 bg-[color:var(--panel)] border-[color:var(--panel-border)]">
            <div className="flex items-center gap-3">
              <Info size={18} className="text-[var(--muted)]" />
              <p className="text-xs text-[var(--muted)] font-medium">
                To use Real Mode, you must grant calendar access.
              </p>
            </div>

            {organizerConnected ? (
              <button
                onClick={signOutOrganizer}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-500 rounded-lg text-xs font-bold uppercase tracking-wider border border-red-500/20 hover:bg-red-500/15 transition-colors"
              >
                <LogOut size={14} /> Disconnect
              </button>
            ) : (
              <button
                onClick={connectOrganizerCalendar}
                disabled={isConnecting}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-blue-500 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Play size={14} /> {isConnecting ? "Connecting..." : "Connect Google"}
              </button>
            )}
          </div>
        )}

        {errorMessage && (
          <div className="absolute bottom-6 left-0 right-0 flex justify-center">
            <div className="bg-red-500/90 text-white px-6 py-3 rounded-full text-xs font-bold flex items-center gap-2 shadow-xl">
              <AlertCircle size={16} />
              {errorMessage}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceAssistant;
