import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import { Send, Sparkles, User, Bot, ExternalLink, Calendar as CalendarIcon, Loader2 } from 'lucide-react';
import { ChatMessage } from '../types';
// CHANGED: Use the Backend Service
import { BackendCalendar } from '../services/backendCalendar';

const ChatBot: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', text: "Welcome to Vikara AI Chat. I can search the web and manage your Google Calendar via the secure backend. How can I help?" }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((pos) => {
        setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      });
    }
  }, []);

  const calendarTools: FunctionDeclaration[] = [
    {
      name: 'list_events',
      description: 'Fetch calendar events for a specific time range.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          timeMin: { type: Type.STRING, description: "ISO 8601 start time" },
          timeMax: { type: Type.STRING, description: "ISO 8601 end time" },
        },
        required: ['timeMin', 'timeMax'],
      },
    },
    {
      name: 'create_event',
      description: 'Create a new calendar event. Requires an attendee email.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          startTime: { type: Type.STRING, description: "ISO 8601 start time" },
          endTime: { type: Type.STRING, description: "ISO 8601 end time" },
          attendeeEmail: { type: Type.STRING, description: "Email of the person to invite" },
          description: { type: Type.STRING },
        },
        required: ['summary', 'startTime', 'endTime', 'attendeeEmail'],
      },
    }
  ];

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const tools: any[] = [{ googleSearch: {} }];
      if (currentLocation) tools.push({ googleMaps: {} });
      // Always add calendar tools, but they will fail if backend isn't auth'd
      tools.push({ functionDeclarations: calendarTools });

      const model = 'gemini-2.5-flash';
      let currentHistory = [...messages, userMsg].map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      // 1. Initial Generation
      let response = await ai.models.generateContent({
        model,
        contents: currentHistory,
        config: { 
          tools,
          systemInstruction: `You are Vikara AI Assistant. 
          Current Time: ${new Date().toISOString()}
          If the user asks about schedule, call 'list_events'.
          If the user wants to book a meeting, ask for the attendee email if not provided.`
        }
      });

      const functionCalls = response.candidates?.[0]?.content?.parts?.filter(p => p.functionCall);

      // 2. Handle Tool Calls
      if (functionCalls && functionCalls.length > 0) {
        const functionResponses = [];
        
        for (const fc of functionCalls) {
          const call = fc.functionCall!;
          console.log("Calling Tool:", call.name);
          
          let result: any = { error: "Unknown tool" };
          
          try {
            if (call.name === 'list_events') {
              // Call Backend
              result = await BackendCalendar.listEvents(call.args.timeMin as string, call.args.timeMax as string);
            } else if (call.name === 'create_event') {
              // Call Backend
              result = await BackendCalendar.schedule({
                title: call.args.summary as string,
                startIso: call.args.startTime as string,
                endIso: call.args.endTime as string,
                attendeeEmail: call.args.attendeeEmail as string, // Required by backend
                description: call.args.description as string
              });
            }
          } catch (e: any) {
            result = { error: e.message };
          }

          functionResponses.push({
            functionResponse: {
              name: call.name,
              id: call.id,
              response: { result }
            }
          });
        }

        // 3. Send Tool Results back to Model
        response = await ai.models.generateContent({
          model,
          contents: [
            ...currentHistory, 
            { role: 'model', parts: functionCalls }, 
            { role: 'user', parts: functionResponses }
          ],
          config: { tools }
        });
      }

      // 4. Process Final Response
      const groundingLinks = response.candidates?.[0]?.groundingMetadata?.groundingChunks
        ?.map((chunk: any) => {
          if (chunk.web) return { title: chunk.web.title, uri: chunk.web.uri };
          if (chunk.maps) return { title: chunk.maps.title, uri: chunk.maps.uri };
          return null;
        }).filter(Boolean) || [];

      setMessages(prev => [...prev, { 
        role: 'model', 
        text: response.text || "Processed.",
        groundingLinks 
      }]);

    } catch (err: any) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'model', text: `Error: ${err.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[75vh] glass rounded-[3rem] overflow-hidden border-slate-800 shadow-2xl relative">
      <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg">
            <Bot className="text-white" size={20} />
          </div>
          <div>
            <span className="font-black text-white block text-sm uppercase tracking-tighter">Omni Sync Chat</span>
            <span className="text-[10px] text-blue-500 font-black uppercase tracking-[0.2em]">Backend Linked</span>
          </div>
        </div>
        <div className="flex gap-2">
           <div className="px-3 py-1 bg-slate-800 rounded-lg border border-slate-700 flex items-center gap-2 text-[10px] font-bold text-slate-400">
             <CalendarIcon size={12} className="text-blue-500" /> API V2
           </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-4 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-indigo-600' : 'bg-slate-800'}`}>
              {m.role === 'user' ? <User size={20} /> : <Sparkles size={18} className="text-blue-400" />}
            </div>
            <div className={`max-w-[80%] ${m.role === 'user' ? 'text-right' : ''}`}>
              <div className={`p-6 rounded-[2rem] text-sm leading-relaxed ${m.role === 'user' ? 'bg-indigo-600 rounded-tr-none' : 'bg-slate-800/80 rounded-tl-none border border-slate-700'}`}>
                {m.text}
                {m.groundingLinks && m.groundingLinks.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-700 flex flex-wrap gap-2">
                    {m.groundingLinks.map((l, idx) => (
                      <a key={idx} href={l.uri} target="_blank" className="flex items-center gap-1.5 px-3 py-1.5 bg-black/40 rounded-full text-[10px] text-blue-400 border border-blue-500/20 hover:bg-blue-500/10 transition-all">
                        <ExternalLink size={10} /> {l.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-4 animate-pulse">
            <div className="w-10 h-10 bg-slate-800 rounded-2xl" />
            <div className="bg-slate-800/40 w-32 h-12 rounded-2xl" />
          </div>
        )}
      </div>

      <div className="p-8 bg-slate-900/60 border-t border-slate-800">
        <div className="flex gap-4 max-w-4xl mx-auto relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask about your calendar..."
            className="flex-1 bg-black border border-slate-800 rounded-2xl px-6 py-5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
          />
          <button onClick={handleSend} disabled={isLoading || !input.trim()} className="bg-blue-600 hover:bg-blue-500 px-8 rounded-2xl shadow-xl shadow-blue-600/20 active:scale-95 transition-all">
            {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatBot;
