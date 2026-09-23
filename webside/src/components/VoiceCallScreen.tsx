"use client";
import React, { useState, useEffect, useRef } from "react";
import { X, Mic, MicOff, Brain, Volume2, Ear } from "lucide-react";
import { transcribeAudioBlob } from "@/lib/whisper";

interface VoiceCallScreenProps {
  onClose: () => void;
  onSend: (text: string, fileData: any, forceOptions?: any) => void;
  stopGeneration: () => void;
  latestMessage: any;
  isStreaming: boolean;
}

export default function VoiceCallScreen({ onClose, onSend, stopGeneration, latestMessage, isStreaming }: VoiceCallScreenProps) {
  const [isMicOn, setIsMicOn] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [audioQueue, setAudioQueue] = useState<{text: string}[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [processedLength, setProcessedLength] = useState(() => {
    if (latestMessage?.role === "assistant") return (latestMessage.content || "").length;
    return 0;
  });
  const [phase, setPhase] = useState(0); 
  const [isTalking, setIsTalking] = useState(false);
  const [pixels, setPixels] = useState<{char: string, type: number}[]>([]);
  const [voiceId, setVoiceId] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("preferredVoice") || "cori-medium";
    }
    return "cori-medium";
  });

  // Subtitle states
  const [userSubtitle, setUserSubtitle] = useState("");
  const [currentAiSentence, setCurrentAiSentence] = useState("");
  const [displayedAiWords, setDisplayedAiWords] = useState("");

  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptTimeout = useRef<any>(null);
  const subtitleIntervalRef = useRef<any>(null);
  const networkErrorRef = useRef(false);

  useEffect(() => {
    // Generate static grid for the globe
    const newPixels = Array.from({ length: 1600 }).map(() => {
      const chars = ['+', 'x', 'o', '•', ' '];
      const char = chars[Math.floor(Math.random() * chars.length)];
      let type = 0; // 0: green, 1: pink, 2: cream
      if (Math.random() > 0.85) type = 1;
      else if (Math.random() > 0.7) type = 2;
      return { char, type };
    });
    setPixels(newPixels);
  }, []);

  const FaceToggle = () => {
    const isFemale = voiceId === "cori-medium";
    
    const handleToggle = () => {
      const newVoice = isFemale ? "kusal-medium" : "cori-medium";
      setVoiceId(newVoice);
      localStorage.setItem("preferredVoice", newVoice);
    };

    return (
      <div 
        onClick={handleToggle}
        className={`relative w-28 h-12 rounded-full cursor-pointer transition-colors duration-500 shadow-inner overflow-hidden ${isFemale ? 'bg-pink-400' : 'bg-gray-400'}`}
      >
        <div 
          className={`absolute top-1 left-1 w-10 h-10 rounded-full bg-[#fce4e4] shadow-[0_2px_5px_rgba(0,0,0,0.3)] transition-transform duration-500 flex items-center justify-center ${isFemale ? 'translate-x-16' : 'translate-x-0'}`}
        >
          {isFemale ? (
            <div className="relative w-full h-full flex flex-col items-center justify-center">
              <div className="flex gap-3 mb-0.5">
                <div className="w-1.5 h-1.5 bg-[#333] rounded-full" />
                <div className="w-1.5 h-1.5 bg-[#333] rounded-full" />
              </div>
              <div className="w-3 h-2 bg-[#ff6b81] rounded-b-full overflow-hidden flex items-end justify-center">
                 <div className="w-2 h-1 bg-[#ff4757] rounded-full translate-y-0.5" />
              </div>
            </div>
          ) : (
            <div className="relative w-full h-full flex flex-col items-center justify-center">
              <div className="flex gap-4 mb-0.5 text-[#333] font-bold text-[8px] leading-none">
                <span>&gt;</span>
                <span>&lt;</span>
              </div>
              <div className="w-2.5 h-1 bg-[#333] rounded-t-full mt-1" />
            </div>
          )}
        </div>
      </div>
    );
  };

  const startSubtitleStreaming = (text: string, durationMs: number) => {
    setCurrentAiSentence(text);
    setUserSubtitle(""); // clear user subtitle when AI starts speaking
    if (subtitleIntervalRef.current) clearInterval(subtitleIntervalRef.current);
    
    const words = text.split(" ");
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += 3) {
      chunks.push(words.slice(i, i + 3).join(" "));
    }
    
    if (chunks.length === 0) return;
    
    // Fallback duration if undefined
    const validDuration = durationMs && isFinite(durationMs) && durationMs > 0 ? durationMs : Math.max(1000, chunks.length * 800);
    const chunkTime = validDuration / chunks.length;
    
    let currentChunkIdx = 0;
    setDisplayedAiWords(chunks[0]);
    
    subtitleIntervalRef.current = setInterval(() => {
      currentChunkIdx++;
      if (currentChunkIdx < chunks.length) {
        setDisplayedAiWords(chunks[currentChunkIdx]);
      } else {
        clearInterval(subtitleIntervalRef.current);
      }
    }, chunkTime);
  };

  const stripForTTS = (text: string) => {
    return text
      .replace(/[*#$~_`\[\]{}()|<>"'\\]/g, '') // Remove Markdown & special symbols
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
      .replace(/[\u{2600}-\u{27BF}]/gu, '')
      .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
      .replace(/[\u{200D}]/gu, '')
      .replace(/[\u{20E3}]/gu, '')
      .replace(/[\u{E0020}-\u{E007F}]/gu, '')
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
      .replace(/[\u{1FA00}-\u{1FAFF}]/gu, '')
      .replace(/[\u{2000}-\u{206F}]/gu, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  const playTTS = async (text: string) => {
    const cleanText = stripForTTS(text);
    if (!cleanText) {
      setIsPlaying(false);
      return;
    }
    try {
      const res = await fetch("http://localhost:8000/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText, voice: voiceId })
      });
      if (!res.ok) throw new Error("TTS failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.onloadedmetadata = () => {
          const duration = audioRef.current!.duration * 1000;
          startSubtitleStreaming(cleanText, duration);
          setIsPlaying(true);
          audioRef.current!.play();
        };
      }
    } catch (e) {
      console.error(e);
      setIsPlaying(false);
    }
  };

  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    let isMounted = true;
    
    const initialize = async () => {
      setPhase(1);
      
      try {
        const res = await fetch("http://localhost:8000/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "Hello, I am ready.", voice: voiceId })
        });
        if (!res.ok) throw new Error("TTS failed");
        const blob = await res.blob();
        
        if (!isMounted) return;
        
        const url = URL.createObjectURL(blob);
        setPhase(2);
        setIsInitializing(false);

        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.onloadedmetadata = () => {
            const duration = audioRef.current!.duration * 1000;
            startSubtitleStreaming("Hello, I am ready.", duration);
            setIsPlaying(true);
            audioRef.current!.play().catch(e => console.warn("Auto-play prevented", e));
          };
        }
      } catch (e) {
        console.error("Failed to initialize TTS", e);
        if (!isMounted) return;
        setPhase(2);
        setIsInitializing(false);
      }
    };

    const t1 = setTimeout(() => {
      if (isMounted) initialize();
    }, 500);

    return () => { 
      isMounted = false;
      clearTimeout(t1); 
    };
  }, []);

  const handleClose = () => {
    stopGeneration();
    setAudioQueue([]); // Clear queue completely
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = ""; // Force destroy audio source
      audioRef.current.load();
    }
    if (subtitleIntervalRef.current) clearInterval(subtitleIntervalRef.current);
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsMicOn(false);
    setIsPlaying(false);
    
    setPhase(3); 
    setTimeout(() => setPhase(4), 1000); 
    setTimeout(() => onClose(), 2200); 
  };

  const currentTranscriptRef = useRef("");
  const lastMessageIdRef = useRef<string | null>(null);
  const [fallbackMode, setFallbackMode] = useState(false);

  useEffect(() => {
    if (phase < 2 || isPlaying) return;
    networkErrorRef.current = false;

    if (fallbackMode) {
      // FALLBACK: MediaRecorder + Whisper
      let stream: MediaStream | null = null;
      let mediaRecorder: MediaRecorder | null = null;
      let currentChunks: Blob[] = [];
      let silenceTimer: ReturnType<typeof setTimeout> | null = null;
      let analyser: AnalyserNode | null = null;
      let silenceCheckInterval: ReturnType<typeof setInterval> | null = null;
      let isRecording = false;
      let audioCtx: AudioContext | null = null;
      let accumulatedText = "";

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
          if (blob.size < 500) {
            if (isMicOn && isRecording) startNewRecorder();
            return;
          }

          try {
            const txt = await transcribeAudioBlob(blob);
            if (txt && txt.trim().length > 0) {
              accumulatedText = accumulatedText ? accumulatedText + " " + txt : txt;
              setUserSubtitle(accumulatedText);
              currentTranscriptRef.current = accumulatedText;
            }
          } catch (e) {
            console.error("[VoiceCall] STT chunk failed:", e);
          }

          if (isMicOn && isRecording) startNewRecorder();
        };

        mediaRecorder.start();
        isRecording = true;
      };

      const getAudioLevel = (): number => {
        if (!analyser) return 0;
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        return sum / data.length;
      };

      const startListening = async () => {
        if (!isMicOn) return;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          audioCtx = new AudioContext();
          const source = audioCtx.createMediaStreamSource(stream);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);

          startNewRecorder();
          setIsTalking(true);
          setUserSubtitle("...");

          silenceCheckInterval = setInterval(() => {
            const level = getAudioLevel();
            const isSpeaking = level > 10;

            if (isSpeaking && !isRecording) {
              accumulatedText = "";
              setIsTalking(true);
              setUserSubtitle("...");
              setDisplayedAiWords("");
              startNewRecorder();
              if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
            } else if (isSpeaking && isRecording) {
              if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
            } else if (!isSpeaking && isRecording && !silenceTimer) {
              silenceTimer = setTimeout(() => {
                setIsTalking(false);
                if (mediaRecorder && mediaRecorder.state === "recording") {
                  isRecording = false;
                  mediaRecorder.stop();
                }
                if (accumulatedText.trim().length > 0) {
                  setTranscript(accumulatedText);
                  onSend(accumulatedText, null, { mode: 'instant', thinking: false, search: false });
                  currentTranscriptRef.current = "";
                }
                accumulatedText = "";
                silenceTimer = null;
              }, 1500);
            }
          }, 200);
        } catch (e) {
          console.error("[VoiceCall] Mic access failed:", e);
          setIsMicOn(false);
        }
      };
      
      if (isMicOn) startListening();

      return () => {
        isRecording = false;
        if (silenceCheckInterval) clearInterval(silenceCheckInterval);
        if (silenceTimer) clearTimeout(silenceTimer);
        if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
        if (audioCtx && audioCtx.state !== "closed") audioCtx.close();
        if (stream) stream.getTracks().forEach(t => t.stop());
      };
    } else {
      // CHROME / DEFAULT: WebSpeech API (Instant Streaming)
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition && isMicOn) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = navigator.language || "en-US";

        recognition.onresult = (event: any) => {
          setIsTalking(true);
          clearTimeout(transcriptTimeout.current);
          transcriptTimeout.current = setTimeout(() => setIsTalking(false), 1500);

          let finalPart = "";
          let interimPart = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) finalPart += event.results[i][0].transcript;
            else interimPart += event.results[i][0].transcript;
          }
          
          const currentText = finalPart || interimPart;
          if (currentText) {
            setUserSubtitle(currentText);
            currentTranscriptRef.current = currentText;
          }

          if (finalPart) {
            setTranscript(finalPart);
            setDisplayedAiWords(""); 
            onSend(finalPart, null, { mode: 'instant', thinking: false, search: false });
            currentTranscriptRef.current = "";
            setIsTalking(false);
          }
        };

        recognition.onerror = (e: any) => {
          if(e.error !== "no-speech") console.warn("Recognition error:", e.error);
          if(e.error === "network" || e.error === "not-allowed" || e.error === "service-not-allowed") {
             networkErrorRef.current = true;
             setFallbackMode(true);
          }
        };

        recognition.onend = () => {
          setIsTalking(false);
          if (!networkErrorRef.current && isMicOn && phase === 2 && !isPlaying && !fallbackMode) {
            try { recognition.start(); } catch (e) {}
          }
        };
        recognitionRef.current = recognition;
        try { recognition.start(); } catch (e) {
          networkErrorRef.current = true;
          setFallbackMode(true);
        }
      } else if (!SpeechRecognition) {
        networkErrorRef.current = true;
        setFallbackMode(true);
      }
      
      return () => {
        networkErrorRef.current = true;
        if (recognitionRef.current) recognitionRef.current.stop();
      };
    }
  }, [onSend, phase, isPlaying, isMicOn, fallbackMode]);

  useEffect(() => {
    // Only manage stopping if we toggle off mic
    if (phase < 2 || fallbackMode) return;
    if (!isMicOn) {
      recognitionRef.current?.stop();
      setIsTalking(false);
    }
  }, [isMicOn, phase, fallbackMode]);

  useEffect(() => {
    if (!latestMessage || latestMessage.role !== "assistant" || phase < 2) return;
    const content = latestMessage.content || "";
    
    // Check if we are receiving a new message from the AI (to prevent skipping words)
    const msgIdentifier = latestMessage.id || (content.length > 0 ? content.substring(0, 15) : Math.random().toString());
    let currentProcessedLength = processedLength;

    if (msgIdentifier !== lastMessageIdRef.current || content.length < processedLength) {
      lastMessageIdRef.current = msgIdentifier;
      setProcessedLength(0);
      currentProcessedLength = 0;
      setAudioQueue([]); // Clear old queue
    }

    if (content.length > currentProcessedLength && !isStreaming) {
      const newContent = content.substring(currentProcessedLength);
      if (newContent.trim().length > 0) {
        setAudioQueue(q => [...q, {text: newContent.trim()}]);
        setProcessedLength(content.length);
      }
    } else if (content.length > currentProcessedLength) {
      const newContent = content.substring(currentProcessedLength);
      // Wait for punctuation to stream natural chunks. Added commas and colons for super fast TTS responsiveness.
      const sentences = newContent.match(/[^.!?\n,:]+[.!?\n,:]+/g);
      if (sentences) {
        let matchedLength = 0;
        sentences.forEach(s => {
          if (s.trim().length > 1) setAudioQueue(q => [...q, {text: s.trim()}]);
          matchedLength += s.length;
        });
        setProcessedLength(prev => (currentProcessedLength === 0 ? matchedLength : prev + matchedLength));
      }
    }
  }, [latestMessage, isStreaming, processedLength, phase]);

  useEffect(() => {
    if (!isPlaying && audioQueue.length > 0) {
      const nextItem = audioQueue[0];
      setAudioQueue(q => q.slice(1));
      playTTS(nextItem.text);
    }
  }, [isPlaying, audioQueue]);

  const getAiFlowState = () => {
    if (isPlaying) return "speaking";
    if (isStreaming) return "thinking";
    if (isMicOn) return "listening";
    return "idle";
  };
  const flowState = getAiFlowState();

  const getGlobeState = () => {
    if (isPlaying) return "ai-talking";
    if (isMicOn && isTalking) return "user-talking";
    if (isMicOn && !isTalking) return "listening-silent";
    return "idle";
  };
  const globeState = getGlobeState();

  const FlowStep = ({ icon: Icon, label, isActive, isPast, activeColor }: { icon: any, label: string, isActive: boolean, isPast: boolean, activeColor: string }) => (
    <div className={`flex flex-col items-center gap-1.5 transition-all duration-500 ${isActive ? 'opacity-100 scale-110' : isPast ? 'opacity-50' : 'opacity-20'}`}>
      <div className={`p-2 rounded-full transition-colors duration-500 ${isActive ? activeColor : 'bg-white/5'}`}>
        <Icon size={16} className={isActive ? 'text-white' : 'text-white/70'} />
      </div>
      <span className={`text-[10px] font-bold tracking-wider uppercase ${isActive ? 'text-white' : 'text-white/50'}`}>{label}</span>
    </div>
  );

  const FlowDivider = ({ isActive }: { isActive: boolean }) => (
    <div className="w-10 h-[2px] rounded-full bg-white/10 relative overflow-hidden -mt-5">
      <div className={`absolute top-0 left-0 h-full bg-white/50 w-full transition-transform duration-[1500ms] origin-left ${isActive ? 'scale-x-100' : 'scale-x-0'}`} />
    </div>
  );

  return (
    <div className={`absolute inset-0 z-[100] flex flex-col pointer-events-auto transition-all duration-1000 ${phase >= 1 && phase < 3 ? 'bg-[#050505]/95 backdrop-blur-[20px]' : 'bg-transparent pointer-events-none'}`}>
      
      {/* Initialization Loader */}
      {isInitializing && (
        <div className={`absolute inset-0 flex flex-col items-center justify-center z-[110] transition-opacity duration-500 ${phase >= 1 ? 'opacity-100' : 'opacity-0'}`}>
          <div className="relative flex items-center justify-center w-32 h-32">
            <div className="absolute inset-0 border-t-2 border-r-2 border-indigo-500 rounded-full animate-[spin_1.5s_linear_infinite]" />
            <div className="absolute inset-2 border-b-2 border-l-2 border-pink-500 rounded-full animate-[spin_2s_linear_infinite_reverse]" />
            <Brain size={28} className="text-white/80 animate-pulse" />
          </div>
          <p className="mt-8 text-white/50 text-sm font-medium tracking-[0.2em] uppercase animate-pulse">Warming up Models...</p>
        </div>
      )}

      <audio 
        ref={audioRef} 
        onEnded={() => {
          setIsPlaying(false);
          setDisplayedAiWords("");
          if (audioQueue.length === 0 && !isStreaming) {
            setTranscript("");
          }
        }} 
        className="hidden" 
      />

      <button onClick={handleClose} className={`absolute top-6 right-6 p-4 rounded-full bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition-all duration-300 z-50 ${phase >= 1 && phase < 3 ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}>
        <X size={28} />
      </button>

      {/* AI Status Flow Indicator (Bottom Right) */}
      <div className={`absolute bottom-10 right-10 z-50 transition-all duration-1000 ${phase >= 2 && phase < 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
        <div className="flex items-center gap-2 bg-[#0a0a0a]/80 backdrop-blur-2xl border border-white/10 px-6 py-4 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <FlowStep icon={Ear} label="Listen" isActive={flowState === 'listening'} isPast={flowState === 'thinking' || flowState === 'speaking'} activeColor="bg-cyan-500/80 shadow-[0_0_20px_rgba(6,182,212,0.6)] animate-pulse" />
          <FlowDivider isActive={flowState === 'thinking' || flowState === 'speaking'} />
          
          <FlowStep icon={Brain} label="Think" isActive={flowState === 'thinking'} isPast={flowState === 'speaking'} activeColor="bg-purple-500/80 shadow-[0_0_20px_rgba(168,85,247,0.6)] animate-pulse" />
          <FlowDivider isActive={flowState === 'speaking'} />
          
          <FlowStep icon={Volume2} label="Speak" isActive={flowState === 'speaking'} isPast={false} activeColor="bg-pink-500/80 shadow-[0_0_20px_rgba(236,72,153,0.6)] animate-pulse" />
        </div>
      </div>

      <style>{`
        @keyframes blob-idle {
          0% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: scale(1); }
          50% { border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%; transform: scale(1.02); }
          100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: scale(1); }
        }
        @keyframes blob-speaking {
          0% { border-radius: 40% 60% 70% 30% / 40% 40% 60% 50%; transform: scale(1.05); }
          25% { border-radius: 70% 30% 50% 50% / 30% 30% 70% 70%; transform: scale(1.1); }
          50% { border-radius: 100% 60% 60% 100% / 100% 100% 60% 60%; transform: scale(1.05); }
          75% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; transform: scale(1.1); }
          100% { border-radius: 40% 60% 70% 30% / 40% 40% 60% 50%; transform: scale(1.05); }
        }
        @keyframes blob-listening {
          0% { border-radius: 50% 50% 50% 50% / 50% 50% 50% 50%; transform: scale(0.95); }
          50% { border-radius: 45% 55% 45% 55% / 55% 45% 55% 45%; transform: scale(0.98); }
          100% { border-radius: 50% 50% 50% 50% / 50% 50% 50% 50%; transform: scale(0.95); }
        }
        @keyframes eyes-blink {
          0%, 45%, 55%, 100% { transform: scaleY(1) translateY(-50%); }
          50% { transform: scaleY(0.1) translateY(-50%); }
        }
        @keyframes mouth-speak {
          0% { height: 4%; width: 10%; border-radius: 50px; transform: translateX(-50%); }
          15% { height: 20%; width: 12%; border-radius: 40% 40% 90% 90%; transform: translateX(-50%); }
          30% { height: 6%; width: 16%; border-radius: 50px; transform: translateX(-50%); }
          45% { height: 12%; width: 22%; border-radius: 50%; transform: translateX(-50%); }
          60% { height: 5%; width: 8%; border-radius: 50px; transform: translateX(-50%); }
          75% { height: 18%; width: 15%; border-radius: 30% 30% 80% 80%; transform: translateX(-50%); }
          90% { height: 8%; width: 20%; border-radius: 40px; transform: translateX(-50%); }
          100% { height: 4%; width: 10%; border-radius: 50px; transform: translateX(-50%); }
        }
        @keyframes gradient-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .agent-blob-idle { animation: blob-idle 6s ease-in-out infinite; }
        .agent-blob-speaking { animation: blob-speaking 2.5s ease-in-out infinite; }
        .agent-blob-listening { animation: blob-listening 4s ease-in-out infinite; }
        .eyes-animate { animation: eyes-blink 6s ease-in-out infinite; }
        .mouth-animate { animation: mouth-speak 1.4s ease-in-out infinite; }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-15px); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-float { animation: float 6s ease-in-out infinite; }
      `}</style>

      {/* SVG Filters for Plasma Edge Effect */}
      <svg className="hidden">
        <filter id="plasma-edge">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" result="noise">
            <animate attributeName="baseFrequency" values="0.03;0.04;0.03" dur="8s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="30" xChannelSelector="R" yChannelSelector="G" result="displaced" />
          <feGaussianBlur in="displaced" stdDeviation="5" result="blur" />
          <feComponentTransfer in="blur" result="glow">
            <feFuncA type="linear" slope="1.2" intercept="-0.1" />
          </feComponentTransfer>
        </filter>
        <filter id="noise-overlay">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
        </filter>
      </svg>

      {/* Animated Agent Blob */}
      <div className={`absolute inset-0 overflow-hidden flex items-center justify-center transition-opacity duration-1000 z-0 pointer-events-none ${phase >= 2 && phase < 3 ? 'opacity-100' : 'opacity-0'}`}>
        <div className="relative flex items-center justify-center w-[300px] h-[300px] sm:w-[400px] sm:h-[400px] animate-float">
          
          {/* Ethereal Plasma Body */}
          <div 
            className="absolute w-[260px] h-[260px] sm:w-[360px] sm:h-[360px] transition-transform duration-700 ease-in-out flex items-center justify-center"
            style={{ 
              filter: 'url(#plasma-edge)',
              transform: globeState === 'ai-talking' ? 'scale(1.15)' : globeState === 'listening-silent' ? 'scale(0.95)' : 'scale(1)'
            }}
          >
            {/* Core Energy */}
            <div 
              className={`absolute w-full h-full rounded-full transition-all duration-1000 opacity-90
                ${globeState === 'ai-talking' ? 'agent-blob-speaking' : globeState === 'user-talking' || globeState === 'listening-silent' ? 'agent-blob-listening' : 'agent-blob-idle'}
              `}
              style={{
                background: globeState === 'idle' 
                  ? 'radial-gradient(circle at 40% 40%, rgba(100,150,255,1) 0%, rgba(50,80,200,0.9) 40%, rgba(20,40,150,0.5) 70%, transparent 100%)' 
                  : 'radial-gradient(circle at 40% 40%, rgba(255,154,158,1) 0%, rgba(161,196,253,0.9) 40%, rgba(194,233,251,0.5) 70%, transparent 100%)',
                animation: `${globeState === 'ai-talking' ? 'blob-speaking 2s, spin 8s linear infinite' : 'blob-idle 6s, spin 15s linear infinite reverse'}`,
              }}
            ></div>
            
            {/* Secondary Energy Waves */}
            <div 
              className={`absolute w-[90%] h-[90%] rounded-full mix-blend-screen transition-all duration-1000 opacity-80
                ${globeState === 'ai-talking' ? 'agent-blob-speaking' : globeState === 'user-talking' || globeState === 'listening-silent' ? 'agent-blob-listening' : 'agent-blob-idle'}
              `}
              style={{
                background: globeState === 'idle'
                  ? 'radial-gradient(circle at 60% 60%, rgba(120,200,255,1) 0%, rgba(60,100,220,0.8) 50%, transparent 100%)'
                  : 'radial-gradient(circle at 60% 60%, rgba(254,207,239,1) 0%, rgba(102,126,234,0.8) 50%, transparent 100%)',
                animation: `${globeState === 'ai-talking' ? 'blob-speaking 1.5s, spin 5s linear infinite reverse' : 'blob-listening 5s, spin 10s linear infinite'}`,
              }}
            ></div>
          </div>

          {/* Noise / Grain Overlay (unfiltered so it remains sharp) */}
          <div 
            className="absolute w-[240px] h-[240px] sm:w-[340px] sm:h-[340px] rounded-full opacity-[0.25] mix-blend-overlay pointer-events-none transition-all duration-700"
            style={{ 
              backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.8\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")',
              maskImage: 'radial-gradient(circle at center, black 40%, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(circle at center, black 40%, transparent 70%)',
              transform: globeState === 'ai-talking' ? 'scale(1.15)' : globeState === 'listening-silent' ? 'scale(0.95)' : 'scale(1)'
            }}
          />

          {/* Outer Ambient Glow */}
          <div className={`absolute w-[280px] h-[280px] sm:w-[380px] sm:h-[380px] rounded-full blur-[40px] opacity-40 transition-all duration-700 -z-10
            ${globeState === 'ai-talking' ? 'bg-pink-500 scale-110 animate-pulse' : globeState === 'listening-silent' ? 'bg-cyan-500 scale-90' : 'bg-purple-500 scale-100'}
          `} />

          {/* Eyes & Mouth Container */}
          <div className={`absolute w-[220px] h-[220px] sm:w-[320px] sm:h-[320px] transition-transform duration-500 ${globeState === 'ai-talking' ? 'scale-110' : globeState === 'user-talking' ? 'translate-x-4' : ''}`}>
            <div className="absolute top-[45%] left-[32%] w-[12%] h-[22%] bg-[#0a0a0a] rounded-full eyes-animate shadow-[0_0_15px_rgba(255,255,255,0.4),inset_0_2px_4px_rgba(0,0,0,0.8)] border border-black/20 backdrop-blur-sm"></div>
            <div className="absolute top-[45%] right-[32%] w-[12%] h-[22%] bg-[#0a0a0a] rounded-full eyes-animate shadow-[0_0_15px_rgba(255,255,255,0.4),inset_0_2px_4px_rgba(0,0,0,0.8)] border border-black/20 backdrop-blur-sm"></div>
            
            {/* Mouth */}
            <div className={`absolute top-[70%] left-1/2 -translate-x-1/2 bg-[#0a0a0a] transition-all duration-300 shadow-[0_0_15px_rgba(255,255,255,0.4),inset_0_2px_4px_rgba(0,0,0,0.8)] border border-black/20 backdrop-blur-sm
              ${globeState === 'ai-talking' ? 'w-[15%] h-[4%] mouth-animate' : globeState === 'listening-silent' ? 'w-[6%] h-[2%] rounded-full' : 'w-[10%] h-[1.5%] rounded-full'}
            `}></div>
          </div>
        </div>
      </div>

      {/* Main Content Area (Subtitles) */}
      <div className={`relative z-10 flex flex-col w-full h-full pb-[140px] pt-24 px-8 transition-all duration-[1500ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${phase === 0 ? 'translate-y-[100vh] scale-0 opacity-0' : phase === 1 ? 'translate-y-0 scale-50 opacity-0' : phase === 2 ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-[50vh] translate-x-[50vw] scale-0 opacity-0'}`}>
        
        {/* TOP: AI Subtitles */}
        <div className="w-full flex justify-center text-center">
          <div className="max-w-4xl min-h-[120px] flex flex-col items-center justify-start mt-4">
            {!isPlaying && !isMicOn && !isStreaming ? (
              <p className="text-white/30 text-xl font-light tracking-widest uppercase animate-pulse">
                Ready
              </p>
            ) : isStreaming && !isPlaying ? (
              <p className="text-white/50 text-xl font-mono animate-pulse">
                Thinking...
              </p>
            ) : displayedAiWords ? (
              <div className="animate-in fade-in slide-in-from-top-4 duration-300">
                <p className="text-white text-5xl md:text-6xl font-semibold tracking-tight leading-tight drop-shadow-[0_0_30px_rgba(255,255,255,0.4)]">
                  {displayedAiWords}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex-1" />

        {/* BOTTOM: User Subtitles */}
        <div className="w-full flex justify-center text-center">
          <div className="max-w-3xl min-h-[80px] flex flex-col items-center justify-end mb-4">
            {userSubtitle && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <p className="text-white/60 text-2xl md:text-3xl font-medium tracking-wide leading-relaxed drop-shadow-md">
                  {userSubtitle}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Bar Controls */}
      <div className={`absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-[#050505] via-[#050505]/80 to-transparent flex items-end justify-center pb-8 z-50 transition-opacity duration-1000 ${phase >= 2 && phase < 3 ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex items-center gap-8 pointer-events-auto">
          <FaceToggle />
          <button 
            onClick={() => {
              // Ensure we send any pending words if the user turns off the mic manually
              if (isMicOn && currentTranscriptRef.current.trim().length > 0) {
                onSend(currentTranscriptRef.current, null, { mode: 'instant', thinking: false, search: false });
                currentTranscriptRef.current = "";
                setUserSubtitle("");
              }
              setIsMicOn(!isMicOn);
            }}
            className={`p-5 rounded-full backdrop-blur-xl border transition-all duration-300 shadow-xl ${isMicOn ? 'bg-white/20 border-white/50 text-white shadow-[0_0_30px_rgba(255,255,255,0.4)] hover:bg-white/30' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80'}`}
          >
            {isMicOn ? <Mic size={26} /> : <MicOff size={26} />}
          </button>
        </div>
      </div>
    </div>
  );
}
