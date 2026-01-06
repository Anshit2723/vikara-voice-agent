import React, { useState, useEffect, useCallback } from "react";
import { AppTab } from "./types";
import VoiceAssistant from "./components/VoiceAssistant";
import ChatBot from "./components/ChatBot";
import VideoAnalyzer from "./components/VideoAnalyzer";
import {
  Calendar,
  MessageSquare,
  Mic,
  Video,
  ExternalLink,
  Clock,
  RefreshCcw,
  User,
  Sparkles,
  ChevronRight,
  XCircle,
  Sun,
  Moon,
  Phone,
  Mail,
  MapPin,
} from "lucide-react";
// CHANGED: Import from BackendCalendar
import { BackendCalendar, BackendEvent } from "./services/backendCalendar";
import { GoogleGenAI } from "@google/genai";

const BetaChip: React.FC = () => (
  <span className="ml-1 hidden xl:inline-flex items-center px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] font-black uppercase tracking-[0.22em]">
    Beta
  </span>
);

const BetaBanner: React.FC<{ title: string }> = ({ title }) => {
  return (
    <div className="mb-6 glass p-6 rounded-[2rem] border border-amber-500/20 bg-amber-500/5">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">
            Beta / Under construction
          </div>
          <div className="text-white font-black tracking-tight text-lg">
            {title} is shipping soon
          </div>
          <div className="text-slate-300 text-sm leading-relaxed max-w-3xl">
            This feature is accessible but may be unstable or incomplete while it’s being built.
          </div>
        </div>

        <a
          href="mailto:ask@vikara.ai"
          className="shrink-0 px-5 py-3 rounded-2xl bg-slate-900/60 hover:bg-slate-900 text-slate-200 font-black text-xs uppercase tracking-widest transition-all border border-slate-800 active:scale-[0.98]"
        >
          Send feedback
        </a>
      </div>
    </div>
  );
};

