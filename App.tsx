import React, { useState, useEffect, useCallback } from 'react';
import { AppTab } from './types';
import VoiceAssistant from './components/VoiceAssistant';
import ChatBot from './components/ChatBot';
import VideoAnalyzer from './components/VideoAnalyzer';
import {
  Calendar,
  MessageSquare,
  Mic,
  Video,
  BrainCircuit,
  Key,
  ExternalLink,
  Clock,
  RefreshCcw,
  User,
  Sparkles,
  ChevronRight,
  XCircle,
  Sun,
  Moon,
} from 'lucide-react';
// CHANGED: Import from BackendCalendar
import { BackendCalendar, BackendEvent } from './services/backendCalendar';
import { GoogleGenAI } from '@google/genai';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AppTab>(AppTab.VOICE);
  // CHANGED: Use BackendEvent type
  const [liveEvents, setLiveEvents] = useState<BackendEvent[]>([]);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Theme (Day/Night)
  const [theme, setTheme] = useState<'dark' | 'light'>(
    (document.documentElement.dataset.theme as 'dark' | 'light') || 'dark'
  );

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('vikara-theme', next);
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
      console.error('Failed to fetch calendar', e);
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
        events.map(e => ({ title: e.summary, start: e.start.dateTime }))
      )}, provide 3 short, proactive suggestions for the user. Examples: "You have a free block on Friday morning for deep work", "Suggest rescheduling your 2pm as it overlaps with travel", etc. Return exactly 3 bullet points.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash', // Switched to standard flash model for text stability
        contents: [{ role: 'user', parts: [{ text: prompt }] }], // Correct format
      });

      const lines =
        (response.text || '').split('\n').filter(l => l.trim().length > 0).slice(0, 3) || [];
      setSuggestions(lines.map(l => l.replace(/^[*-]\s*/, '')));
    } catch (e) {
      console.error('Analysis failed', e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCancelEvent = async (eventId: string) => {
    alert('Cancellation not yet implemented in backend.');
  };

  useEffect(() => {
    // Check if the Vite env var is actually populated
    if (process.env.API_KEY && process.env.API_KEY.length > 0) {
      setHasApiKey(true);
    } else {
      // Graceful fallback or alert
      console.error('API Key missing in build');
      setHasApiKey(false);
    }
    fetchLiveEvents();
  }, [fetchLiveEvents]);

  const handleOpenKey = async () => {
    alert('Please set GEMINI_API_KEY in your .env file locally.');
  };

  const tabs = [
    { id: AppTab.VOICE, label: 'Voice AI', icon: <Mic size={20} /> },
    { id: AppTab.CHAT, label: 'Flash Chat', icon: <MessageSquare size={20} /> },
    { id: AppTab.VIDEO, label: 'Vision AI', icon: <Video size={20} /> },
    { id: AppTab.HISTORY, label: 'Schedule', icon: <Calendar size={20} /> },
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
        {/* Premium Brand Lockup */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-xl shadow-indigo-500/25 flex items-center justify-center ring-1 ring-white/10">
              <BrainCircuit className="text-white w-5 h-5" />
            </div>
            <div className="absolute -inset-2 rounded-3xl blur-xl bg-indigo-500/20 pointer-events-none" />
          </div>

          <div className="leading-tight">
            <div className="text-lg font-black tracking-tight text-white">
              Vikara<span className="text-indigo-400">.</span>
            </div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
              Voice • Vision • Calendar
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 bg-slate-900/50 p-1.5 rounded-2xl border border-slate-800">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all font-bold text-sm ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-xl shadow-blue-900/40'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {tab.icon}
              <span className="hidden lg:block">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Right Controls: Theme + API Config */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2 px-3 py-2 text-slate-500 hover:text-white transition-colors text-xs font-black uppercase tracking-widest"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            <span className="hidden sm:inline">{theme === 'dark' ? 'Day' : 'Night'}</span>
          </button>

          <button
            onClick={handleOpenKey}
            className="flex items-center gap-2 px-3 py-2 text-slate-500 hover:text-white transition-colors text-xs font-black uppercase tracking-widest"
          >
            <Key size={14} />
            <span className="hidden sm:inline">API Config</span>
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8 flex justify-center custom-scrollbar">
        <div className="w-full max-w-6xl">
          {activeTab === AppTab.VOICE && <VoiceAssistant onRefresh={fetchLiveEvents} />}
          {activeTab === AppTab.CHAT && <ChatBot />}
          {activeTab === AppTab.VIDEO && <VideoAnalyzer />}
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
                    className={isFetching ? 'animate-spin text-blue-400' : 'text-slate-400'}
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
                  {liveEvents.map(event => (
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
                            {new Date(event.start.dateTime).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </div>
                          <div className="flex items-center gap-2 bg-slate-900/80 px-4 py-2 rounded-xl border border-slate-800">
                            <Clock size={14} className="text-blue-500" />
                            {new Date(event.start.dateTime).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
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
    </div>
  );
};

export default App;
