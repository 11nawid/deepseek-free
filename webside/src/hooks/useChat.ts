import { useState, useRef } from "react";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  isStreaming?: boolean;
  image?: string; // base64
  metrics?: { timeMs: number; tokens: number };
  search_results?: any[];
};

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [mode, setMode] = useState<"instant" | "expert" | "vision">("instant");
  const [searchEnabled, setSearchEnabled] = useState(true);

  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const loadChat = async (id: string) => {
    try {
      setIsChatLoading(true);
      const apiKey = localStorage.getItem("apiKey") || "";
      const res = await fetch(`http://localhost:8000/api/chat/${id}`, {
        headers: { "Authorization": `Bearer ${apiKey}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      setCurrentChatId(id);
      
      const rawMessages = data.messages || [];
      const mergedMessages: any[] = [];
      for (const m of rawMessages) {
        if (m.type === "thinking") {
          const lastAsst = [...mergedMessages].reverse().find(msg => msg.role === "assistant" && msg.type !== "thinking");
          if (lastAsst) {
            lastAsst.thinking = m.content;
          } else {
            mergedMessages.push({...m, thinking: m.content, content: ""});
          }
        } else {
          mergedMessages.push({...m});
        }
      }

      const loadedMessages = mergedMessages.map((m: any, i: number) => ({
        ...m,
        id: m.id || `history-${Date.now()}-${i}`
      }));
      setMessages(loadedMessages);
    } catch (e) {
      console.error(e);
    } finally {
      setIsChatLoading(false);
    }
  };

  const newChat = () => {
    setCurrentChatId(null);
    setMessages([]);
    setMode("instant");
    setThinkingEnabled(true);
    setSearchEnabled(true);
  };

  const sendMessage = async (text: string, imageData: any, forceOptions?: { mode?: string, thinking?: boolean, search?: boolean, newSession?: boolean, _retryCount?: number }) => {
    if (!text.trim() && !imageData) return;

    const retryCount = forceOptions?._retryCount ?? 0;
    if (retryCount > 2) {
      console.error("[useChat] Max vision retries reached — aborting");
      return;
    }

    console.log(`[useChat] sendMessage: text="${text.slice(0, 50)}", hasImage=${!!imageData}, options=`, forceOptions, `chatId=${currentChatId}`);

    // Apply system prompt from local storage if starting a new chat
    const sysPrompt = localStorage.getItem("systemPrompt");
    let finalText = text;
    if (!currentChatId && sysPrompt) {
      finalText = `[System Instructions: ${sysPrompt}]\n\n${text}`;
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      image: imageData?.base64
    };

    if (!forceOptions?.newSession) {
      setMessages((prev) => [...prev, userMsg]);
    }
    setIsLoading(true);

    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", thinking: "", isStreaming: true }]);

    const startTime = Date.now();
    abortControllerRef.current = new AbortController();

    try {
      const API_BASE = "http://localhost:8000/api";
      const apiKey = localStorage.getItem("apiKey") || "";
      let chatId = currentChatId;
      if (!chatId || forceOptions?.newSession) {
        console.log(`[useChat] Creating new chat session (newSession=${forceOptions?.newSession})`);
        const res = await fetch(`${API_BASE}/chat`, { 
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}` }
        });
        const data = await res.json();
        chatId = data.id;
        setCurrentChatId(chatId);
        console.log(`[useChat] New chat created: ${chatId}`);
      }

      const activeMode = forceOptions?.mode || mode;
      const activeThinking = forceOptions?.thinking !== undefined ? forceOptions.thinking : (thinkingEnabled || activeMode === "expert");
      const activeSearch = forceOptions?.search !== undefined ? forceOptions.search : (activeMode === "expert" ? true : searchEnabled);

      const modeLabel = activeMode === "expert" ? "EXPERT (thinking=true, search=true)" 
                      : activeMode === "vision" ? "VISION" 
                      : `INSTANT (thinking=${activeThinking}, search=${activeSearch})`;
      console.log(`[useChat] MODE: ${modeLabel} → POST chat/${chatId}`);
      const res = await fetch(`${API_BASE}/chat/${chatId}/message`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          message: finalText,
          settings: { 
            stream: true, 
            thinking: activeThinking, 
            search: activeSearch, 
            vision: activeMode === "vision", 
            image_data: imageData 
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[useChat] HTTP ${res.status}: ${errText.slice(0, 300)}`);
        throw new Error("API Error");
      }

      console.log("[useChat] Stream started");
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let fileContentEmpty = false;
        let chunkCount = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) { console.log(`[useChat] Stream done after ${chunkCount} chunks`); break; }
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            const dataStr = line.trim();
            if (!dataStr) continue;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.chunk) {
                const data = parsed.chunk;
                chunkCount++;

                if (data.finish_reason === "file_content_empty") {
                  console.warn(`[useChat] DETECTED file_content_empty on chunk #${chunkCount} — triggering vision retry`);
                  fileContentEmpty = true;
                  break;
                }

                if (chunkCount <= 5 || chunkCount % 20 === 0) {
                  console.log(`[useChat] chunk#${chunkCount}: type=${data.type}, finish=${data.finish_reason}, content_len=${(data.content || "").length}`);
                }

                setMessages((prev) => 
                  prev.map((msg) => {
                    if (msg.id === assistantId) {
                      if (data.type === "thinking") {
                        return { ...msg, thinking: (msg.thinking || "") + (data.content || "") };
                      } else if (data.type === "search") {
                        const newResults = Array.isArray(data.search_results) 
                          ? data.search_results 
                          : [data.search_results];
                        return { 
                          ...msg, 
                          search_results: msg.search_results 
                            ? [...msg.search_results, ...newResults.filter((n: any) => !msg.search_results?.some((o: any) => o.url === n.url))]
                            : newResults 
                        };
                      } else {
                        return { ...msg, content: (msg.content || "") + (data.content || "") };
                      }
                    }
                    return msg;
                  })
                );
              }
            } catch (e) { /* ignore partial lines */ }
          }
          if (fileContentEmpty) break;
        }

        if (fileContentEmpty) {
          console.warn(`[useChat] file_content_empty — retry #${retryCount + 1} with vision mode + new session`);
          setMessages((prev) => prev.filter((msg) => msg.id !== assistantId));
          setIsLoading(false);
          sendMessage(text, imageData, { mode: "vision", thinking: false, search: false, newSession: true, _retryCount: retryCount + 1 });
          return;
        }
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) => 
        prev.map((msg) => 
          msg.id === assistantId ? { ...msg, content: "Error connecting to AI." } : msg
        )
      );
    } finally {
      setIsLoading(false);
      const timeMs = Date.now() - startTime;
      setMessages((prev) => prev.map((msg) => {
        if (msg.id === assistantId) {
          const charCount = (msg.content?.length || 0) + (msg.thinking?.length || 0);
          return { ...msg, isStreaming: false, metrics: { timeMs, tokens: Math.ceil(charCount / 4) } };
        }
        return msg;
      }));
    }
  };

  return { 
    messages, sendMessage, stopGeneration, isLoading, isChatLoading, loadChat, newChat, currentChatId, 
    mode, setMode, searchEnabled, setSearchEnabled, thinkingEnabled, setThinkingEnabled 
  };
}
