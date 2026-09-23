"use client";
import { useState, useRef, useCallback } from "react";

export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  // Tool call trace for the workspace UI
  toolCalls?: Array<{ toolCallId: string; toolName: string; input: any; result?: string; state: "call" | "result" }>;
};

type UseAgentOptions = {
  projectPath: string; // e.g. "C:/Projects/waslay" or local picked dir
};

export function useAgent({ projectPath }: UseAgentOptions) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const sendMessage = useCallback(
    async (text: string, fileDataOrSessionId?: any, projectIdOrOpts?: any, maybeOpts?: any) => {
      // Support both signatures: (text, sessionId, projectId) and (text, fileData, opts)
      // Detect if second arg is fileData (has base64) vs sessionId string
      let fileData: any = null;
      let sessionId: string | undefined;
      let projectId: string | undefined;
      let opts: any = {};
      if (fileDataOrSessionId && typeof fileDataOrSessionId === "object" && (fileDataOrSessionId.base64 || fileDataOrSessionId.filename)) {
        fileData = fileDataOrSessionId;
        opts = projectIdOrOpts || {};
        sessionId = opts.sessionId;
        projectId = opts.projectId;
      } else {
        // legacy: (text, sessionId, projectId)
        sessionId = fileDataOrSessionId as string | undefined;
        projectId = projectIdOrOpts as string | undefined;
        opts = maybeOpts || {};
        // check if opts contains fileData
        if (opts && opts.base64) fileData = opts;
      }
      // Also allow opts to carry thinking/search
      const activeThinking = opts.thinking;
      const activeSearch = opts.search;
      const imageData = fileData;

      if (!text.trim() && !imageData) return;
      if (isLoading) return;

      // ISOLATION: this hook NEVER calls the Python backend at localhost:8000/api/chat
      // It only talks to the Next.js Agent route at /api/agent — uses EXACT same instant-mode settings as chat
      const displayText = fileData ? `${text}${fileData.filename ? `\n[Attached: ${fileData.filename}]` : ""}` : text;
      const userMsg: AgentMessage = {
        id: Date.now().toString(),
        role: "user",
        content: displayText,
        // store image for UI like chat does
        ...(imageData?.base64 ? { image: imageData.base64 } as any : {}),
      };
      const assistantId = (Date.now() + 1).toString();
      const assistantMsg: AgentMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        isStreaming: true,
        toolCalls: [],
      };

      // Build history in UIMessage format expected by `convertToModelMessages`
      // We keep a local snapshot to send, including the new user message
      const historyForRequest = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);
      abortRef.current = new AbortController();

      try {
        const apiKey = (typeof window !== "undefined" ? localStorage.getItem("apiKey") || localStorage.getItem("DEEPSEEK_AUTH_TOKEN") || "" : "");
        const headers: Record<string,string> = { "Content-Type": "application/json" };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
        // Instant-mode settings — exactly like chat: search+think enabled by default (like useChat instant)
        const settings = {
          thinking: activeThinking !== undefined ? activeThinking : true,
          search: activeSearch !== undefined ? activeSearch : true,
          image_data: imageData || null,
          agentProvider: typeof window !== "undefined" ? localStorage.getItem("agentProvider") || "deepseek-free" : "deepseek-free",
          geminiKey: typeof window !== "undefined" ? localStorage.getItem("geminiKey") || undefined : undefined,
          geminiModel: typeof window !== "undefined" ? localStorage.getItem("geminiModel") || "gemini-1.5-pro" : "gemini-1.5-pro",
          deepseekApiKey: typeof window !== "undefined" ? localStorage.getItem("deepseekApiKey") || undefined : undefined,
          deepseekApiModel: typeof window !== "undefined" ? localStorage.getItem("deepseekApiModel") || "deepseek-chat" : "deepseek-chat",
        };
        const res = await fetch("/api/agent", {
          method: "POST",
          headers,
          signal: abortRef.current.signal,
          body: JSON.stringify({
            messages: historyForRequest,
            projectPath: projectPath || "",
            sessionId: sessionId || undefined,
            projectId: projectId || undefined,
            settings,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Agent API ${res.status}: ${errText.slice(0, 500)}`);
        }

        // Handle UIMessageStreamResponse (Vercel AI SDK) OR plain text stream
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) throw new Error("No response body");

        let buf = "";
        // Map toolCallId -> entry index for streaming tool inputs
        const toolMap = new Map<string, number>();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          // UIMessageStream is newline-delimited: lines may be "data: {...}" or "0:{...}\n"
          const lines = buf.split("\n");
          // Keep incomplete line in buf
          buf = lines.pop() || "";

          for (let raw of lines) {
            raw = raw.trim();
            if (!raw) continue;

            // Strip SSE prefix if present
            if (raw.startsWith("data:")) raw = raw.slice(5).trim();
            if (raw === "[DONE]") continue;

            // AI SDK UIMessageStream uses format like: 0:"hello"  or  2:{...}
            // Try to extract JSON payload
            let payload: any = null;
            let dataStr = raw;

            // Case: "0:\"text delta\""  -> prefix is digit + colon
            const colonIdx = raw.indexOf(":");
            if (colonIdx > 0 && /^[0-9a-zA-Z-]+$/.test(raw.slice(0, colonIdx))) {
              dataStr = raw.slice(colonIdx + 1);
            }

            try {
              payload = JSON.parse(dataStr);
            } catch {
              // If not JSON, treat as raw text delta (fallback for text stream)
              if (typeof dataStr === "string" && dataStr.length > 0) {
                // Remove surrounding quotes if present
                let textDelta: string | null = null;
                if (dataStr.startsWith('"') && dataStr.endsWith('"')) {
                  try {
                    textDelta = JSON.parse(dataStr);
                  } catch {
                    textDelta = dataStr.slice(1, -1);
                  }
                } else {
                  textDelta = dataStr;
                }
                if (textDelta) {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + textDelta } : m))
                  );
                }
              }
              continue;
            }

            // UIMessage chunk handling
            // payload may be {type: "text-delta", delta: "..."} or {type:"tool-call",...} etc.
            // Also the SDK may wrap as {type:"text", text:"..."} or {type:"tool-input-available",...}
            if (payload == null) continue;

            // Normalize: some chunks are themselves strings (text delta as quoted string with type prefix 0)
            if (typeof payload === "string") {
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + payload } : m)));
              continue;
            }

            const t = payload.type;

            if (t === "text-delta" || t === "text_delta") {
              const delta = payload.delta ?? payload.textDelta ?? payload.text ?? "";
              if (delta) {
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)));
              }
            } else if (t === "text" || t === "reasoning") {
              const delta = payload.text ?? payload.delta ?? "";
              if (delta) {
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)));
              }
            } else if (t === "tool-call" || t === "tool_call" || t === "tool-input-available") {
              const toolCallId = payload.toolCallId ?? payload.tool_call_id ?? `call-${Date.now()}`;
              const toolName = payload.toolName ?? payload.tool_name ?? payload.tool ?? "unknown";
              const input = payload.input ?? payload.args ?? payload.toolInput ?? {};
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const existing = m.toolCalls || [];
                  // Avoid duplicate ids
                  if (existing.some((tc) => tc.toolCallId === toolCallId)) return m;
                  return {
                    ...m,
                    toolCalls: [...existing, { toolCallId, toolName, input, state: "call" as const }],
                  };
                })
              );
              // Track for later result
              toolMap.set(toolCallId, 1);
            } else if (t === "tool-result" || t === "tool_result" || t === "tool-output-available") {
              const toolCallId = payload.toolCallId ?? payload.tool_call_id ?? "";
              const result = payload.result ?? payload.output ?? payload.toolResult ?? "";
              const strResult = typeof result === "string" ? result : JSON.stringify(result, null, 2);
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const calls = [...(m.toolCalls || [])];
                  const idx = calls.findIndex((c) => c.toolCallId === toolCallId);
                  if (idx >= 0) {
                    calls[idx] = { ...calls[idx], result: strResult, state: "result" };
                  } else {
                    // Orphan result (no prior call seen) — still show
                    calls.push({ toolCallId, toolName: payload.toolName ?? "tool", input: {}, result: strResult, state: "result" });
                  }
                  return { ...m, toolCalls: calls };
                })
              );
            } else if (t === "data-tool-call" || t === "data-tool-result") {
              // Generic fallback — append as tool trace
            } else if (t === "error") {
              const errMsg = payload.errorText ?? payload.message ?? JSON.stringify(payload);
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + `\n\n**Error:** ${errMsg}` } : m))
              );
            } else if (t === "finish" || t === "finish-step" || t === "done") {
              // ignore
            } else {
              // Unknown chunk — try to extract text if present
              if (payload.delta) {
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + payload.delta } : m)));
              } else if (payload.text) {
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + payload.text } : m)));
              } else if (typeof payload === "object" && payload.content) {
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + payload.content } : m)));
              }
            }
          }
        }

        // Flush remaining buffer as text if any
        if (buf.trim()) {
          let leftover = buf.trim();
          if (leftover.startsWith("data:")) leftover = leftover.slice(5).trim();
          if (leftover && leftover !== "[DONE]") {
            try {
              const p = JSON.parse(leftover);
              if (p.delta) {
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + p.delta } : m)));
              }
            } catch {
              // ignore
            }
          }
        }
      } catch (e: any) {
        if (e.name === "AbortError") {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + "\n\n*Generation stopped.*", isStreaming: false } : m))
          );
        } else {
          console.error("[useAgent] fetch error", e);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: m.content || `Error: ${e.message || "Agent request failed. Is the model API key set? Check server logs."}`,
                    isStreaming: false,
                  }
                : m
            )
          );
        }
      } finally {
        setIsLoading(false);
        abortRef.current = null;
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m)));
      }
    },
    [messages, projectPath, isLoading]
  );

  return { messages, sendMessage, stopGeneration, isLoading, clearMessages, setMessages };
}
