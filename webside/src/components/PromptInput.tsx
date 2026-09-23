"use client";
import { useState, useRef, useEffect } from "react";
import { Globe, ArrowUp, XCircle, BrainCircuit, FileText } from "lucide-react";
import { Paperclip2, Microphone2 } from "iconsax-react";
import { transcribeAudioBlob } from "@/lib/whisper";

type PromptInputProps = {
  onSend: (text: string, fileData: any) => void;
  isLoading: boolean;
  mode: string;
  searchEnabled: boolean;
  setSearchEnabled: (val: boolean) => void;
  thinkingEnabled: boolean;
  setThinkingEnabled: (val: boolean) => void;
  isAgentMode?: boolean;
};

export default function PromptInput({
  onSend, isLoading, mode, searchEnabled, setSearchEnabled, thinkingEnabled, setThinkingEnabled, isAgentMode
}: PromptInputProps) {
  const [text, setText] = useState("");
  const [fileData, setFileData] = useState<any>(null);
  const [isMicActive, setIsMicActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [animatingMode, setAnimatingMode] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Trigger smooth gas/glow animation when mode changes
  useEffect(() => {
    setAnimatingMode(mode);
    const t = setTimeout(() => setAnimatingMode(null), 1200);
    return () => clearTimeout(t);
  }, [mode]);

  // Voice typing: continuous streaming transcription
  useEffect(() => {
    if (!isMicActive) return;

    let stream: MediaStream | null = null;
    let mediaRecorder: MediaRecorder | null = null;
    let currentChunks: Blob[] = [];
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let silenceCheckInterval: ReturnType<typeof setInterval> | null = null;
    let chunkInterval: ReturnType<typeof setInterval> | null = null;
    let isRecording = false;
    let pendingTranscriptions = 0;

    const getAudioLevel = (): number => {
      if (!analyser) return 0;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      return sum / data.length;
    };

    const startNewRecorder = () => {
      if (!stream) return;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      currentChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) currentChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        if (currentChunks.length === 0) return;
        const blob = new Blob(currentChunks, { type: mimeType });
        currentChunks = [];
        if (blob.size < 500) return;

        pendingTranscriptions++;
        try {
          const txt = await transcribeAudioBlob(blob);
          if (txt && txt.trim().length > 0) {
            setText(prev => {
              const newTxt = prev ? prev + " " + txt : txt;
              requestAnimationFrame(() => {
                if (textareaRef.current) {
                  textareaRef.current.style.height = '56px';
                  textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
                }
              });
              return newTxt;
            });
          }
        } catch (e) {
          console.error("[PromptInput] STT chunk failed:", e);
        } finally {
          pendingTranscriptions--;
          if (isMicActive && isRecording) startNewRecorder();
        }
      };

      mediaRecorder.start();
      isRecording = true;
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        startNewRecorder();
        setIsListening(true);

        let silenceTimer: ReturnType<typeof setTimeout> | null = null;

        silenceCheckInterval = setInterval(() => {
          const level = getAudioLevel();
          const isSpeaking = level > 10;

          if (isSpeaking && !isRecording) {
            startNewRecorder();
            if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
          } else if (isSpeaking && isRecording) {
            if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
          } else if (!isSpeaking && isRecording && !silenceTimer) {
            silenceTimer = setTimeout(() => {
              if (mediaRecorder && mediaRecorder.state === "recording") {
                isRecording = false;
                mediaRecorder.stop();
              }
              setIsListening(false);
              silenceTimer = null;
            }, 1500);
          }
        }, 200);
      } catch (e) {
        console.error("[PromptInput] Mic access denied:", e);
        setIsMicActive(false);
      }
    };
    start();

    return () => {
      isRecording = false;
      if (silenceCheckInterval) clearInterval(silenceCheckInterval);
      if (chunkInterval) clearInterval(chunkInterval);
      if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
      if (audioCtx && audioCtx.state !== "closed") audioCtx.close();
      if (stream) stream.getTracks().forEach(t => t.stop());
      setIsListening(false);
    };
  }, [isMicActive]);

  const handleSend = () => {
    if ((!text.trim() && !fileData) || isLoading) return;
    onSend(text, fileData);
    setText("");
    setFileData(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = '56px';
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    e.target.style.height = '56px';
    const scrollHeight = e.target.scrollHeight;
    e.target.style.height = Math.min(scrollHeight, 160) + 'px';
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setFileData({ base64: event.target?.result, filename: file.name, content_type: file.type });
    };
    reader.readAsDataURL(file);
  };

  const isImage = fileData?.content_type?.startsWith('image/');

  if (isAgentMode) {
    return (
      <div className="relative w-full max-w-4xl mx-auto flex flex-col z-10 pointer-events-auto">
        <input type="file" ref={fileInputRef} className="hidden" accept="*/*" onChange={handleFile} />

        <div className="flex items-end gap-3 w-full">
          {/* Left Buttons — instant-style Search/Think/File for agent (exactly like chat) */}
          <div className="flex items-center gap-1 mb-1">
            <button
              onClick={() => setSearchEnabled(!searchEnabled)}
              title="Web Search"
              className={`h-[38px] px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-all cursor-pointer border ${searchEnabled ? "bg-blue-500/20 border-blue-500/30 text-blue-300" : "bg-transparent border-transparent text-[#666] hover:text-[#ededed] hover:bg-[#2a2a2a]"}`}
            >
              <Globe size={14} className={searchEnabled ? "text-blue-300" : "text-[#666]"} />
              <span className="hidden sm:inline">Search</span>
            </button>
            <button
              onClick={() => setThinkingEnabled(!thinkingEnabled)}
              title="Deep Thinking"
              className={`h-[38px] px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-all cursor-pointer border ${thinkingEnabled ? "bg-purple-500/20 border-purple-500/30 text-purple-300" : "bg-transparent border-transparent text-[#666] hover:text-[#ededed] hover:bg-[#2a2a2a]"}`}
            >
              <BrainCircuit size={14} className={thinkingEnabled ? "text-purple-300" : "text-[#666]"} />
              <span className="hidden sm:inline">Think</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-[38px] h-[38px] rounded-lg flex items-center justify-center bg-transparent text-[#666] hover:text-[#ededed] hover:bg-[#2a2a2a] transition-colors cursor-pointer"
            >
              <Paperclip2 size={18} color="currentColor" variant="Linear" />
            </button>
            <button
              onClick={() => setIsMicActive(!isMicActive)}
              className={`w-[38px] h-[38px] rounded-lg flex items-center justify-center transition-all duration-300 cursor-pointer ${
                isMicActive ? 'bg-[#ededed] text-[#1c1c1c]' : 'bg-transparent text-[#666] hover:text-[#ededed] hover:bg-[#2a2a2a]'
              }`}
            >
              <Microphone2 size={18} variant={isMicActive ? "Bold" : "Linear"} color="currentColor" />
            </button>
          </div>

          {/* Input Box */}
          <div className="flex-1 flex flex-col bg-[#1c1c1c] border border-[#333] focus-within:border-[#555] transition-all duration-300 rounded-xl overflow-hidden shadow-sm">
            {fileData && (
              <div className="px-3 pt-3 pb-0">
                <div className="relative inline-flex items-center gap-2 px-3 py-1.5 bg-[#2a2a2a] border border-[#333] rounded-md text-sm max-w-[200px]">
                  {isImage ? <Globe size={14} className="text-[#a0a0a0]" /> : <FileText size={14} className="text-[#a0a0a0]" />}
                  <span className="truncate flex-1 text-[#ededed] font-medium text-[12px]">{fileData.filename}</span>
                  <button
                    onClick={() => { setFileData(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#1c1c1c] border border-[#333] rounded-full flex items-center justify-center text-[#a0a0a0] hover:text-[#ededed] hover:bg-[#333] transition-colors cursor-pointer"
                  >
                    <XCircle size={10} />
                  </button>
                </div>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleInput}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={isMicActive ? (isListening ? "Listening... speak now" : "Click mic or start speaking...") : "Ask anything..."}
              rows={1}
              className="w-full bg-transparent resize-none outline-none text-[#ededed] placeholder-[#666] text-[14px] px-4 py-3 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] min-h-[46px] align-middle"
              style={{ height: '46px' }}
            />
          </div>

          {/* Right Button */}
          <div className="mb-1">
            <button
              onClick={handleSend}
              disabled={isLoading || (!text.trim() && !fileData)}
              className="w-[38px] h-[38px] rounded-lg bg-[#ededed] text-[#1c1c1c] flex items-center justify-center hover:bg-white disabled:opacity-20 disabled:cursor-not-allowed transition-all shadow-sm cursor-pointer"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-[2px] border-[#1c1c1c]/30 border-t-[#1c1c1c] rounded-full animate-spin" />
              ) : (
                <ArrowUp size={18} strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full max-w-3xl mx-auto flex flex-col bg-panel border ${animatingMode === 'expert' ? 'border-purple-500/50 shadow-[0_0_40px_rgba(168,85,247,0.15)]' : animatingMode === 'instant' ? 'border-blue-500/50 shadow-[0_0_40px_rgba(59,130,246,0.15)]' : 'border-border shadow-sm'} focus-within:shadow-md focus-within:border-foreground/30 transition-all duration-700 rounded-3xl overflow-hidden`}>
      
      {/* Mode Change Filter/Glow Effect */}
      <div className={`absolute inset-0 pointer-events-none transition-all duration-1000 z-0 ${animatingMode ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
         <div className={`absolute -inset-10 blur-[60px] opacity-30 ${animatingMode === 'expert' ? 'bg-gradient-to-r from-purple-500 via-pink-500 to-transparent' : 'bg-gradient-to-r from-blue-500 via-cyan-500 to-transparent'} mix-blend-screen animate-pulse`} style={{ animationDuration: '1s' }} />
      </div>

      {fileData && (
        <div className="relative z-10 px-5 pt-4 pb-1">
          <div className="relative inline-flex items-center gap-2 px-3 py-1.5 bg-input-bg border border-border rounded-xl text-sm max-w-[200px]">
            {isImage ? <Globe size={14} className="text-muted" /> : <FileText size={14} className="text-muted" />}
            <span className="truncate flex-1 text-foreground font-medium text-xs">{fileData.filename}</span>
            <button
              onClick={() => { setFileData(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
              className="absolute -top-2 -right-2 w-5 h-5 bg-background border border-border rounded-full flex items-center justify-center text-muted hover:text-foreground hover:bg-input-bg transition-colors cursor-pointer"
            >
              <XCircle size={12} />
            </button>
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleInput}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        placeholder={isMicActive ? (isListening ? "Listening... speak now" : "Click mic or start speaking...") : mode === "instant" ? "Ask anything..." : "Describe your thought..."}
        rows={1}
        className="relative z-10 w-full bg-transparent resize-none outline-none text-foreground placeholder-muted/50 text-[15px] px-5 py-4 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] min-h-[56px] align-middle"
        style={{ height: '56px' }}
      />
      
      <div className="relative z-10 flex items-center justify-between px-3 pb-3">
        <div className="flex items-center gap-1.5 relative">
          
          {/* Animated Gas Mic Button */}
          <div className="relative flex items-center justify-center">
            {/* Spreading gas/smoke effect */}
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-0 transition-all duration-700 ${isMicActive ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[220px] h-[120px] bg-gradient-to-r from-blue-400/50 via-purple-400/50 to-rose-400/50 rounded-[100px] blur-[30px] mix-blend-plus-lighter animate-pulse" style={{ animationDuration: '2s' }} />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[160px] h-[160px] bg-gradient-to-tr from-emerald-400/40 via-cyan-400/40 to-transparent rounded-full blur-[40px] mix-blend-plus-lighter animate-[spin_4s_linear_infinite]" />
            </div>
            
            <button
              onClick={() => setIsMicActive(!isMicActive)}
              className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-500 cursor-pointer ${isMicActive ? 'bg-foreground text-background scale-110 shadow-[0_0_15px_rgba(0,0,0,0.2)]' : 'text-muted hover:text-foreground hover:bg-input-bg'}`}
              title={isMicActive ? "Stop Voice Typing" : "Voice Typing"}
            >
              {isListening && (
                <span className="absolute inset-0 rounded-full bg-foreground animate-ping opacity-30" />
              )}
              <Microphone2 size={isMicActive ? 20 : 18} variant={isMicActive ? "Bold" : "Linear"} color="currentColor" />
            </button>
          </div>

          {/* Glass Search Toggle — show for expert AND for agent (agent uses instant logic exactly like chat) */}
          {(mode !== "instant" || isAgentMode) && (
            <button
              className={`relative flex items-center h-10 rounded-full p-1 transition-all duration-500 overflow-hidden cursor-pointer ${
                searchEnabled
                  ? "w-[110px] bg-blue-500/20 border border-blue-400/30 shadow-[inset_0_0_20px_rgba(59,130,246,0.15)] backdrop-blur-md"
                  : "w-[104px] bg-foreground/5 border border-transparent hover:bg-foreground/10"
              }`}
              onClick={() => setSearchEnabled(!searchEnabled)}
              title="Web Search"
            >
              {/* Active Glows */}
              <div className={`absolute inset-0 transition-opacity duration-500 ${searchEnabled ? 'opacity-100' : 'opacity-0'}`}>
                <div className="absolute -left-2 top-0 bottom-0 w-12 bg-gradient-to-r from-amber-200/60 via-emerald-300/40 to-transparent blur-md" />
                <div className="absolute -right-2 top-0 bottom-0 w-12 bg-gradient-to-l from-blue-400/40 to-transparent blur-md" />
              </div>

              {/* Sliding Thumb (Circle) */}
              <div
                className={`absolute top-1 bottom-1 w-8 rounded-full flex items-center justify-center transition-all duration-500 z-10 shadow-sm ${
                  searchEnabled
                    ? "left-[74px] bg-white/20 backdrop-blur-lg border border-white/30 shadow-[0_4px_12px_rgba(0,0,0,0.1)]" // (110 - 4 - 32 = 74)
                    : "left-1 bg-background shadow-sm border border-border"
                }`}
              >
                <Globe size={15} className={searchEnabled ? "text-foreground stroke-[2.5]" : "text-muted stroke-[2]"} />
              </div>

              {/* Text Label */}
              <span
                className={`absolute flex items-center justify-center transition-all duration-500 z-10 text-[14px] font-bold tracking-wide ${
                  searchEnabled
                    ? "left-4 text-foreground/90 opacity-100 mix-blend-plus-lighter"
                    : "left-[38px] text-muted opacity-90"
                }`}
              >
                Search
              </span>
            </button>
          )}

          {/* Glass Think Toggle — show for expert AND for agent */}
          {(mode !== "instant" || isAgentMode) && (
          <button
            className={`relative flex items-center h-10 rounded-full p-1 transition-all duration-500 overflow-hidden cursor-pointer ${
              thinkingEnabled
                ? "w-[104px] bg-purple-500/20 border border-purple-400/30 shadow-[inset_0_0_20px_rgba(168,85,247,0.15)] backdrop-blur-md"
                : "w-[96px] bg-foreground/5 border border-transparent hover:bg-foreground/10"
            }`}
            onClick={() => setThinkingEnabled(!thinkingEnabled)}
            title="Deep Thinking"
          >
            {/* Active Glows */}
            <div className={`absolute inset-0 transition-opacity duration-500 ${thinkingEnabled ? 'opacity-100' : 'opacity-0'}`}>
              <div className="absolute -left-2 top-0 bottom-0 w-12 bg-gradient-to-r from-pink-300/50 via-purple-300/40 to-transparent blur-md" />
              <div className="absolute -right-2 top-0 bottom-0 w-12 bg-gradient-to-l from-indigo-400/40 to-transparent blur-md" />
            </div>

            {/* Sliding Thumb (Circle) */}
            <div
              className={`absolute top-1 bottom-1 w-8 rounded-full flex items-center justify-center transition-all duration-500 z-10 shadow-sm ${
                thinkingEnabled
                  ? "left-[68px] bg-white/20 backdrop-blur-lg border border-white/30 shadow-[0_4px_12px_rgba(0,0,0,0.1)]" // (104 - 4 - 32 = 68)
                  : "left-1 bg-background shadow-sm border border-border"
              }`}
            >
              <BrainCircuit size={15} className={thinkingEnabled ? "text-foreground stroke-[2.5]" : "text-muted stroke-[2]"} />
            </div>

            {/* Text Label */}
            <span
              className={`absolute flex items-center justify-center transition-all duration-500 z-10 text-[14px] font-bold tracking-wide ${
                thinkingEnabled
                  ? "left-4 text-foreground/90 opacity-100 mix-blend-plus-lighter"
                  : "left-[38px] text-muted opacity-90"
              }`}
            >
              Think
            </span>
          </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 relative z-10">
          {(mode === "vision" || mode === "instant") && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                // accept={mode === "vision" ? "image/*" : ".txt,.pdf,.csv,.doc,.docx,.md"}
                accept="*/*"
                onChange={handleFile}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-foreground hover:bg-input-bg transition-colors cursor-pointer"
                title={mode === "vision" ? "Attach Image" : "Attach Document"}
              >
                <Paperclip2 size={18} color="currentColor" variant="Linear" />
              </button>
            </>
          )}

          <button
            onClick={handleSend}
            disabled={isLoading || (!text.trim() && !fileData)}
            className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center hover:opacity-90 disabled:opacity-20 disabled:cursor-not-allowed transition-all mr-1 cursor-pointer"
          >
            {isLoading ? (
              <div className="w-4 h-4 border-[2.5px] border-background/30 border-t-background rounded-full animate-spin" />
            ) : (
              <ArrowUp size={18} className="stroke-[2.5]" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
