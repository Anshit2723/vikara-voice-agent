
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { FileVideo, Upload, CheckCircle2, AlertCircle, PlayCircle, Loader2, Sparkles, Zap, Camera, StopCircle, Mic, MicOff } from 'lucide-react';
import { createBlob, decodeAudioData, decode } from '../services/audioUtils';

const VideoAnalyzer: React.FC = () => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [base64Video, setBase64Video] = useState<string>('');
  const [analysis, setAnalysis] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Live Vision State
  const [isLive, setIsLive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<any>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  const stopLiveVision = useCallback(() => {
    setIsLive(false);
    if (sessionRef.current) sessionRef.current.close();
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    [audioContextRef.current, outputAudioContextRef.current].forEach(ctx => ctx?.close());
    const stream = videoRef.current?.srcObject as MediaStream;
    stream?.getTracks().forEach(track => track.stop());
  }, []);

  const startLiveVision = async () => {
    setError('');
    setIsLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 480 } });
      if (videoRef.current) videoRef.current.srcObject = stream;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setIsLive(true);
            setIsLoading(false);
            
            // Stream Audio
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const processor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(e.inputBuffer.getChannelData(0)) }));
            };
            source.connect(processor);
            processor.connect(audioContextRef.current!.destination);

            // Stream Video Frames
            frameIntervalRef.current = window.setInterval(() => {
              if (canvasRef.current && videoRef.current) {
                const ctx = canvasRef.current.getContext('2d');
                ctx?.drawImage(videoRef.current, 0, 0, 640, 480);
                const base64 = canvasRef.current.toDataURL('image/jpeg', 0.6).split(',')[1];
                sessionPromise.then(s => s.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } }));
              }
            }, 1000); // 1 FPS for efficiency
          },
          onmessage: async (message) => {
            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
            }
          },
          onerror: (e) => { setError('Live connection lost.'); stopLiveVision(); }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: 'You are a live vision assistant. Use the video frames to describe what you see and answer the users questions in real-time. Be concise and friendly.'
        }
      });
    } catch (err: any) {
      setError('Camera/Mic access denied.');
      setIsLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) { 
        setError('Video exceeds 20MB limit.');
        return;
      }
      setVideoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setBase64Video((reader.result as string).split(',')[1]);
      reader.readAsDataURL(file);
    }
  };

  const analyzeVideo = async () => {
    if (!base64Video || isLoading) return;
    setIsLoading(true);
    setAnalysis('');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ parts: [
          { inlineData: { data: base64Video, mimeType: videoFile?.type || 'video/mp4' } },
          { text: 'Analyze this video thoroughly. Summary, key events, and visual style.' }
        ]}]
      });
      setAnalysis(response.text || 'No description returned.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-10 animate-in slide-in-from-bottom-6 duration-700">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-500/10 text-blue-400 rounded-full text-xs font-bold border border-blue-500/20 mb-2">
          <Sparkles size={12} />
          <span>Multimodal Vision Engine</span>
        </div>
        <h2 className="text-4xl font-extrabold tracking-tight">Vision Hub</h2>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto leading-relaxed">
          Switch between <span className="text-blue-400 font-semibold">Live Camera</span> for real-time interaction or <span className="text-indigo-400 font-semibold">File Upload</span> for deep cinematic analysis.
        </p>
      </div>

      <div className="grid lg:grid-cols-5 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Mode Switcher */}
          <div className="flex p-1 bg-slate-900 rounded-2xl border border-slate-800">
            <button 
              onClick={() => { stopLiveVision(); setVideoFile(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all ${!isLive ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Upload size={14} /> Upload Video
            </button>
            <button 
              onClick={isLive ? stopLiveVision : startLiveVision}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all ${isLive ? 'bg-red-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Camera size={14} /> {isLive ? 'Stop Camera' : 'Live Camera'}
            </button>
          </div>

          <div className={`glass relative p-8 rounded-[2.5rem] border-slate-800 flex flex-col items-center justify-center gap-6 border-dashed border-2 min-h-[400px] overflow-hidden ${isLive || videoFile ? 'border-blue-500/30' : 'hover:border-blue-500/20'}`}>
            {isLive ? (
              <div className="w-full h-full relative group">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover rounded-3xl bg-black shadow-2xl" />
                <canvas ref={canvasRef} width="640" height="480" className="hidden" />
                <div className="absolute top-4 left-4 px-3 py-1 bg-red-500 rounded-full flex items-center gap-2 animate-pulse">
                   <div className="w-2 h-2 bg-white rounded-full" />
                   <span className="text-[10px] font-black text-white uppercase tracking-widest">Live Stream</span>
                </div>
              </div>
            ) : videoFile ? (
              <div className="w-full space-y-6">
                <div className="aspect-video w-full bg-black rounded-[1.5rem] overflow-hidden relative shadow-2xl ring-1 ring-slate-800">
                  <video src={URL.createObjectURL(videoFile)} className="w-full h-full object-contain" controls />
                </div>
                <button onClick={analyzeVideo} disabled={isLoading} className="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all shadow-xl shadow-blue-600/20">
                  {isLoading ? <Loader2 className="animate-spin" size={20} /> : <PlayCircle size={20} />}
                  Analyze Clip
                </button>
              </div>
            ) : (
              <>
                <div className="w-20 h-20 rounded-3xl bg-slate-900 flex items-center justify-center text-slate-500 ring-1 ring-slate-800">
                  <Upload size={32} />
                </div>
                <div className="text-center space-y-1">
                  <p className="font-bold text-slate-200">Drop your file or start camera</p>
                  <p className="text-xs text-slate-500">MP4, WEBM up to 20MB</p>
                </div>
                <input type="file" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
              </>
            )}
          </div>
        </div>

        <div className="lg:col-span-3 glass p-10 rounded-[2.5rem] border-slate-800 flex flex-col shadow-2xl">
          <div className="flex items-center justify-between mb-8">
            <h3 className="font-bold text-2xl flex items-center gap-3">
              <CheckCircle2 className={`transition-colors ${isLive ? 'text-green-400' : 'text-blue-400'}`} size={24} />
              {isLive ? 'Live AI Observation' : 'Structural Report'}
            </h3>
          </div>

          <div className="flex-1 min-h-[400px] bg-slate-900/40 rounded-[1.5rem] p-8 border border-slate-800/50 overflow-y-auto custom-scrollbar">
            {error ? (
              <div className="text-red-400 text-center space-y-4">
                <AlertCircle size={44} className="mx-auto" />
                <p className="font-bold">{error}</p>
              </div>
            ) : isLive ? (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
                <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center text-green-400 border border-green-500/20">
                  <Zap size={32} className="animate-pulse" />
                </div>
                <div className="space-y-2">
                  <p className="text-xl font-bold text-slate-200 uppercase tracking-tight">Listening & Watching</p>
                  <p className="text-sm text-slate-500 max-w-xs mx-auto italic">Speak to the AI! It's currently processing 1 frame per second of your camera feed.</p>
                </div>
              </div>
            ) : analysis ? (
              <div className="prose prose-invert prose-sm max-w-none">
                {analysis.split('\n').map((line, i) => (
                  <p key={i} className="text-slate-300 text-base mb-4 leading-relaxed">{line}</p>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-600 text-center gap-6 py-20">
                <Loader2 size={48} className={isLoading ? 'animate-spin text-blue-500' : 'text-slate-800'} />
                <p className="text-sm font-bold uppercase tracking-widest">{isLoading ? 'Processing...' : 'Awaiting Source'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoAnalyzer;