const Footer: React.FC = () => {
  return (
    <footer className="mt-auto border-t border-slate-800 bg-black/30">
      <div className="max-w-6xl mx-auto px-6 py-14">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {/* Left */}
          <div className="space-y-4">
            <div className="text-white font-black tracking-[0.3em] uppercase">VIKARA.AI</div>
            <p className="text-slate-400 text-sm leading-relaxed max-w-md">
              Democratizing AI for an equal and empowered world. We help businesses transform
              with intelligent solutions that drive real results.
            </p>
          </div>

          {/* Middle */}
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <Phone className="text-white/80 mt-0.5" size={18} />
              <div>
                <div className="text-white font-black">Phone</div>
                <div className="text-slate-400 text-sm">+1 510 309 6846</div>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <Mail className="text-white/80 mt-0.5" size={18} />
              <div>
                <div className="text-white font-black">Email</div>
                <div className="text-slate-400 text-sm">ask@vikara.ai</div>
              </div>
            </div>
          </div>

          {/* Right */}
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <MapPin className="text-white/80 mt-0.5" size={18} />
              <div>
                <div className="text-white font-black">Offices</div>
                <div className="text-slate-400 text-sm leading-relaxed mt-1">
                  <div>SF Bay Area, California</div>
                  <div>Bengaluru, India</div>
                  <div>Melbourne, Australia</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-800 text-slate-400 text-sm">
          © 2026 VIKARA, All rights reserved.
        </div>
      </div>
    </footer>
  );
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AppTab>(AppTab.VOICE);
  // CHANGED: Use BackendEvent type
  const [liveEvents, setLiveEvents] = useState<BackendEvent[]>([]);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Theme (Day/Night)
  const [theme, setTheme] = useState<"dark" | "light">(
    (document.documentElement.dataset.theme as "dark" | "light") || "dark"
  );

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("vikara-theme", next);
  };

  // CHANGED: Fetch from Backend
  const fetchLiveEvents = useCallback(async () => {
    setIsFetching(true);
    try {
      const now = new Date();
      const nextWeek = new Date();
      nextWeek.setDate(now.getDate() + 7);

      // Call our new backend endpoint
      const events = await BackendCalendar.listEvents(now.toISOString(), nextWeek.toISOString());
      setLiveEvents(events);
      analyzeSchedule(events);
    } catch (e) {
      console.error("Failed to fetch calendar", e);
      // Optional: setLiveEvents([]) if auth fails
    } finally {
      setIsFetching(false);
    }
  }, []);

  // CHANGED: Updated type definition
  const analyzeSchedule = async (events: BackendEvent[]) => {
    if (events.length === 0) return;
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Based on these calendar events: ${JSON.stringify(
        events.map((e) => ({ title: e.summary, start: e.start.dateTime }))
      )}, provide 3 short, proactive suggestions for the user. Examples: "You have a free block on Friday morning for deep work", "Suggest rescheduling your 2pm as it overlaps with travel", etc. Return exactly 3 bullet points.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const lines =
        (response.text || "")
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .slice(0, 3) || [];
      setSuggestions(lines.map((l) => l.replace(/^[*-]\s*/, "")));
    } catch (e) {
      console.error("Analysis failed", e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCancelEvent = async (_eventId: string) => {
    alert("Cancellation not yet implemented in backend.");
  };

  useEffect(() => {
    // Check if the Vite env var is actually populated
    if (process.env.API_KEY && String(process.env.API_KEY).length > 0) {
      setHasApiKey(true);
    } else {
      console.error("API Key missing in build");
      setHasApiKey(false);
    }
    fetchLiveEvents();
  }, [fetchLiveEvents]);

  const tabs = [
    { id: AppTab.VOICE, label: "Voice AI", icon: <Mic size={20} />, beta: false },
    { id: AppTab.CHAT, label: "Flash Chat", icon: <MessageSquare size={20} />, beta: true },
    { id: AppTab.VIDEO, label: "Vision AI", icon: <Video size={20} />, beta: true },
    { id: AppTab.HISTORY, label: "Schedule", icon: <Calendar size={20} />, beta: false },
  ];

  if (hasApiKey === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col text-slate-100">
      <header className="glass glass-strong sticky top-0 z-50 px-6 py-4 flex items-center justify-between border-b border-slate-800/50">
        {/* Brand (logo + wordmark) */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl overflow-hidden bg-black/30 ring-1 ring-white/10 flex items-center justify-center">
            <img src="/image.png" alt="Vikara" className="w-full h-full object-contain" />
          </div>

          <div className="leading-tight">
            <div className="text-lg font-black tracking-tight text-white">
              VIKARA<span className="text-indigo-400">.</span>
            </div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
              Voice • Vision • Calendar
            </div>
          </div>
        </div>

        {/* Tabs (theme-aware) */}
        <div className="flex items-center gap-2 bg-[var(--chip)] p-1.5 rounded-2xl border border-[var(--chip-border)]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all font-bold text-sm ${
                activeTab === tab.id
                  ? "bg-blue-600 text-white shadow-xl shadow-blue-900/40"
                  : "text-[var(--chip-text)] hover:bg-black/10 hover:text-[var(--text)]"
              }`}
            >
              {tab.icon}
              <span className="hidden lg:block">{tab.label}</span>
              {tab.beta ? <BetaChip /> : null}
            </button>
          ))}
        </div>

        {/* Right Controls: Theme only (API Config removed) */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2 px-3 py-2 text-slate-500 hover:text-white transition-colors text-xs font-black uppercase tracking-widest"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            <span className="hidden sm:inline">{theme === "dark" ? "Day" : "Night"}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8 flex justify-center custom-scrollbar">
        <div className="w-full max-w-6xl">
          {activeTab === AppTab.VOICE && <VoiceAssistant onRefresh={fetchLiveEvents} />}

          {activeTab === AppTab.CHAT && (
            <>
              <BetaBanner title="Flash Chat" />
              <ChatBot />
            </>
          )}

          {activeTab === AppTab.VIDEO && (
            <>
              <BetaBanner title="Vision AI" />
              <VideoAnalyzer />
            </>
          )}

          {activeTab === AppTab.HISTORY && (
            <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-4xl font-black flex items-center gap-3 italic">
                    <Calendar className="text-blue-500" size={32} />
                    LIVE SCHEDULE
                  </h2>
                  <p className="text-slate-500 text-sm font-bold uppercase tracking-widest">
                    Real-time Google API Sync
                  </p>
                </div>
                <button
                  onClick={fetchLiveEvents}
                  disabled={isFetching}
                  className="p-3 bg-slate-900 hover:bg-slate-800 rounded-2xl transition-all border border-slate-800 shadow-lg active:scale-90"
                >
                  <RefreshCcw
                    size={20}
                    className={isFetching ? "animate-spin text-blue-400" : "text-slate-400"}
                  />
                </button>
              </div>

              {suggestions.length > 0 && (
                <div className="glass p-8 rounded-[2.5rem] border-blue-500/20 bg-blue-500/5 space-y-4">
                  <div className="flex items-center gap-3">
                    <Sparkles className="text-blue-400" size={20} />
                    <h4 className="font-black text-xs uppercase tracking-[0.2em] text-blue-400">
                      Gemini Intelligence Suggestions
                    </h4>
                    {isAnalyzing && (
                      <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                        analyzing…
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {suggestions.map((s, idx) => (
                      <div
                        key={idx}
                        className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800/50 flex items-start gap-3 group hover:border-blue-500/30 transition-all"
                      >
                        <ChevronRight size={14} className="text-blue-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-slate-300 font-medium leading-relaxed">{s}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {liveEvents.length === 0 && !isFetching ? (
                <div className="glass p-24 rounded-[3rem] text-center border-dashed border-2 border-slate-800">
                  <div className="w-24 h-24 bg-slate-900/50 rounded-full flex items-center justify-center mx-auto mb-8 ring-1 ring-slate-800">
                    <Calendar className="text-slate-700" size={44} />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">No Active Events</h3>
                  <p className="text-slate-500 max-w-sm mx-auto text-sm leading-relaxed">
                    Events will appear here when you connect your Google Calendar in the Voice Tab.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6">
                  {liveEvents.map((event) => (
                    <div
                      key={event.id}
                      className="glass group p-8 rounded-[2.5rem] border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-8 hover:bg-slate-900/40 transition-all border-l-[12px] border-l-blue-600"
                    >
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <h3 className="text-2xl font-black text-white group-hover:text-blue-400 transition-colors uppercase tracking-tight">
                            {event.summary}
                          </h3>
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                            <p className="text-[10px] font-black uppercase text-blue-500 tracking-widest">
                              Live Sync
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-6 text-sm text-slate-400 font-bold uppercase tracking-wider">
                          <div className="flex items-center gap-2 bg-slate-900/80 px-4 py-2 rounded-xl border border-slate-800">
                            <Calendar size={14} className="text-blue-500" />
                            {new Date(event.start.dateTime).toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </div>
                          <div className="flex items-center gap-2 bg-slate-900/80 px-4 py-2 rounded-xl border border-slate-800">
                            <Clock size={14} className="text-blue-500" />
                            {new Date(event.start.dateTime).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                          {event.attendees && event.attendees.length > 0 && (
                            <div className="flex items-center gap-2 bg-slate-900/80 px-4 py-2 rounded-xl border border-slate-800">
                              <User size={14} className="text-blue-500" />
                              {event.attendees[0].email}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-4 items-center">
                        <button
                          onClick={() => handleCancelEvent(event.id)}
                          className="flex items-center gap-2 px-5 py-3 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-2xl transition-all border border-red-500/20 text-xs font-black uppercase tracking-widest"
                        >
                          <XCircle size={16} />
                          Cancel
                        </button>
                        {event.htmlLink && (
                          <a
                            href={event.htmlLink}
                            target="_blank"
                            rel="noreferrer"
                            className="p-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl transition-all shadow-xl shadow-blue-600/20"
                            title="Open in Google Calendar"
                          >
                            <ExternalLink size={20} />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default App;
