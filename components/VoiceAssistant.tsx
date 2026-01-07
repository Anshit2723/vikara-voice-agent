import React, { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, Type } from "@google/genai";
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

// Helper: Get strict timezone info for the AI
function getTzInfo() {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Get offset in +/-HHMM format (e.g., -0500 or +0530)
  const offsetStr = now.toTimeString().split(' ')[1]?.replace("GMT", "") || "+0000";
  // Format to ISO style for prompt (e.g. -05:00)
  const offsetIso = offsetStr.slice(0, 3) + ":" + offsetStr.slice(3);
  return { tz, offsetIso };
}

const VoiceAssistant: React.FC<Props> = ({ onRefresh }) => {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const [mode, setMode] = useState<Mode>("sandbox");
  const [organizerConnected, setOrganizerConnected] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  
  // Gemini Session Refs
  const sessionRef = useRef<any>(null);
  const isConnectedRef = useRef<boolean>(false);

  // 1. Auth Status Check
  const refreshAuthStatus = useCallback(async () => {
    try {
      const s = await BackendCalendar.authStatus();
      setOrganizerConnected(Boolean(s.connected));
      if (s.connected && mode === "sandbox") {
        setStatus("Calendar connected (Switch to Real Mode)");
      }
    } catch (e: any) {
      console.warn("Backend check failed", e);
    }
  }, [mode]);

  useEffect(() => {
    refreshAuthStatus();
  }, [refreshAuthStatus]);

  // 2. Cleanup Function
  const stopSession = useCallback(() => {
    console.log("[System] Stopping Session...");

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch {}
      processorRef.current = null;
    }

    try { sessionRef.current?.close?.(); } catch {}
    sessionRef.current = null;

    try { audioContextRef.current?.close(); } catch {}
    try { outputAudioContextRef.current?.close(); } catch {}
    audioContextRef.current = null;
    outputAudioContextRef.current = null;

    isConnectedRef.current = false;
    setIsActive(false);
    setStatus("Session Ended");
    setAudioLevel(0);
    onRefresh();
  }, [onRefresh]);

  // 3. Connect to Google Auth
  const connectOrganizerCalendar = useCallback(async () => {
    setErrorMessage(null);
    setIsConnecting(true);
    try {
      const { url } = await BackendCalendar.authUrl();
      window.location.href = url;
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

  // 4. Start Gemini Session
  const startSession = useCallback(async () => {
    setErrorMessage(null);

    const apiKey = import.meta.env.VITE_API_KEY;
    if (!apiKey) {
      setErrorMessage("Missing API Key (VITE_API_KEY)");
      return;
    }

    try {
      const { tz, offsetIso } = getTzInfo();

      // Init Output Audio (24kHz for playback)
      outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
      
      // Init Input Audio (16kHz for Gemini)
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });

      const ai = new GoogleGenAI({ apiKey });

      // ESTABLISH CONNECTION ONCE
      const session = await ai.live.connect({
        model: "gemini-2.0-flash-exp",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Fenrir" } },
          },
          systemInstruction: `
            You are Vikara, an elite scheduling assistant.
            Current Date: ${new Date().toDateString()}.
            User Timezone: ${tz} (UTC Offset: ${offsetIso}).

            CRITICAL RULES:
            1. When calling 'schedule_meeting', ALWAYS convert user's relative time (e.g. "tomorrow at 5pm") 
               to a strict ISO 8601 string including the offset (${offsetIso}). 
               Example: 2026-11-26T17:00:00${offsetIso}.
            2. Be concise and professional.
            3. Use the 'googleSearch' tool if the user asks about dates, holidays, or facts.
            4.STAY FOCUSED: Do not engage in small talk, philosophy, or off-topic subjects. If the user strays, politely steer them back to their schedule.
          `,
          tools: [
            { googleSearch: {} },
            { functionDeclarations: [
                {
                  name: "schedule_meeting",
                  description: "Book a meeting. Requires title, email, startIso, endIso.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      attendeeEmail: { type: Type.STRING },
                      startIso: { type: Type.STRING, description: "ISO 8601 with Offset" },
                      endIso: { type: Type.STRING, description: "ISO 8601 with Offset" },
                      description: { type: Type.STRING }
                    },
                    required: ["title", "attendeeEmail", "startIso", "endIso"]
                  },
                }
            ]}
          ],
        },
        callbacks: {
            onopen: () => {
                isConnectedRef.current = true;
                setIsActive(true);
                setStatus("Listening...");
            },
            onclose: () => stopSession(),
            onmessage: async (msg: any) => {
                // A. Handle Audio Output
                const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audioData && outputAudioContextRef.current) {
                    const ctx = outputAudioContextRef.current;
                    const float32 = pcmToFloat32(decode(audioData).buffer);
                    const buffer = ctx.createBuffer(1, float32.length, 24000);
                    buffer.getChannelData(0).set(float32);
                    
                    const src = ctx.createBufferSource();
                    src.buffer = buffer;
                    src.connect(ctx.destination);
                    
                    const now = ctx.currentTime;
                    if (nextStartTimeRef.current < now) nextStartTimeRef.current = now;
                    src.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += buffer.duration;
                }

                // B. Handle Tool Calls
                if (msg.toolCall?.functionCalls) {
                    for (const fc of msg.toolCall.functionCalls) {
                        console.log("🛠️ Tool Call:", fc.name, fc.args);
                        let result: any = { ok: true };

                        if (mode === "real" && fc.name === "schedule_meeting") {
                            try {
                                result = await BackendCalendar.schedule(fc.args);
                            } catch (e: any) {
                                result = { ok: false, error: e.message };
                            }
                        } else if (mode === "sandbox") {
                            result = { ok: true, note: "Sandbox mode: Meeting simulated." };
                        }

                        session.sendToolResponse({
                            functionResponses: [{ id: fc.id, name: fc.name, response: { result } }]
                        });
                    }
                }
            }
        }
      });

      sessionRef.current = session;

      // --- AUDIO INPUT PIPELINE ---
      const source = audioContextRef.current.createMediaStreamSource(stream);
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!isConnectedRef.current) return;
        const inputData = e.inputBuffer.getChannelData(0);
        
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) sum += inputData[i] ** 2;
        setAudioLevel(Math.sqrt(sum / inputData.length) * 5);

        session.sendRealtimeInput({ media: createBlob(inputData) });
      };

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);
      processorRef.current = processor;

    } catch (e: any) {
      console.error("Session Start Failed:", e);
      setErrorMessage(e?.message || "Failed to start AI");
      stopSession();
    }
  }, [mode, stopSession]);

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in zoom-in-95 duration-500">
      <div className="glass p-10 rounded-[3rem] border border-[color:var(--border)] space-y-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
          <Calendar size={180} />
        </div>

        {/* Header */}
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
                <span className={`w-2 h-2 rounded-full ${isActive ? "bg-green-500 animate-pulse" : "bg-slate-400/60"}`}></span>
                {status}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-[var(--chip)] p-1.5 rounded-2xl border border-[var(--chip-border)]">
            <button
              onClick={() => setMode("sandbox")}
              disabled={isActive}
              className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                mode === "sandbox" ? "bg-blue-600 text-white shadow-lg" : "text-[var(--chip-text)] hover:bg-white/10"
              }`}
            >
              Sandbox
            </button>
            <button
              onClick={() => setMode("real")}
              disabled={isActive}
              className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                mode === "real" ? "bg-emerald-600 text-white shadow-lg" : "text-[var(--chip-text)] hover:bg-white/10"
              }`}
            >
              Real Mode
            </button>
          </div>
        </div>

        {/* Mic Button */}
        <div className="flex flex-col items-center justify-center py-10 z-10 relative">
          <div className="relative group cursor-pointer" onClick={isActive ? stopSession : startSession}>
            <div
              className={`absolute inset-0 rounded-full blur-[80px] transition-all duration-75 ${
                isActive ? "bg-blue-500/50" : "bg-transparent"
              }`}
              style={{ transform: `scale(${1 + audioLevel})` }}
            ></div>

            <div className={`relative w-40 h-40 rounded-full flex items-center justify-center border-4 transition-all duration-500 ${
                isActive ? "bg-red-500 border-red-400 shadow-2xl" : "bg-black/20 border-[color:var(--border)] hover:border-blue-500/60"
              }`}
            >
              {isActive ? <Activity size={48} className="text-white animate-pulse" /> : <Mic size={48} className="text-[var(--muted)]" />}
            </div>
          </div>
          <p className="mt-8 text-sm font-bold text-[var(--muted)] uppercase tracking-widest">
            {isActive ? "Listening..." : "Tap to Speak"}
          </p>
        </div>

        {/* Connection Bar */}
        {mode === "real" && (
          <div className="rounded-2xl p-6 border flex items-center justify-between gap-4 bg-[color:var(--panel)] border-[color:var(--panel-border)]">
            <div className="flex items-center gap-3">
              <Info size={18} className="text-[var(--muted)]" />
              <p className="text-xs text-[var(--muted)] font-medium">
                {organizerConnected ? "Connected to Google Calendar" : "Calendar Access Required"}
              </p>
            </div>

            {organizerConnected ? (
              <button
                onClick={signOutOrganizer}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-500 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-red-500/20"
              >
                <LogOut size={14} /> Disconnect
              </button>
            ) : (
              <button
                onClick={connectOrganizerCalendar}
                disabled={isConnecting}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-blue-500 shadow-lg"
              >
                <Play size={14} /> {isConnecting ? "Connecting..." : "Connect Google"}
              </button>
            )}
          </div>
        )}

        {/* Error Display */}
        {errorMessage && (
          <div className="absolute bottom-6 left-0 right-0 flex justify-center z-20">
            <div className="bg-red-500/90 text-white px-6 py-3 rounded-full text-xs font-bold flex items-center gap-2 shadow-xl animate-in slide-in-from-bottom-2">
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
