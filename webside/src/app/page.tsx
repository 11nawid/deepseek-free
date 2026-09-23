"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useChat } from "@/hooks/useChat";
import { useAgent } from "@/hooks/useAgent";
import PromptInput from "@/components/PromptInput";
import Onboarding from "@/components/Onboarding";
import VoiceCallScreen from "@/components/VoiceCallScreen";
import ScreenRecorder from "@/components/ScreenRecorder";
import AgentProjectsScreen from "@/components/AgentProjectsScreen";
import { AgentWorkspacePanel } from "@/components/AgentWorkspacePanel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Zap, BrainCircuit, X, Loader2, ChevronRight, ChevronLeft, Hash, Globe, ArrowDown, Phone, Plus, MessageSquareText, Trash2, ChevronDown, Clock, Sparkles, Terminal } from "lucide-react";
import ArrowDown2 from "iconsax-react/dist/esm/ArrowDown2";
import Microphone2 from "iconsax-react/dist/esm/Microphone2";
import MessageAdd from "iconsax-react/dist/esm/MessageAdd";
import Setting4 from "iconsax-react/dist/esm/Setting4";
import { t, setLanguage, getLanguage, isRTL } from "@/lib/i18n";
import { useTheme } from "@/lib/theme-provider";
import { FileText } from "lucide-react"; // Make sure FileText is imported if not already

const ANIMATION_SETS = [
  ["[=   ]", "[==  ]", "[=== ]", "[ ===]", "[  ==]", "[   =]"],
  ["( •_•)", "( •_•)>⌐■-■", "(⌐■_■)", "( •_•)>⌐■-■", "( •_•)"],
  ["◐", "◓", "◑", "◒"],
  ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  ["[>  ]", "[>> ]", "[>>>]", "[ >>]", "[  >]", "[   ]"]
];

const AsciiLoader = ({ status = "thinking" }: { status?: string }) => {
  const [frame, setFrame] = useState(0);
  const [animSetIndex, setAnimSetIndex] = useState(0);
  
  useEffect(() => {
    setAnimSetIndex(Math.floor(Math.random() * ANIMATION_SETS.length));
  }, []);

  const frames = ANIMATION_SETS[animSetIndex];
  
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % frames.length), 200);
    return () => clearInterval(timer);
  }, [frames]);
  
  return (
    <div className="flex items-center gap-2 mt-2 font-mono text-accent text-sm">
      <span className="whitespace-pre min-w-[4ch] inline-block">{frames[frame]}</span>
      <span className="animate-pulse">{status}...</span>
    </div>
  );
};

// Agent: helpers for accurate UI — status, diff, and file outcomes
function parseDiffFromResult(result?: string): { added: number; removed: number } {
  if (!result) return { added: 0, removed: 0 };
  const m = result.match(/DIFF:\s*\+(\d+)\s*-(\d+)/);
  if (m) return { added: parseInt(m[1], 10), removed: parseInt(m[2], 10) };
  return { added: 0, removed: 0 };
}

// Returns all file-touching tool calls with rich metadata for UI cards
function getAgentFileOutcomes(toolCalls: any[] = []) {
  const results: any[] = [];
  for (const tc of toolCalls) {
    const name = tc.toolName;
    if (name === "write_file") {
      const fp = tc.input?.filepath || "unknown";
      const ok = tc.result?.toLowerCase().includes("successfully wrote") || tc.result?.toLowerCase().includes("success");
      const failed = tc.result?.toLowerCase().includes("error");
      const { added, removed } = parseDiffFromResult(tc.result);
      results.push({ type: "write", filepath: fp, ok: !!ok, failed: !!failed, state: tc.state, added, removed, result: tc.result });
    } else if (name === "delete_file") {
      const fp = tc.input?.filepath || "unknown";
      const ok = tc.result?.toLowerCase().includes("successfully deleted");
      const failed = tc.result?.toLowerCase().includes("error");
      results.push({ type: "delete", filepath: fp, ok: !!ok, failed: !!failed, state: tc.state, added: 0, removed: 0, result: tc.result });
    } else if (name === "delete_directory") {
      const fp = tc.input?.dirpath || "unknown";
      const ok = tc.result?.toLowerCase().includes("successfully deleted");
      const failed = tc.result?.toLowerCase().includes("error");
      results.push({ type: "delete_dir", filepath: fp, ok: !!ok, failed: !!failed, state: tc.state, added: 0, removed: 0, result: tc.result });
    } else if (name === "move_file") {
      const src = tc.input?.sourcePath || tc.input?.from || "?";
      const dst = tc.input?.destPath || tc.input?.to || "?";
      const ok = tc.result?.toLowerCase().includes("successfully moved");
      const failed = tc.result?.toLowerCase().includes("error");
      results.push({ type: "move", filepath: `${src} → ${dst}`, ok: !!ok, failed: !!failed, state: tc.state, added: 0, removed: 0, result: tc.result });
    } else if (name === "create_directory") {
      const fp = tc.input?.dirpath || "unknown";
      const ok = tc.result?.toLowerCase().includes("successfully created");
      const failed = tc.result?.toLowerCase().includes("error");
      results.push({ type: "mkdir", filepath: fp, ok: !!ok, failed: !!failed, state: tc.state, added: 0, removed: 0, result: tc.result });
    }
  }
  return results;
}

function getAgentChangedSummary(toolCalls: any[] = []) {
  const outcomes = getAgentFileOutcomes(toolCalls);
  const writes = outcomes.filter((f) => f.type === "write" && f.ok && !f.failed);
  const deletes = outcomes.filter((f) => (f.type === "delete" || f.type === "delete_dir") && f.ok);
  const moves = outcomes.filter((f) => f.type === "move" && f.ok);
  const mkdirs = outcomes.filter((f) => f.type === "mkdir" && f.ok);
  let totalAdded = 0, totalRemoved = 0;
  for (const f of writes) { totalAdded += f.added; totalRemoved += f.removed; }
  const reads = toolCalls.filter((tc: any) => tc.toolName === "read_file" && tc.state === "result").length;
  const explored = toolCalls.filter((tc: any) => tc.toolName === "list_files").length + reads;
  const count = writes.length + deletes.length + moves.length + mkdirs.length;
  return { files: writes, deletes, moves, mkdirs, totalAdded, totalRemoved, reads, explored, count };
}

function getAgentStatus(msg: any): string {
  if (!msg?.isStreaming) return "";
  const tcs: any[] = msg.toolCalls || [];
  if (tcs.length > 0) {
    const pending = [...tcs].reverse().find((tc) => tc.state === "call");
    const last = pending || tcs[tcs.length - 1];
    if (last) {
      if (last.state === "call") {
        if (last.toolName === "list_files") return `Exploring ${last.input?.dirpath || "."}...`;
        if (last.toolName === "read_file") return `Reading ${last.input?.filepath || "file"}...`;
        if (last.toolName === "write_file") return `Writing ${last.input?.filepath || "file"}...`;
        if (last.toolName === "delete_file") return `Deleting ${last.input?.filepath || "file"}...`;
        if (last.toolName === "delete_directory") return `Deleting ${last.input?.dirpath || "folder"}...`;
        if (last.toolName === "move_file") return `Moving ${last.input?.sourcePath || "file"}...`;
        if (last.toolName === "create_directory") return `Creating ${last.input?.dirpath || "folder"}...`;
        if (last.toolName === "execute_command") {
          const cmd = (last.input?.command || "").slice(0, 28);
          return `Running ${cmd || "command"}...`;
        }
        return `Calling ${last.toolName}...`;
      }
      const hasPending = tcs.some((tc) => tc.state === "call");
      if (hasPending) return "Working...";
      if (!msg.content) return "Thinking...";
    }
  }
  if (!msg.content && !msg.toolCalls?.length) return "Thinking...";
  if (msg.content && msg.isStreaming) return "Writing summary...";
  return "Thinking...";
}

export default function Home() {
  const { messages, sendMessage, stopGeneration, isLoading, isChatLoading, loadChat, newChat, currentChatId, mode, setMode, searchEnabled, setSearchEnabled, thinkingEnabled, setThinkingEnabled } = useChat();
  // ——— AGENT MODE: fully isolated from useChat (different route, different state, different storage) ———
  // useChat → http://localhost:8000/api/chat  (Python DeepSeek proxy, normal chat)
  // useAgent → /api/agent (Next.js Vercel AI SDK tool-loop, autonomous filesystem agent)
  const [activeAgentProject, setActiveAgentProject] = useState<any>(null);
  const [activeAgentSession, setActiveAgentSession] = useState<any>(null);
  const agent = useAgent({ projectPath: activeAgentProject?.path || "" });
  const [appReady, setAppReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVoiceCallOpen, setIsVoiceCallOpen] = useState(false);
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const [appMode, setAppMode] = useState<"chat" | "agent">("chat");
  const [agentScreenState, setAgentScreenState] = useState<"projects" | "chat">("projects");
  const { theme, resolvedTheme, setTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<"general" | "auth" | "api" | "about">("general");
  const [sysPrompt, setSysPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  
  const [agentProvider, setAgentProvider] = useState("deepseek-free");
  const [geminiModel, setGeminiModel] = useState("gemini-1.5-pro");
  const [deepseekApiKey, setDeepseekApiKey] = useState("");
  const [deepseekApiModel, setDeepseekApiModel] = useState("deepseek-chat");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showChatDropdown, setShowChatDropdown] = useState(false);
  const [chatList, setChatList] = useState<any[]>([]);
  const chatDropdownRef = useRef<HTMLDivElement>(null);

  const fetchChats = () => {
    const apiKey = localStorage.getItem("apiKey") || "";
    fetch("http://localhost:8000/api/chat", {
      headers: { "Authorization": `Bearer ${apiKey}` }
    })
      .then(res => res.json())
      .then(data => setChatList(data.slice(0, 20)))
      .catch(() => {});
  };

  useEffect(() => {
    fetchChats();
  }, [currentChatId, showChatDropdown]);

  useEffect(() => {
    import("@/lib/whisper").then(m => m.preloadWhisper());
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (chatDropdownRef.current && !chatDropdownRef.current.contains(e.target as Node)) {
        setShowChatDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleDeleteChat = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const apiKey = localStorage.getItem("apiKey") || "";
      const res = await fetch(`http://localhost:8000/api/chat/${id}`, {
        method: 'DELETE',
        headers: { "Authorization": `Bearer ${apiKey}` }
      });
      if (res.ok) {
        setChatList(prev => prev.filter(c => c.id !== id));
        if (currentChatId === id) newChat();
      } else {
        fetchChats();
      }
    } catch {
      fetchChats();
    }
  };

  // ——— Isolated display helpers: Agent state is NEVER mixed with Chat state ———
  const isAgentChat = appMode === "agent" && agentScreenState === "chat";
  const displayedMessages = isAgentChat ? agent.messages : messages;
  const displayedIsLoading = isAgentChat ? agent.isLoading : isLoading;
  // Trigger workspace refresh when files change
  const workspaceRefreshKey = isAgentChat ? displayedMessages.length + (displayedMessages[displayedMessages.length - 1] as any)?.toolCalls?.length || 0 : 0;

  // Load agent session history when resuming (real DB, not chat storage)
  useEffect(() => {
    if (isAgentChat && activeAgentSession?.id) {
      fetch(`/api/agent/sessions/${activeAgentSession.id}`)
        .then((r) => r.json())
        .then((sess) => {
          if (sess?.messages && Array.isArray(sess.messages)) {
            const mapped = sess.messages.map((m: any) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              toolCalls: m.toolCalls,
              isStreaming: false,
            }));
            agent.setMessages(mapped);
          }
        })
        .catch(() => {});
    }
  }, [activeAgentSession?.id, isAgentChat]);

  // Persist agent messages after each turn completes (for real history)
  const lastPersistRef = useRef<string>("");
  useEffect(() => {
    if (!isAgentChat || !activeAgentSession?.id) return;
    if (displayedIsLoading) return; // wait until streaming done
    if (displayedMessages.length === 0) return;
    const last = displayedMessages[displayedMessages.length - 1];
    if (!last || last.isStreaming) return;
    // avoid duplicate persists
    const fingerprint = `${displayedMessages.length}:${last.id}:${last.content.slice(0, 30)}`;
    if (lastPersistRef.current === fingerprint) return;
    lastPersistRef.current = fingerprint;
    // Persist last two messages (user + assistant) incrementally; backend will append
    // Simpler: we POST only if server history shorter — handled by store's dedup via length check outside
    // Instead, POST the last message if it hasn't been saved yet
    fetch(`/api/agent/sessions/${activeAgentSession.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: last.role, content: last.content, toolCalls: (last as any).toolCalls }),
    }).catch(() => {});
  }, [displayedMessages, displayedIsLoading, isAgentChat, activeAgentSession?.id]);

  // Unified send that routes to the correct backend (critical: no mixing)
  const handleSend = async (text: string, fileData: any) => {
    if (isAgentChat) {
      let sessionId = activeAgentSession?.id;
      // Auto-create session if needed (real DB)
      if (!sessionId && activeAgentProject?.id) {
        try {
          const res = await fetch(`/api/agent/projects/${activeAgentProject.id}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: text.slice(0, 48) }),
          });
          const sess = await res.json();
          if (res.ok) {
            setActiveAgentSession(sess);
            sessionId = sess.id;
          }
        } catch {}
      }
      if (sessionId) {
        fetch(`/api/agent/sessions/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: text }),
        }).catch(() => {});
      }
      agent.sendMessage(text, sessionId, activeAgentProject?.id);
    } else {
      sendMessage(text, fileData);
    }
  };
  const handleStop = () => {
    if (isAgentChat) agent.stopGeneration();
    else stopGeneration();
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, agent.messages]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isScrolledUp = scrollHeight - scrollTop - clientHeight > 100;
    setShowScrollButton(isScrolledUp);
  };

  const [showAuthSetup, setShowAuthSetup] = useState(false);
  const [setupToken, setSetupToken] = useState("");

  useEffect(() => {
    setLanguage(getLanguage());
    const onboardingDone = localStorage.getItem("onboarding-complete");
    if (!onboardingDone) {
      setShowOnboarding(true);
      setAppReady(true);
      return;
    }
    const timer = setTimeout(() => {
      setAppReady(true);
      if (!localStorage.getItem("apiKey")) {
        setShowAuthSetup(true);
      }
    }, 1500);
    setSysPrompt(localStorage.getItem("systemPrompt") || "");
    setApiKey(localStorage.getItem("apiKey") || "");
    setGeminiKey(localStorage.getItem("geminiKey") || "");
    setAgentProvider(localStorage.getItem("agentProvider") || "deepseek-free");
    setGeminiModel(localStorage.getItem("geminiModel") || "gemini-1.5-pro");
    setDeepseekApiKey(localStorage.getItem("deepseekApiKey") || "");
    setDeepseekApiModel(localStorage.getItem("deepseekApiModel") || "deepseek-chat");
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dir = isRTL() ? "rtl" : "ltr";
    document.documentElement.lang = getLanguage();
  });

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    setAppReady(false);
    setTimeout(() => {
      setAppReady(true);
      if (!localStorage.getItem("apiKey")) {
        setShowAuthSetup(true);
      }
    }, 1500);
    setSysPrompt(localStorage.getItem("systemPrompt") || "");
    setApiKey(localStorage.getItem("apiKey") || "");
    setGeminiKey(localStorage.getItem("geminiKey") || "");
    setAgentProvider(localStorage.getItem("agentProvider") || "deepseek-free");
    setGeminiModel(localStorage.getItem("geminiModel") || "gemini-1.5-pro");
    setDeepseekApiKey(localStorage.getItem("deepseekApiKey") || "");
    setDeepseekApiModel(localStorage.getItem("deepseekApiModel") || "deepseek-chat");
  }, []);

  const handleSaveSetupToken = () => {
    if (!setupToken.trim()) return;
    localStorage.setItem("apiKey", setupToken.trim());
    setApiKey(setupToken.trim());
    setShowAuthSetup(false);
  };

  const saveSettings = () => {
    localStorage.setItem("systemPrompt", sysPrompt);
    localStorage.setItem("apiKey", apiKey);
    localStorage.setItem("geminiKey", geminiKey);
    localStorage.setItem("agentProvider", agentProvider);
    localStorage.setItem("geminiModel", geminiModel);
    localStorage.setItem("deepseekApiKey", deepseekApiKey);
    localStorage.setItem("deepseekApiModel", deepseekApiModel);
    setIsSettingsOpen(false);
  };

  const handleDeleteAllChats = async () => {
    if (!confirm("Are you sure you want to delete ALL chats locally? This action cannot be undone.")) return;
    try {
      const res = await fetch("http://127.0.0.1:8000/api/chat", { method: "DELETE" });
      if (res.ok) {
        window.location.reload();
      } else {
        alert("Failed to delete chats.");
      }
    } catch (err) {
      alert("Error deleting chats. Is the backend running?");
    }
  };

  const texts = t();

  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  if (!appReady) return null;

  const approximateTokens = displayedMessages.reduce((acc, msg: any) => acc + (msg.content?.length || 0) / 4 + ((msg as any).thinking?.length || 0) / 4, 0);
  const maxTokens = 128000;
  const contextPercentage = Math.min(100, Math.max(0, (approximateTokens / maxTokens) * 100));

  return (
    <>
      <div dir={isRTL() ? "rtl" : "ltr"} className="contents">
        <main className="flex-1 flex flex-row relative overflow-hidden z-10 select-none cursor-default">
          
          {/* Main Content Column */}
          <div className="flex-1 flex flex-col relative overflow-hidden">
            
            {/* Top bar */}
            <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 pt-4 pb-4 pointer-events-none bg-gradient-to-b from-background via-background/90 to-transparent">
              <div className="flex items-center gap-3 pointer-events-auto flex-wrap sm:flex-nowrap">
                {/* Left: Chat dropdown + New Chat (Only in Chat Mode) */}
                {appMode === 'chat' && (
                <div className="flex items-center gap-1.5 px-1.5 py-1.5 bg-panel/80 backdrop-blur-md border border-foreground/10 rounded-full shadow-md transition-all hover:shadow-lg" ref={chatDropdownRef}>
                {/* Chat list dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowChatDropdown(!showChatDropdown)}
                    className="h-10 pl-4 pr-3 rounded-full flex items-center justify-center gap-1.5 text-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
                    title={texts.sidebar.recent}
                  >
                    <span className="text-sm font-semibold tracking-tight hidden sm:inline">Chats</span>
                    <ArrowDown2 size="16" color="currentColor" variant="Bold" />
                  </button>
                  {showChatDropdown && (
                    <div className="absolute top-14 left-0 z-50">
                      <div className="absolute -top-1.5 left-8 w-4 h-4 bg-panel border-t border-l border-foreground/5 rotate-45 rounded-tl-sm" />
                      <div className="relative w-80 max-w-[90vw] bg-panel/80 backdrop-blur-3xl border border-foreground/5 rounded-[24px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.2)] overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-4 duration-200">
                        <div className="px-4 py-3 border-b border-foreground/5 bg-foreground/[0.02]">
                          <span className="text-[11px] font-bold text-muted uppercase tracking-wider">{texts.sidebar.recent}</span>
                        </div>
                        <nav className="max-h-72 overflow-y-auto p-2 space-y-1">
                          {chatList.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-10 opacity-60">
                              <Clock size="32" className="mb-2 text-muted" />
                              <p className="text-sm text-muted">No conversations yet</p>
                            </div>
                          )}
                          {chatList.map((chat) => {
                            const chatTime = new Date(chat.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            return (
                            <div
                              key={chat.id}
                              onClick={() => { loadChat(chat.id); setShowChatDropdown(false); }}
                              className={`group flex items-center justify-between px-4 py-3.5 rounded-[18px] transition-all cursor-pointer w-full ${currentChatId === chat.id ? 'bg-background shadow-sm text-foreground font-semibold scale-[1.01]' : 'text-foreground/70 hover:bg-background/80 hover:shadow-sm hover:scale-[1.01] hover:text-foreground'}`}
                            >
                              <div className="flex flex-col items-start gap-1 flex-1 min-w-0 pr-3">
                                <span className="text-[13px] font-medium leading-tight truncate w-full text-left">{chat.title || "New Conversation"}</span>
                                <span className="text-[10px] text-muted opacity-80">{chatTime}</span>
                              </div>
                              {currentChatId === chat.id && <div className="w-1.5 h-1.5 rounded-full bg-accent" />}
                            </div>
                            );
                          })}
                        </nav>
                      </div>
                    </div>
                  )}
                </div>

                <div className="w-[1px] h-4 bg-foreground/10" />
                <button
                  onClick={newChat}
                  className="h-10 w-10 rounded-full flex items-center justify-center text-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
                  title={texts.sidebar.newChat}
                >
                  <MessageAdd size="20" color="currentColor" variant="Bold" />
                </button>
              </div>
              )}

              {appMode === 'agent' && agentScreenState === 'chat' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAgentScreenState("projects")}
                    className="flex items-center gap-1 text-muted hover:text-foreground transition-colors cursor-pointer font-semibold text-[13px]"
                  >
                    <ChevronLeft size={16} /> Back
                  </button>
                  {activeAgentProject && (
                    <>
                      <span className="text-muted/30 mx-1">|</span>
                      <div className="flex items-center text-muted font-medium text-[13px]">
                        <span className="text-foreground">{activeAgentProject.name}</span>
                        <ChevronRight size={14} className="mx-1.5 opacity-50" />
                        <span className="text-foreground">{activeAgentSession?.name || 'New session'}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Chat / Agent Mode Toggle */}
              <div className="flex items-center gap-2 sm:gap-3 ml-0 sm:ml-2">
                <span className={`text-[12px] sm:text-[13px] font-semibold tracking-wide transition-colors duration-300 ${appMode === "chat" ? "text-foreground" : "text-muted"}`}>Chat</span>
                <button
                  onClick={() => {
                    const nextMode = appMode === "chat" ? "agent" : "chat";
                    setAppMode(nextMode);
                    if (nextMode === "agent") {
                      setMode("instant");
                      setAgentScreenState("projects");
                    }
                  }}
                  className={`relative w-[56px] sm:w-[64px] h-[28px] sm:h-[32px] rounded-full p-1 transition-all duration-500 ease-in-out cursor-pointer shadow-inner border border-foreground/5
                    ${appMode === "agent" ? "bg-indigo-500/20 shadow-[inset_0_0_12px_rgba(99,102,241,0.3)]" : "bg-foreground/10"}`}
                >
                  <div 
                    className={`w-[20px] h-[20px] sm:w-[24px] sm:h-[24px] rounded-full flex items-center justify-center shadow-md transform transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] 
                    ${appMode === "agent" ? "translate-x-[28px] sm:translate-x-[32px] bg-indigo-500 text-white shadow-[0_0_10px_rgba(99,102,241,0.6)]" : "translate-x-0 bg-panel text-foreground"}`}
                  >
                    <div className={`absolute transition-all duration-500 ${appMode === "chat" ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 -rotate-90"}`}>
                      <MessageSquareText size={13} strokeWidth={2.5} />
                    </div>
                    <div className={`absolute transition-all duration-500 ${appMode === "agent" ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 rotate-90"}`}>
                      <Sparkles size={13} strokeWidth={2.5} />
                    </div>
                  </div>
                </button>
                <span className={`text-[12px] sm:text-[13px] font-semibold tracking-wide transition-colors duration-300 ${appMode === "agent" ? "text-indigo-400 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]" : "text-muted"}`}>Agent</span>
              </div>
            </div>

            {/* Right: Settings */}
            <div className="flex items-center gap-3 pointer-events-auto">
              {/* Settings */}
              {appMode === 'chat' && (
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="w-[40px] h-[40px] sm:w-[46px] sm:h-[46px] rounded-full bg-panel/80 backdrop-blur-md border border-foreground/10 shadow-md flex items-center justify-center text-foreground hover:bg-foreground/10 hover:shadow-lg transition-all duration-300 cursor-pointer"
                  title={texts.sidebar.settings}
                >
                  <Setting4 size="22" color="currentColor" variant="Bold" />
                </button>
              )}
            </div>
          </div>

          {appMode === 'agent' && agentScreenState === 'projects' ? (
            <AgentProjectsScreen 
              onStartChat={(project) => { 
                setActiveAgentProject(project);
                setActiveAgentSession(null);
                agent.clearMessages(); 
                setAgentScreenState("chat"); 
              }}
              onResumeChat={(project, session) => {
                setActiveAgentProject(project);
                setActiveAgentSession(session);
                // Clear stale messages when opening a new/empty session
                if (!session?.messages?.length) agent.clearMessages();
                setAgentScreenState("chat");
              }}
              onSettings={() => setIsSettingsOpen(true)}
            />
          ) : (
            <div className="flex-1 flex flex-row overflow-hidden min-h-0">
              <div className="flex-1 flex flex-col relative overflow-hidden">
            {/* Chat scroll container */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto w-full flex flex-col items-center px-2 sm:px-4 pb-48 pt-24 sm:pt-28"
            >
              {isChatLoading && !isAgentChat ? (
              <div className="flex flex-col items-center justify-center w-full h-full mt-20">
                <AsciiLoader />
                <p className="text-muted font-medium mt-2">{texts.chat.loading}</p>
              </div>
            ) : displayedMessages.length === 0 ? (
              appMode === 'chat' ? (
              <div className="flex flex-col items-center justify-center w-full max-w-5xl mt-20">
                <div className="text-center mb-12">
                  <h2 className="text-5xl font-semibold tracking-tight text-foreground mb-6">{texts.chat.greeting}</h2>
                  <p className="text-xl text-muted">Choose a model below to get started</p>
                </div>

                <div className="flex gap-4 w-full max-w-3xl justify-center">
                  <button
                    onClick={() => setMode("instant")}
                    className={`flex-1 flex flex-col items-center p-6 rounded-2xl border-2 transition-all cursor-pointer ${mode === "instant" ? "border-accent bg-accent/5" : "border-transparent bg-panel shadow-soft hover:shadow-float"}`}
                  >
                    <div className={`p-3 rounded-xl mb-4 ${mode === "instant" ? "bg-accent text-accent-foreground" : "bg-input-bg text-muted"}`}>
                      <Zap size={24} />
                    </div>
                    <h3 className="font-bold text-lg mb-1">{texts.chat.instantLabel}</h3>
                    <p className="text-sm text-muted text-center">{texts.chat.instantDesc}</p>
                  </button>

                  {appMode === 'chat' && (
                  <button
                    onClick={() => setMode("expert")}
                    className={`flex-1 flex flex-col items-center p-6 rounded-2xl border-2 transition-all cursor-pointer ${mode === "expert" ? "border-accent bg-accent/5" : "border-transparent bg-panel shadow-soft hover:shadow-float"}`}
                  >
                    <div className={`p-3 rounded-xl mb-4 ${mode === "expert" ? "bg-accent text-accent-foreground" : "bg-input-bg text-muted"}`}>
                      <BrainCircuit size={24} />
                    </div>
                    <h3 className="font-bold text-lg mb-1">{texts.chat.expertLabel}</h3>
                    <p className="text-sm text-muted text-center">{texts.chat.expertDesc}</p>
                  </button>
                  )}
                </div>
              </div>
              ) : (
                <div className="flex flex-col items-center justify-center w-full max-w-5xl mt-32">
                  <Sparkles size={48} className="text-muted/20 mb-6" />
                  <h2 className="text-2xl font-semibold tracking-tight text-foreground/50">How can I help you today?</h2>
                </div>
              )
            ) : (
              <div className="w-full max-w-5xl flex flex-col gap-6 px-4 lg:px-8">
                {displayedMessages.map((msg: any) => (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[90%] rounded-3xl px-6 py-4 ${msg.role === "user" ? "bg-input-bg text-foreground shadow-sm" : "bg-panel text-foreground shadow-soft"}`}>
                      {msg.image && (
                        msg.image.startsWith("data:image/") ? (
                          <img src={msg.image} alt="uploaded" className="max-w-sm rounded-xl mb-4 shadow-sm border border-border" />
                        ) : (
                          <div className="flex items-center gap-3 px-4 py-3 bg-background rounded-xl border border-border mb-4 max-w-sm w-fit select-none">
                            <div className="p-2 bg-foreground/5 rounded-lg">
                              <FileText size={20} className="text-foreground" />
                            </div>
                            <span className="text-sm font-semibold text-foreground truncate">Document attached</span>
                          </div>
                        )
                      )}

                      {msg.role === "user" ? (
                        <p className="whitespace-pre-wrap leading-relaxed text-[15px] break-words select-text cursor-text">
                          {msg.content.replace(/^\[System Instructions:[\s\S]*?\]\n\n/, '')}
                        </p>
                      ) : (
                        <div className="flex flex-col w-full select-text cursor-text">
                          {msg.thinking && (
                            msg.isStreaming && !msg.content ? (
                              <div className="mb-4 pl-4 py-3 border-l-2 border-accent/50 text-foreground/80 text-sm whitespace-pre-wrap font-mono break-words bg-accent/5 rounded-r-xl select-text cursor-text relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-accent to-transparent animate-pulse" />
                                {msg.thinking}
                                <span className="inline-block ml-1 font-mono font-bold text-accent animate-pulse">█</span>
                              </div>
                            ) : (
                              <details className="mb-4 group select-none cursor-pointer">
                                <summary className="text-muted hover:text-foreground text-sm cursor-pointer select-none flex items-center gap-2 mb-2 font-medium">
                                  <BrainCircuit size={16} />
                                  <span className="group-open:hidden">{texts.chat.thinking}</span>
                                  <span className="hidden group-open:inline">Hide thought process</span>
                                  <ChevronRight size={16} className="group-open:rotate-90 transition-transform" />
                                </summary>
                                <div className="pl-4 py-2 border-l-2 border-border text-muted text-sm whitespace-pre-wrap font-mono break-words bg-input-bg rounded-r-xl select-text cursor-text">
                                  {msg.thinking}
                                </div>
                              </details>
                            )
                          )}
                          {msg.search_results && msg.search_results.length > 0 && (
                            <details className="mb-4 group select-none cursor-pointer">
                              <summary className="text-muted hover:text-foreground text-sm cursor-pointer select-none flex items-center gap-2 mb-2 font-medium">
                                <Globe size={16} />
                                <span>Searched {msg.search_results.length} sites</span>
                                <ChevronRight size={16} className="group-open:rotate-90 transition-transform ml-auto" />
                              </summary>
                              <div className="pl-4 py-2 border-l-2 border-border flex flex-col gap-1.5 mb-2 select-text cursor-pointer">
                                {msg.search_results.map((res: any, idx: number) => (
                                  <a key={idx} href={res.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline line-clamp-1 cursor-pointer">
                                    [{idx + 1}] {res.title}
                                  </a>
                                ))}
                              </div>
                            </details>
                          )}
                          {/* Agent tool call trace — compact file cards, NOT raw code in chat */}
                          {msg.toolCalls && msg.toolCalls.length > 0 && (
                            isAgentChat ? (
                              <div className="mb-3 flex flex-col gap-2">
                                <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase text-[#888]">
                                  <Terminal size={12} className="text-indigo-400" /> Agent actions
                                  <span className="ml-auto text-[10px] bg-indigo-500/15 text-indigo-300 px-1.5 py-0.5 rounded-full">{msg.toolCalls.length}</span>
                                </div>
                                <div className="grid grid-cols-1 gap-1.5">
                                  {msg.toolCalls.map((tc: any, idx: number) => {
                                    const done = tc.state === "result";
                                    const pending = !done;
                                    const hasError = tc.result?.toLowerCase().includes("error");

                                    // Determine display label and color per tool
                                    let label = "";
                                    let detail = "";
                                    let colorClass = "bg-[#1a1a1a] border-[#222] text-[#aaa]";
                                    let dotClass = done ? "bg-emerald-500/60" : "bg-amber-500 animate-pulse";
                                    let badge = done ? "done" : "running";

                                    if (tc.toolName === "write_file") {
                                      label = "write";
                                      detail = tc.input?.filepath || "";
                                      colorClass = hasError ? "bg-red-500/10 border-red-500/20 text-red-300" : done ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" : "bg-amber-500/10 border-amber-500/20 text-amber-300";
                                      dotClass = hasError ? "bg-red-400" : pending ? "bg-amber-400 animate-pulse" : "bg-emerald-400";
                                      badge = hasError ? "failed" : done ? "written" : "writing";
                                    } else if (tc.toolName === "delete_file") {
                                      label = "delete file";
                                      detail = tc.input?.filepath || "";
                                      colorClass = hasError ? "bg-red-500/10 border-red-500/20 text-red-300" : done ? "bg-red-500/10 border-red-500/20 text-red-300" : "bg-amber-500/10 border-amber-500/20 text-amber-300";
                                      dotClass = hasError ? "bg-red-400" : pending ? "bg-amber-400 animate-pulse" : "bg-red-400";
                                      badge = hasError ? "failed" : done ? "deleted" : "deleting";
                                    } else if (tc.toolName === "delete_directory") {
                                      label = "delete dir";
                                      detail = tc.input?.dirpath || "";
                                      colorClass = hasError ? "bg-red-500/10 border-red-500/20 text-red-300" : done ? "bg-red-500/10 border-red-500/20 text-red-300" : "bg-amber-500/10 border-amber-500/20 text-amber-300";
                                      dotClass = hasError ? "bg-red-400" : pending ? "bg-amber-400 animate-pulse" : "bg-red-400";
                                      badge = hasError ? "failed" : done ? "deleted" : "deleting";
                                    } else if (tc.toolName === "move_file") {
                                      label = "move";
                                      detail = `${tc.input?.sourcePath || "?"} → ${tc.input?.destPath || "?"}`;
                                      colorClass = hasError ? "bg-red-500/10 border-red-500/20 text-red-300" : done ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-300" : "bg-amber-500/10 border-amber-500/20 text-amber-300";
                                      dotClass = hasError ? "bg-red-400" : pending ? "bg-amber-400 animate-pulse" : "bg-yellow-400";
                                      badge = hasError ? "failed" : done ? "moved" : "moving";
                                    } else if (tc.toolName === "create_directory") {
                                      label = "mkdir";
                                      detail = tc.input?.dirpath || "";
                                      colorClass = hasError ? "bg-red-500/10 border-red-500/20 text-red-300" : done ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-300" : "bg-amber-500/10 border-amber-500/20 text-amber-300";
                                      dotClass = hasError ? "bg-red-400" : pending ? "bg-amber-400 animate-pulse" : "bg-cyan-400";
                                      badge = hasError ? "failed" : done ? "created" : "creating";
                                    } else if (tc.toolName === "read_file") {
                                      label = "read";
                                      detail = tc.input?.filepath || "";
                                    } else if (tc.toolName === "list_files") {
                                      label = "list";
                                      detail = tc.input?.dirpath || ".";
                                    } else if (tc.toolName === "execute_command") {
                                      label = "exec";
                                      detail = (tc.input?.command || "").slice(0, 40);
                                    } else {
                                      label = tc.toolName;
                                      detail = JSON.stringify(tc.input || {}).slice(0, 40);
                                    }

                                    return (
                                      <div key={tc.toolCallId || idx} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs ${colorClass}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
                                        <span className="font-mono font-bold text-[10px] uppercase shrink-0 opacity-70">{label}</span>
                                        <span className="font-mono truncate flex-1">{detail}</span>
                                        <span className="text-[10px] font-bold uppercase shrink-0 opacity-80">{badge}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                                {msg.toolCalls.length > 6 && !msg.isStreaming && (
                                  <span className="text-[11px] text-center text-[#555]">+ {msg.toolCalls.length - 6} more actions in workspace →</span>
                                )}
                              </div>
                            ) : (
                              <details className="mb-4 group select-none cursor-pointer" open={msg.isStreaming}>
                                <summary className="text-muted hover:text-foreground text-sm cursor-pointer select-none flex items-center gap-2 mb-2 font-medium">
                                  <Terminal size={16} className="text-indigo-400" />
                                  <span>Agent used {msg.toolCalls.length} tool{msg.toolCalls.length > 1 ? "s" : ""}</span>
                                  <ChevronRight size={16} className="group-open:rotate-90 transition-transform ml-auto" />
                                </summary>
                                <div className="flex flex-col gap-2">
                                  {msg.toolCalls.map((tc: any, idx: number) => (
                                    <div key={tc.toolCallId || idx} className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 overflow-hidden">
                                      <div className="flex items-center gap-2 px-3 py-2 bg-indigo-500/10 border-b border-indigo-500/10">
                                        <span className="font-mono text-xs font-bold text-indigo-400">{tc.toolName}</span>
                                        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-bold ${tc.state === "result" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400 animate-pulse"}`}>
                                          {tc.state === "result" ? "done" : "running"}
                                        </span>
                                      </div>
                                      <div className="px-3 py-2">
                                        <div className="text-[11px] font-mono text-muted break-all">input: {JSON.stringify(tc.input)}</div>
                                        {tc.result && (
                                          <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg bg-[#0a0a0a] border border-white/5 p-2 text-[11px] font-mono text-emerald-400/80 whitespace-pre-wrap break-all">
                                            {tc.result.slice(0, 3000)}
                                          </pre>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )
                          )}
                          <div className="prose prose-sm md:prose-base prose-p:leading-relaxed prose-pre:bg-[#1e1e1e] dark:prose-pre:bg-[#1a1a1a] prose-pre:border prose-pre:border-border/50 prose-pre:text-gray-100 prose-pre:shadow-md prose-pre:rounded-xl prose-headings:text-foreground prose-headings:font-bold prose-strong:text-foreground prose-strong:font-bold prose-em:text-foreground/90 prose-em:italic prose-a:text-accent hover:prose-a:text-accent/80 prose-a:underline prose-a:underline-offset-2 prose-a:decoration-accent/30 prose-code:text-pink-500 dark:prose-code:text-pink-400 prose-code:bg-pink-500/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-mono prose-code:text-[0.9em] prose-code:before:content-none prose-code:after:content-none prose-blockquote:border-l-accent prose-blockquote:bg-accent/5 prose-blockquote:px-4 prose-blockquote:py-3 prose-blockquote:text-foreground/80 prose-blockquote:rounded-r-xl prose-blockquote:italic prose-ul:text-foreground prose-ol:text-foreground prose-li:text-foreground prose-li:marker:text-muted prose-hr:border-border max-w-none break-words select-text cursor-text">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {(() => {
                                let c = msg.content.replace(/\[(?:citation:)?(\d+)\]/g, (match: string, num: string) => {
                                  const idx = parseInt(num, 10) - 1;
                                  const res = msg.search_results && msg.search_results[idx];
                                  return res && res.url ? `[**${num}**](${res.url})` : `[${num}]`;
                                });
                                // Agent responses render code blocks normally (no stripping)
                                return c;
                              })()}
                            </ReactMarkdown>
                            {msg.isStreaming && !msg.content && !msg.thinking ? (
                              isAgentChat ? <AsciiLoader status={getAgentStatus(msg)} /> : <AsciiLoader status={searchEnabled ? "searching" : "thinking"} />
                            ) : msg.isStreaming && msg.content ? (
                              isAgentChat ? <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted"><span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />{getAgentStatus(msg) || "Writing..."}</span> : <span className="inline-block ml-1 animate-pulse font-mono font-bold text-accent">█</span>
                            ) : null}
                          </div>
                          {/* Agent changed files summary — all tool types */}
                          {isAgentChat && !msg.isStreaming && msg.toolCalls && msg.toolCalls.length > 0 && (() => {
                            const summary = getAgentChangedSummary(msg.toolCalls);
                            if (summary.count === 0 && summary.reads === 0) return null;
                            return (
                              <div className="mt-3 rounded-xl overflow-hidden border border-[#222] bg-[#0e0e0e]">
                                {summary.reads > 0 && (
                                  <div className="px-3 py-2 text-xs text-[#888] border-b border-[#1a1a1a] flex items-center gap-2">
                                    <span className="font-semibold text-[#aaa]">Explored</span>
                                    <span>{summary.reads} reads</span>
                                    {summary.explored > summary.reads && <span className="text-[#555]">· {summary.explored - summary.reads} lists</span>}
                                  </div>
                                )}
                                {summary.count > 0 ? (
                                  <>
                                    <div className="px-3 py-2 flex items-center justify-between bg-[#121212] border-b border-[#1a1a1a]">
                                      <span className="text-xs font-semibold text-white">
                                        {summary.count} action{summary.count > 1 ? "s" : ""}
                                        {summary.files.length > 0 && <> · <span className="text-emerald-500">+{summary.totalAdded}</span> <span className="text-red-500">-{summary.totalRemoved}</span></>}
                                      </span>
                                      <ChevronRight size={12} className="text-[#444]" />
                                    </div>
                                    <div className="divide-y divide-[#1a1a1a]">
                                      {summary.files.map((f: any, i: number) => (
                                        <div key={f.filepath + i} className="flex items-center gap-2 px-3 py-2 text-xs font-mono hover:bg-[#1a1a1a]">
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                          <span className="truncate flex-1 text-[#ccc]">{f.filepath}</span>
                                          <span className="text-emerald-500">+{f.added}</span>
                                          <span className="text-red-500">-{f.removed}</span>
                                        </div>
                                      ))}
                                      {summary.deletes.map((f: any, i: number) => (
                                        <div key={"del" + i} className="flex items-center gap-2 px-3 py-2 text-xs font-mono hover:bg-[#1a1a1a]">
                                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                                          <span className="truncate flex-1 text-[#ccc]">{f.filepath}</span>
                                          <span className="text-red-400 text-[10px] font-bold uppercase">deleted</span>
                                        </div>
                                      ))}
                                      {summary.moves.map((f: any, i: number) => (
                                        <div key={"mv" + i} className="flex items-center gap-2 px-3 py-2 text-xs font-mono hover:bg-[#1a1a1a]">
                                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
                                          <span className="truncate flex-1 text-[#ccc]">{f.filepath}</span>
                                          <span className="text-yellow-400 text-[10px] font-bold uppercase">moved</span>
                                        </div>
                                      ))}
                                      {summary.mkdirs.map((f: any, i: number) => (
                                        <div key={"mk" + i} className="flex items-center gap-2 px-3 py-2 text-xs font-mono hover:bg-[#1a1a1a]">
                                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                                          <span className="truncate flex-1 text-[#ccc]">{f.filepath}</span>
                                          <span className="text-cyan-400 text-[10px] font-bold uppercase">created dir</span>
                                        </div>
                                      ))}
                                    </div>
                                  </>
                                ) : summary.reads > 0 ? (
                                  <div className="px-3 py-2 text-[11px] text-[#555]">No files changed — only exploration</div>
                                ) : null}
                              </div>
                            );
                          })()}

                          {msg.metrics && (
                            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border text-xs text-muted font-medium select-none cursor-default">
                              <div className="flex items-center gap-1.5">
                                <Clock size={14} />
                                <span>{(msg.metrics.timeMs / 1000).toFixed(1)}s</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Hash size={14} />
                                <span>{msg.metrics.tokens} tok</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Scroll to bottom button */}
          {showScrollButton && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-40 right-8 p-3 bg-panel/80 backdrop-blur-md border border-foreground/10 text-foreground rounded-full shadow-float hover:shadow-lg transition-all animate-in fade-in slide-in-from-bottom-4 z-40 cursor-pointer"
            >
              <ArrowDown size={20} />
            </button>
          )}

            {/* Context Window Indicator — uses displayedMessages so Agent/Chat are separate */}
            {displayedMessages.length > 0 && (
              <div className="absolute bottom-6 right-6 sm:bottom-8 sm:right-8 z-40 pointer-events-auto">
                <div className="flex flex-col items-end gap-1.5 opacity-60 hover:opacity-100 transition-opacity duration-300">
                  <div className="flex items-center gap-2 bg-panel/80 backdrop-blur-md border border-foreground/10 px-3 py-1.5 rounded-full shadow-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                      Context: {Math.round(approximateTokens).toLocaleString()} / 128k
                    </span>
                  </div>
                  <div className="w-32 h-1.5 bg-foreground/5 rounded-full overflow-hidden border border-foreground/10 shadow-inner mr-1">
                    <div 
                      className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(52,211,153,0.5)]" 
                      style={{ width: `${contextPercentage}%` }} 
                    />
                  </div>
                </div>
              </div>
            )}

          {isVoiceCallOpen && !isAgentChat && (
            <VoiceCallScreen 
              onClose={() => setIsVoiceCallOpen(false)}
              onSend={sendMessage}
              stopGeneration={stopGeneration}
              latestMessage={messages.length > 0 ? messages[messages.length - 1] : null}
              isStreaming={messages.length > 0 ? messages[messages.length - 1].isStreaming || false : false}
            />
          )}

          {/* Input Area — handler routes to correct backend; never mixed */}
          <div className="absolute bottom-0 left-0 w-full flex flex-col items-center pt-32 pb-4 px-5 pointer-events-none bg-gradient-to-t from-background via-background/90 to-transparent">
            <div className="w-full max-w-4xl pointer-events-auto">
              <PromptInput
                onSend={handleSend}
                isLoading={displayedIsLoading}
                mode={mode}
                searchEnabled={searchEnabled}
                setSearchEnabled={setSearchEnabled}
                thinkingEnabled={thinkingEnabled}
                setThinkingEnabled={setThinkingEnabled}
                isAgentMode={appMode === 'agent'}
              />
              <div className="flex items-center justify-center gap-2 mt-3 text-[10px] text-muted/50 font-medium">
                <span>{texts.settings.builtWith}</span>
                {appMode === 'agent' && activeAgentProject && (
                  <>
                    <span className="opacity-30">•</span>
                    <span className="font-mono text-muted/70">{activeAgentProject.path}</span>
                  </>
                )}
              </div>
            </div>
          </div>
              </div>
              {/* Agent Workspace — only in agent chat, shows real files + activity, not mixed with chat */}
              {isAgentChat && (
                <AgentWorkspacePanel
                  projectPath={activeAgentProject?.path || ""}
                  projectName={activeAgentProject?.name}
                  sessionMessages={displayedMessages as any}
                  refreshKey={workspaceRefreshKey}
                />
              )}
            </div>
          )}
          </div> {/* End of Main Content Column */}

          {/* Right Sidebar (Voice Call + Screen Recorder) */}
          {appMode === 'chat' && (
          <div className="w-[68px] sm:w-[80px] shrink-0 bg-panel/30 backdrop-blur-sm border-l border-foreground/5 flex flex-col items-center justify-center gap-4 z-30 shadow-[-4px_0_24px_rgba(0,0,0,0.02)]">
            <button
              onClick={() => setIsVoiceCallOpen(true)}
              className="group relative flex flex-col items-center gap-2 p-2 sm:p-3 bg-[#1a1a1a]/80 backdrop-blur-md border border-white/5 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.2)] transition-all hover:shadow-lg hover:bg-[#222222]/80 cursor-pointer"
              title="Voice Call"
            >
              <div className="relative w-[42px] h-[42px] sm:w-[48px] sm:h-[48px] rounded-full flex items-center justify-center overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]">
                {/* Glowing Ring */}
                <div className="absolute inset-[-10px] bg-[conic-gradient(from_0deg,transparent_0deg,transparent_60deg,#3b82f6_90deg,#8b5cf6_180deg,#ec4899_270deg,#ef4444_300deg,transparent_360deg)] animate-[spin_4s_linear_infinite]" />
                {/* Inner Dark Circle */}
                <div className="absolute inset-[2px] bg-gradient-to-b from-[#333] to-[#111] rounded-full flex items-center justify-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)] border border-black/50">
                  <Microphone2 size="20" className="text-white drop-shadow-md" variant="Bold" />
                </div>
              </div>
              <span className="font-semibold text-[10px] uppercase tracking-wider text-white/90 pb-2 hidden sm:block">Call</span>
            </button>
            <button
              onClick={() => setIsRecorderOpen(true)}
              className="group relative flex flex-col items-center gap-2 p-2 sm:p-3 bg-[#1a1a1a]/80 backdrop-blur-md border border-white/5 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.2)] transition-all hover:shadow-lg hover:bg-[#222222]/80 cursor-pointer"
              title="Screen Recorder"
            >
              <div className="relative w-[42px] h-[42px] sm:w-[48px] sm:h-[48px] rounded-full flex items-center justify-center overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)]">
                {/* Red glowing ring */}
                <div className="absolute inset-[-10px] bg-[conic-gradient(from_0deg,transparent_0deg,transparent_60deg,#ef4444_90deg,#f97316_180deg,#ef4444_270deg,transparent_360deg)] animate-[spin_4s_linear_infinite]" />
                {/* Inner Dark Circle */}
                <div className="absolute inset-[2px] bg-gradient-to-b from-[#3a1111] to-[#111] rounded-full flex items-center justify-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)] border border-black/50">
                  <span className="w-4 h-4 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.9)]" />
                </div>
              </div>
              <span className="font-semibold text-[10px] uppercase tracking-wider text-white/90 pb-2 hidden sm:block text-center leading-tight">Record</span>
            </button>
          </div>
          )}
          {isRecorderOpen && <ScreenRecorder onClose={() => setIsRecorderOpen(false)} />}
          
        </main>
      </div>

      {/* Auth Setup Modal */}
      {showAuthSetup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-panel rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col p-8">
            <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center mb-6 mx-auto">
              <div className="w-6 h-6 bg-accent-foreground rounded-full"></div>
            </div>
            <h2 className="text-2xl font-bold text-center text-foreground mb-2">{texts.auth.title}</h2>
            <p className="text-sm text-muted text-center mb-8">{texts.auth.desc}</p>

            <div className="mb-6">
              <label className="block text-sm font-semibold text-foreground mb-2">{texts.settings.tokenLabel}</label>
              <input
                type="password"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                placeholder={texts.auth.placeholder}
                className="w-full p-4 rounded-xl border border-border bg-input-bg focus:bg-panel focus:ring-2 focus:ring-accent outline-none transition-all text-sm mb-3"
              />
              <div className="p-3 bg-blue-50/50 border border-blue-100 dark:bg-blue-950/30 dark:border-blue-900 rounded-lg">
                <p className="text-xs text-blue-800 dark:text-blue-300 mb-1 font-semibold">How to get your token:</p>
                <ol className="list-decimal list-inside text-xs text-blue-700 dark:text-blue-400 space-y-1">
                  <li>Log in to chat.deepseek.com</li>
                  <li>Press F12 to open Developer Tools</li>
                  <li>Go to Application &gt; Local Storage</li>
                  <li>Copy the value of <code>userToken</code></li>
                </ol>
              </div>
            </div>

            <button
              onClick={handleSaveSetupToken}
              disabled={!setupToken.trim()}
              className="w-full py-4 bg-accent text-accent-foreground rounded-xl font-medium hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {texts.auth.save}
            </button>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 lg:p-8 animate-in fade-in duration-200">
          <div className="bg-panel rounded-3xl w-full max-w-4xl shadow-float overflow-hidden flex flex-col h-full max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-5 border-b border-border shrink-0">
              <h2 className="text-xl font-bold text-foreground">{texts.settings.title}</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-input-bg rounded-full transition-colors text-muted cursor-pointer">
                <X size={20} />
              </button>
            </div>

            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
              {/* Tabs Sidebar */}
              <div className="w-full md:w-56 bg-input-bg/50 border-r border-border p-4 flex flex-row md:flex-col gap-1 overflow-x-auto shrink-0">
                {[
                  { id: "general" as const, label: texts.settings.general },
                  { id: "auth" as const, label: texts.settings.auth },
                  { id: "api" as const, label: texts.settings.api },
                  { id: "about" as const, label: texts.settings.about },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`text-left whitespace-nowrap px-4 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${activeTab === tab.id ? "bg-panel text-foreground shadow-sm" : "text-muted hover:text-foreground hover:bg-input-bg"}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="flex-1 p-6 md:p-8 overflow-y-auto bg-panel min-h-0">
                {activeTab === "general" && (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <h3 className="text-lg font-bold text-foreground mb-6">{texts.settings.general}</h3>

                    {/* Language */}
                    <div className="mb-6">
                      <label className="block text-sm font-semibold text-foreground mb-2">{texts.onboarding.languageTitle}</label>
                      <div className="flex gap-2">
                        {(["en", "fa"] as const).map((lang) => (
                          <button
                            key={lang}
                            onClick={() => setLanguage(lang)}
                            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                              getLanguage() === lang
                                ? "bg-accent text-accent-foreground"
                                : "bg-input-bg text-muted hover:text-foreground border border-border"
                            }`}
                          >
                            {lang === "en" ? "English" : "فارسی"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Theme */}
                    <div className="mb-6">
                      <label className="block text-sm font-semibold text-foreground mb-2">{texts.onboarding.themeTitle}</label>
                      <div className="flex gap-2">
                        {(["light", "dark", "system"] as const).map((th) => (
                          <button
                            key={th}
                            onClick={() => setTheme(th)}
                            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                              theme === th
                                ? "bg-accent text-accent-foreground"
                                : "bg-input-bg text-muted hover:text-foreground border border-border"
                            }`}
                          >
                            {th === "light" ? texts.onboarding.light : th === "dark" ? texts.onboarding.dark : texts.onboarding.system}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* System Prompt */}
                    <div className="mb-6">
                      <label className="block text-sm font-semibold text-foreground mb-2">{texts.settings.systemPrompt}</label>
                      <textarea
                        value={sysPrompt}
                        onChange={(e) => setSysPrompt(e.target.value)}
                        placeholder="e.g., You are a highly concise coding assistant..."
                        className="w-full h-32 p-4 rounded-xl border border-border bg-input-bg focus:bg-panel focus:ring-2 focus:ring-accent outline-none transition-all text-sm resize-none"
                      />
                      <p className="text-xs text-muted mt-2">{texts.settings.systemPromptDesc}</p>
                    </div>

                    {/* Danger Zone */}
                    <div className="pt-4 border-t border-border">
                      <label className="block text-sm font-semibold text-destructive mb-2">{texts.settings.dangerZone}</label>
                      <div className="flex items-center justify-between p-4 rounded-xl border border-destructive-border bg-destructive-bg">
                        <div>
                          <h4 className="text-sm font-medium text-foreground">{texts.settings.deleteAllChats}</h4>
                          <p className="text-xs text-muted mt-1">{texts.settings.deleteAllDesc}</p>
                        </div>
                        <button
                          onClick={handleDeleteAllChats}
                          className="px-4 py-2 bg-destructive hover:opacity-90 text-white text-sm font-medium rounded-lg transition-colors shadow-sm cursor-pointer"
                        >
                          Delete All
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "auth" && (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <h3 className="text-lg font-bold text-foreground mb-4">Agent Provider Settings</h3>

                    <div className="mb-6">
                      <label className="block text-sm font-semibold text-foreground mb-2">Active Agent Provider</label>
                      <select
                        value={agentProvider}
                        onChange={(e) => setAgentProvider(e.target.value)}
                        className="w-full p-3 rounded-xl border border-border bg-input-bg focus:bg-panel focus:ring-2 focus:ring-accent outline-none transition-all text-sm appearance-none"
                      >
                        <option value="gemini">Google Gemini (Recommended - Native API)</option>
                        <option value="deepseek-api">DeepSeek Official API (Paid Cloud)</option>
                        <option value="deepseek-free">DeepSeek Free (Web Proxy)</option>
                      </select>
                      <p className="text-xs text-muted mt-2">
                        {agentProvider === "gemini" && "Uses Google's Gemini API directly. Extremely stable and supports native tool calling."}
                        {agentProvider === "deepseek-api" && "Uses DeepSeek's official paid API. Reliable and fast."}
                        {agentProvider === "deepseek-free" && "Uses a local proxy to DeepSeek's web interface. Prone to token limits and context breaking."}
                      </p>
                    </div>

                    {agentProvider === "gemini" && (
                      <div className="space-y-6 animate-in fade-in duration-300 pt-4 border-t border-border">
                        <div>
                          <label className="block text-sm font-semibold text-foreground mb-2">Google Gemini API Key</label>
                          <input
                            type="password"
                            value={geminiKey}
                            onChange={(e) => setGeminiKey(e.target.value)}
                            placeholder="e.g. AIzaSyB..."
                            className="w-full p-4 rounded-xl border border-border bg-input-bg focus:bg-panel focus:ring-2 focus:ring-accent outline-none transition-all text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-foreground mb-2">Model Name</label>
                          <input
                            type="text"
                            value={geminiModel}
                            onChange={(e) => setGeminiModel(e.target.value)}
                            placeholder="e.g. gemini-1.5-pro"
                            className="w-full p-4 rounded-xl border border-border bg-input-bg focus:bg-panel focus:ring-2 focus:ring-accent outline-none transition-all text-sm"
                          />
                        </div>
                      </div>
                    )}

                    {agentProvider === "deepseek-api" && (
                      <div className="space-y-6 animate-in fade-in duration-300 pt-4 border-t border-border">
                        <div>
                          <label className="block text-sm font-semibold text-foreground mb-2">DeepSeek API Key</label>
                          <input
                            type="password"
                            value={deepseekApiKey}
                            onChange={(e) => setDeepseekApiKey(e.target.value)}
                            placeholder="e.g. sk-..."
                            className="w-full p-4 rounded-xl border border-border bg-input-bg focus:bg-panel focus:ring-2 focus:ring-accent outline-none transition-all text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-foreground mb-2">Model Name</label>
                          <input
                            type="text"
                            value={deepseekApiModel}
                            onChange={(e) => setDeepseekApiModel(e.target.value)}
                            placeholder="e.g. deepseek-chat"
                            className="w-full p-4 rounded-xl border border-border bg-input-bg focus:bg-panel focus:ring-2 focus:ring-accent outline-none transition-all text-sm"
                          />
                        </div>
                      </div>
                    )}

                    {agentProvider === "deepseek-free" && (
                      <div className="space-y-6 animate-in fade-in duration-300 pt-4 border-t border-border">
                        <div>
                          <label className="block text-sm font-semibold text-foreground mb-2">DeepSeek Web Token (userToken)</label>
                          <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="Paste your DeepSeek web token here..."
                            className="w-full p-4 rounded-xl border border-border bg-input-bg focus:bg-panel focus:ring-2 focus:ring-accent outline-none transition-all text-sm"
                          />
                          <p className="text-xs text-muted mt-2">Required for normal Chat mode as well.</p>
                        </div>

                        <div className="p-5 rounded-2xl bg-blue-50/50 border border-blue-100 dark:bg-blue-950/30 dark:border-blue-900 mt-6">
                          <h4 className="text-sm font-bold text-blue-900 dark:text-blue-300 mb-3">How to get your DeepSeek token</h4>
                          <ol className="list-decimal list-inside text-sm text-blue-800 dark:text-blue-400 space-y-2">
                            <li>Log in to <a href="https://chat.deepseek.com" target="_blank" rel="noreferrer" className="underline">chat.deepseek.com</a> in your browser.</li>
                            <li>Open Developer Tools (<kbd className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 rounded">F12</kbd> or <kbd className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 rounded">Ctrl+Shift+I</kbd>).</li>
                            <li>Go to the <strong>Application</strong> tab (or Storage tab).</li>
                            <li>Under <strong>Local Storage</strong> on the left side, select <code>https://chat.deepseek.com</code>.</li>
                            <li>Find the key named <code>userToken</code> and copy the <strong>value</strong>.</li>
                          </ol>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "api" && (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <h3 className="text-lg font-bold text-foreground mb-2">{texts.settings.api}</h3>
                    <p className="text-sm text-muted mb-6">
                      This app runs a local OpenAI-compatible proxy. Point your favorite tools (Cursor, Continue, Cline) to this endpoint to use DeepSeek for free.
                    </p>

                    <div className="flex flex-col gap-5">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-muted uppercase tracking-wider mb-1.5">{texts.settings.baseUrl}</label>
                          <div className="p-3 rounded-xl border border-border bg-input-bg font-mono text-sm text-foreground">http://127.0.0.1:8000/v1</div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-muted uppercase tracking-wider mb-1.5">{texts.settings.apiKey}</label>
                          <div className="p-3 rounded-xl border border-border bg-input-bg font-mono text-sm text-foreground">any-string-works</div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-muted uppercase tracking-wider mb-1.5">{texts.settings.model}</label>
                        <div className="p-3 rounded-xl border border-border bg-input-bg text-sm flex flex-col gap-2">
                          <div className="flex items-center gap-2"><code className="bg-panel px-2 py-0.5 rounded border border-border font-mono text-xs text-foreground">deepseek-chat</code><span className="text-muted text-xs">Standard mode</span></div>
                          <div className="flex items-center gap-2"><code className="bg-panel px-2 py-0.5 rounded border border-border font-mono text-xs text-foreground">deepseek-reasoner</code><span className="text-muted text-xs">Forces DeepThink mode</span></div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-muted uppercase tracking-wider mb-1.5">cURL Example (With Web Search)</label>
                        <pre className="p-4 rounded-xl border border-border bg-gray-900 text-gray-100 font-mono text-xs overflow-x-auto">
{`curl -X POST http://127.0.0.1:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-reasoner",
    "messages": [{"role": "user", "content": "What is the weather in Reno?"}],
    "search": true
  }'`}
                        </pre>
                        <p className="text-xs text-muted mt-2">Pass <code className="bg-input-bg px-1 rounded">"search": true</code> in your JSON payload to force web search.</p>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-muted uppercase tracking-wider mb-1.5">Python Example</label>
                        <pre className="p-4 rounded-xl border border-border bg-gray-900 text-gray-100 font-mono text-xs overflow-x-auto">
{`from openai import OpenAI

client = OpenAI(
    api_key="any-key",
    base_url="http://127.0.0.1:8000/v1"
)

response = client.chat.completions.create(
    model="deepseek-reasoner",
    messages=[{"role": "user", "content": "Explain quantum computing."}],
    extra_body={"search": True} # Triggers web search
)`}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "about" && (
                  <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex flex-col items-center justify-center text-center mt-8">
                    <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center mb-6">
                      <div className="w-6 h-6 bg-accent-foreground rounded-full"></div>
                    </div>
                    <h3 className="text-2xl font-bold text-foreground mb-2">{texts.settings.appName}</h3>
                    <p className="text-muted text-sm mb-6 max-w-sm">
                      A beautifully crafted, minimalist client for interacting with next-generation reasoning models.
                    </p>
                    <div className="bg-input-bg border border-border rounded-xl p-4 text-xs text-muted w-full text-left">
                      <p className="mb-1"><strong>{texts.settings.version}:</strong> 1.0.0</p>
                      <p className="mb-1"><strong>Engine:</strong> Next.js 16 (Turbopack)</p>
                      <p><strong>Design:</strong> {texts.settings.builtWith}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border bg-input-bg/50 flex justify-end shrink-0">
              <button onClick={saveSettings} className="px-6 py-2.5 bg-accent text-accent-foreground rounded-xl font-medium hover:opacity-90 transition-colors shadow-sm">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
