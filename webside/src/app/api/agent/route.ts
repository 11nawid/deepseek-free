import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  tool,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { z } from "zod";
import {
  getProjectRoot,
  execute_command,
  read_file,
  write_file,
  list_files,
  delete_file,
  delete_directory,
  move_file,
  create_directory,
} from "@/lib/agent-tools";
import { getSession as getAgentSession, updateAgentDsMeta } from "@/lib/agent-store";

export const runtime = "nodejs";
export const maxDuration = 60;

// Allow localhost DeepSeek free proxy as well - env vars are optional.
// Priority: DEEPSEEK_API_KEY > OPENAI_API_KEY.
// If none set, we try to use the local Python proxy via baseURL using the free userToken.
// IMPORTANT: DeepSeek free token (DEEPSEEK_AUTH_TOKEN) is NOT a DeepSeek cloud API key — it only works via the local proxy.
// For full tool-calling the user must set DEEPSEEK_API_KEY=sk-... or OPENAI_API_KEY=sk-...
function loadTokenFromRootEnv(): string | undefined {
  try {
    const fs = require("fs");
    const path = require("path");
    const candidates = [
      path.join(process.cwd(), "..", ".env"),
      path.join(process.cwd(), ".env"),
      path.resolve("../.env"),
      path.resolve(".env"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf-8");
        const m = raw.match(/DEEPSEEK_AUTH_TOKEN\s*=\s*(.+)/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {}
  return undefined;
}

function getModel(freeUserToken?: string) {
  const deepseekKey = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_AUTH_TOKEN || loadTokenFromRootEnv();
  const openaiKey = process.env.OPENAI_API_KEY || process.env.API_KEY;
  // DeepSeek cloud keys start with sk- ; free web tokens are long random strings — distinguish
  const isDeepSeekCloudKey = !!deepseekKey && deepseekKey.startsWith("sk-");
  const isOpenAIKey = !!openaiKey && openaiKey.startsWith("sk-");

  // IMPORTANT: use .chat() — the default provider() calls /v1/responses which DeepSeek & local proxy don't support (404)
  if (isDeepSeekCloudKey) {
    const provider = createOpenAI({
      apiKey: deepseekKey!,
      baseURL: "https://api.deepseek.com/v1",
    });
    const modelId = process.env.AGENT_MODEL || "deepseek-chat";
    return { model: provider.chat(modelId), mode: "cloud" as const };
  }

  if (isOpenAIKey) {
    const provider = createOpenAI({ apiKey: openaiKey! });
    const modelId = process.env.AGENT_MODEL || "gpt-4o-mini";
    return { model: provider.chat(modelId), mode: "cloud" as const };
  }

  // Fallback: local python proxy at 127.0.0.1:8000/v1 — uses free userToken if available
  // This will NOT support native tool calling; we handle that with a friendly streamed warning below.
  const token = freeUserToken || deepseekKey || "any-string-works";
  const localProvider = createOpenAI({
    apiKey: token,
    baseURL: "http://127.0.0.1:8000/v1",
  });
  const modelId = process.env.AGENT_MODEL || "deepseek-chat";
  return { model: localProvider.chat(modelId), mode: "free" as const, token };
}

const AGENT_SYSTEM_PROMPT = `You are an autonomous coding agent with access to the user's project filesystem.

You MUST use tools to complete tasks step-by-step:
- Use list_files to explore directory structure
- Use read_file to inspect file contents before editing
- Use write_file to create or overwrite files (directories are auto-created)
- Use delete_file to permanently delete a single file
- Use delete_directory to permanently delete a directory and all its contents (recursive)
- Use move_file to move or rename files and directories
- Use create_directory to create new directories (including nested paths)
- Use execute_command to run shell commands (npm install, npm run build, tests, etc.)

Rules:
- Always verify files/dirs exist with list_files/read_file before assuming.
- After writing files, verify with read_file or execute_command.
- If a tool returns an error, read the error carefully and try a different approach - do NOT repeat the same failing call.
- Chain multiple tool calls autonomously until the task is complete, then respond with a summary.
- Keep shell commands simple and non-interactive. Avoid destructive commands like rm -rf /.
- All paths are relative to the project root provided. Never access paths outside the project.
- Use delete_file for single files and delete_directory for folders. They are separate tools.
- move_file also works as rename — just provide source and destination paths.`;


export async function POST(req: Request) {
  try {
    // Extract free token from Authorization header (frontend stores it in localStorage)
    let freeToken: string | undefined;
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
    if (authHeader) {
      let t = authHeader.replace(/^Bearer\s+/i, "").trim();
      // Handle JSON-wrapped token like {"value":"Bearer x7k...","__version":"0"}
      if (t.startsWith("{")) {
        try {
          const j = JSON.parse(t);
          t = (j.value || t).replace(/^Bearer\s+/i, "").trim();
        } catch {}
      }
      if (t && t !== "any-string-works") freeToken = t;
    }

    const body = await req.json();
    const { messages, projectPath, model: requestedModel, settings } = body;
    const agentThinking = settings?.thinking ?? true;
    const agentSearch = settings?.search ?? true;
    const agentImageData = settings?.image_data || null;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ---- Project root resolution & validation (security) ----
    let projectRoot: string;
    try {
      projectRoot = getProjectRoot(projectPath);
    } catch (e: any) {
      return new Response(JSON.stringify({ error: `Invalid projectPath: ${e.message}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Optional: enforce allowlist via env AGENT_ALLOWED_ROOTS (comma-separated)
    const allowedRoots = process.env.AGENT_ALLOWED_ROOTS?.split(",").map((s) => s.trim()).filter(Boolean);
    if (allowedRoots && allowedRoots.length > 0) {
      const isAllowed = allowedRoots.some((root) => projectRoot.startsWith(root) || projectRoot === root);
      if (!isAllowed) {
        return new Response(
          JSON.stringify({ error: `projectPath "${projectRoot}" is not in AGENT_ALLOWED_ROOTS allowlist` }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Select model (allows frontend to override, else env/default)
    // Select model (allows frontend to override, else env/default)
    let { model: modelInstance, mode } = getModel(freeToken);
    
    const provider = settings?.agentProvider || "deepseek-free";
    
    if (provider === "gemini" && settings?.geminiKey) {
      const google = createGoogleGenerativeAI({ apiKey: settings.geminiKey });
      modelInstance = google(settings.geminiModel || "gemini-1.5-pro");
      mode = "cloud";
    } else if (provider === "deepseek-api" && settings?.deepseekApiKey) {
      const openai = createOpenAI({ apiKey: settings.deepseekApiKey, baseURL: "https://api.deepseek.com/v1" });
      modelInstance = openai(settings.deepseekApiModel || "deepseek-chat");
      mode = "cloud";
    } else {
      // Fallback or explicit deepseek-free
      const token = freeToken || process.env.DEEPSEEK_API_KEY || "any-string-works";
      // We still use createOpenAI for free mode since it's an OpenAI compatible endpoint
      const openai = createOpenAI({ apiKey: token, baseURL: "http://127.0.0.1:8000/v1" });
      // In free mode, reasoning toggle might dictate the model name, or we use what's passed
      modelInstance = openai(requestedModel || "deepseek-chat");
      mode = "free";
    }

    // Convert UI messages (useChat) to ModelMessages for the LLM
    // Supports both UIMessage ({role, parts}) and simple {role, content} formats
    let modelMessages: any;
    try {
      modelMessages = await convertToModelMessages(messages);
    } catch {
      // Fallback: assume already CoreMessage format
      modelMessages = messages;
    }

    const isCloud = mode === "cloud";
    const systemWithRoot =
      AGENT_SYSTEM_PROMPT + `\n\nCurrent project root: ${projectRoot}`;

    const agentSessionIdForDs = (body as any).sessionId as string | undefined;
    const agentSessionForDs = agentSessionIdForDs ? getAgentSession(agentSessionIdForDs) : null;

    // Free mode: use EXACT same AI as chat/instant mode (local proxy at 127.0.0.1:8000)
    // The proxy doesn't support native OpenAI tool calling, so we implement a prompt-based loop
    // that uses the same DeepSeek model as chat mode and parses TOOL_CALL JSON.
    // We also enforce: ALWAYS start by exploring the project directory.
    if (!isCloud) {
      // ROOT CAUSE FIX: The Python backend (api.py lines 73-106) collapses ALL messages
      // (including the system message) into a single "USER:" blob. This means when we
      // send { role:"system", content: toolInstructions }, the LLM never sees it as
      // instructions — it just reads it as text inside a user message with no authority.
      // FIX: Inject the tool instructions DIRECTLY into the first user message content
      // so the LLM always sees them as part of the conversation, not a discarded system header.
      const TOOL_INSTRUCTIONS = `You are an autonomous coding agent. You have the following filesystem tools available. You MUST use them to complete the task.

AVAILABLE TOOLS:
- list_files(dirpath) → lists files in a directory
- read_file(filepath) → reads a file's content
- write_file(filepath, content) → creates or overwrites a file
- delete_file(filepath) → permanently deletes a single file
- delete_directory(dirpath) → permanently deletes a directory and all its contents
- move_file(sourcePath, destPath) → moves or renames a file/directory
- create_directory(dirpath) → creates a new directory
- execute_command(command) → runs a shell command (npm, git, etc.)

HOW TO CALL A TOOL — output exactly this on its own line, nothing else:
TOOL_CALL: {"name":"<tool_name>","arguments":{...}}

EXAMPLES:
TOOL_CALL: {"name":"list_files","arguments":{"dirpath":"."}}
TOOL_CALL: {"name":"read_file","arguments":{"filepath":"src/index.ts"}}
TOOL_CALL: {"name":"write_file","arguments":{"filepath":"hello.txt","content":"Hello world"}}
TOOL_CALL: {"name":"delete_file","arguments":{"filepath":"old.txt"}}
TOOL_CALL: {"name":"delete_directory","arguments":{"dirpath":"old-folder"}}
TOOL_CALL: {"name":"move_file","arguments":{"sourcePath":"old.txt","destPath":"new.txt"}}
TOOL_CALL: {"name":"create_directory","arguments":{"dirpath":"src/utils"}}
TOOL_CALL: {"name":"execute_command","arguments":{"command":"npm install"}}

RULES:
- You CAN and MUST use these tools. You have full filesystem access.
- Always start by calling list_files on "." to explore the project before making changes.
- Output ONE tool call per message. Wait for the result before calling the next tool.
- After all tools are done, write a plain-text summary of everything you did.
- NEVER say you cannot do something — use the tools instead.

Current project root: ${projectRoot}`;

      // Build free-mode request: tool instructions are embedded into first user message
      const buildFreeHistory = (msgs: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> => {
        const result: Array<{ role: string; content: string }> = [];
        let toolsInjected = false;
        for (const m of msgs) {
          if (m.role === "user" && !toolsInjected) {
            // Inject tool instructions as a prefix to the first user message
            result.push({ role: "user", content: `${TOOL_INSTRUCTIONS}\n\n---\nUSER REQUEST: ${m.content}` });
            toolsInjected = true;
          } else {
            result.push({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
          }
        }
        if (!toolsInjected) {
          // No user message found — add a standalone instruction message
          result.push({ role: "user", content: `${TOOL_INSTRUCTIONS}\n\n---\nPlease explore the project and await further instructions.` });
        }
        return result;
      };

      // Helper to parse TOOL_CALL from LLM text — robust for all 8 tools
      const ALL_TOOL_NAMES = "execute_command|read_file|write_file|list_files|delete_file|delete_directory|move_file|create_directory";
      const parseToolCall = (text: string): { name: string; arguments: any } | null => {
        if (!text) return null;
        // Primary: TOOL_CALL: {json} — handle with or without markdown fences
        let m = text.match(/TOOL_CALL:\s*```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (m) {
          try {
            const j = JSON.parse(m[1]);
            if (j.name) return { name: j.name, arguments: j.arguments || j.args || {} };
          } catch {}
        }
        m = text.match(/TOOL_CALL:\s*(\{[\s\S]*\})/);
        if (m) {
          try {
            const j = JSON.parse(m[1]);
            if (j.name && (j.arguments || j.args)) return { name: j.name, arguments: j.arguments || j.args };
            if (j.name) return { name: j.name, arguments: j.arguments || {} };
          } catch {}
          try {
            const jsonStr = m[1].match(/\{[\s\S]*\}/)?.[0];
            if (jsonStr) {
              const j = JSON.parse(jsonStr);
              if (j.name) return { name: j.name, arguments: j.arguments || j.args || {} };
            }
          } catch {}
        }
        // Fallback: code block containing JSON with a known tool name
        const codeBlockJson = text.match(new RegExp(`\`\`\`(?:json)?\\s*(\\{\\s*"name"\\s*:\\s*"(?:${ALL_TOOL_NAMES})"[\\s\\S]*?\\})\\s*\`\`\``));
        if (codeBlockJson) {
          try {
            const j = JSON.parse(codeBlockJson[1]);
            if (j.name) return { name: j.name, arguments: j.arguments || j.args || j.input || {} };
          } catch {}
        }
        // Fallback: raw JSON with name field matching any known tool
        const m2 = text.match(new RegExp(`\\{\\s*"name"\\s*:\\s*"(${ALL_TOOL_NAMES})"[\\s\\S]*?\\}`));
        if (m2) {
          try {
            const j = JSON.parse(m2[0]);
            if (j.name) return { name: j.name, arguments: j.arguments || j.args || j.input || {} };
          } catch {}
        }
        return null;
      };

      // Helper: if LLM said it would create a file but didn't call tool, create it from code block
      const tryFallbackFileCreation = async (userRequest: string, llmContent: string, hadTools: boolean): Promise<{ created: boolean; filepath?: string; result?: string }> => {
        if (hadTools) return { created: false };
        const wantsFile = /make a file|create.*file|\.html|\.js|\.ts|\.json|\.txt/i.test(userRequest);
        if (!wantsFile) return { created: false };
        // Extract filename from user request
        let filenameMatch = userRequest.match(/([a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+)/);
        if (!filenameMatch) filenameMatch = llmContent.match(/([a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+)/);
        const filename = filenameMatch ? filenameMatch[1] : null;
        if (!filename) return { created: false };
        // Try to extract file content from LLM's code block
        let fileContent = "";
        const htmlBlock = llmContent.match(/```html\s*([\s\S]*?)\s*```/i);
        const genericBlock = llmContent.match(/```(?:\w+)?\s*([\s\S]*?)\s*```/);
        if (htmlBlock) fileContent = htmlBlock[1].trim();
        else if (genericBlock && genericBlock[1].trim().length > 20) fileContent = genericBlock[1].trim();
        else {
          // No code block, create a sensible default
          if (filename.endsWith(".html")) fileContent = `<!DOCTYPE html>\n<html>\n<head><title>${filename}</title></head>\n<body>\n<h1>Hello from ${filename}</h1>\n<p>Created by agent on ${new Date().toLocaleString()}</p>\n</body>\n</html>`;
          else fileContent = `// ${filename} created by agent\n`;
        }
        if (!fileContent) return { created: false };
        const result = await write_file(filename, fileContent, projectRoot);
        return { created: true, filepath: filename, result };
      };

      const execTool = async (name: string, args: any): Promise<string> => {
        try {
          if (name === "execute_command") return await execute_command(args.command || args.cmd || "", projectRoot);
          if (name === "read_file") return await read_file(args.filepath || args.path || "", projectRoot);
          if (name === "write_file") return await write_file(args.filepath || args.path || "", args.content || "", projectRoot);
          if (name === "list_files") return await list_files(args.dirpath || args.path || ".", projectRoot);
          if (name === "delete_file") return await delete_file(args.filepath || args.path || "", projectRoot);
          if (name === "delete_directory") return await delete_directory(args.dirpath || args.path || "", projectRoot);
          if (name === "move_file") return await move_file(args.sourcePath || args.source || args.from || "", args.destPath || args.dest || args.to || "", projectRoot);
          if (name === "create_directory") return await create_directory(args.dirpath || args.path || "", projectRoot);
          return `Error: unknown tool "${name}". Available tools: execute_command, read_file, write_file, list_files, delete_file, delete_directory, move_file, create_directory`;
        } catch (e: any) {
          return `Error executing ${name}: ${e.message}`;
        }
      };

      // Build OpenAI-compatible history using buildFreeHistory (tools injected into first user message)
      const baseHistory = buildFreeHistory(
        (body.messages as Array<{ role: string; content: string }>).map((m: any) => ({
          role: m.role as string,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }))
      );

      const stream = createUIMessageStream({
        async execute({ writer }) {
          const authToken = freeToken || loadTokenFromRootEnv() || "";
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

          // Reuse DeepSeek session across tool loop to avoid separate chat per tool step
          let currentDsSessionId: string | undefined = (agentSessionForDs as any)?.dsSessionId || undefined;
          let currentDsParentId: string | undefined = (agentSessionForDs as any)?.dsParentId || undefined;
          let finalContent = "";
          let hadToolCalls = false;

          // The original user request (extracted from buildFreeHistory)
          const originalUserMessages = (body.messages as Array<{ role: string; content: string }>).map((m: any) => ({
            role: m.role as string,
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          }));
          const lastUserMessage = [...originalUserMessages].reverse().find(m => m.role === "user")?.content || "";

          // Running log of tool calls and results — appended each step
          // This is injected fresh with tool instructions on EVERY iteration
          // so the Python backend collapse doesn't break multi-step context
          const toolLog: string[] = [];

          const buildStepMessages = (): Array<{ role: string; content: string }> => {
            // Build a single user message that contains: tool instructions + original request + all tool history so far
            const toolHistory = toolLog.length > 0
              ? `\n\nTOOL HISTORY (steps already completed):\n${toolLog.join("\n\n")}`
              : "";
            const nextInstruction = toolLog.length > 0
              ? `\nContinue with the NEXT tool call. Do NOT repeat any completed steps. Look at the tool history above and call the next required tool.`
              : "";
            const content = `${TOOL_INSTRUCTIONS}${toolHistory}\n\n---\nUSER REQUEST: ${lastUserMessage}${nextInstruction}`;
            return [{ role: "user", content }];
          };

          for (let step = 0; step < 12; step++) {
            // Call the SAME endpoint as chat/instant mode, with session reuse
            let resp: Response;
            try {
              const freeModel = agentThinking ? "deepseek-reasoner" : "deepseek-chat";
              resp = await fetch("http://127.0.0.1:8000/v1/chat/completions", {
                method: "POST",
                headers,
                body: JSON.stringify({
                  model: freeModel,
                  messages: buildStepMessages(),
                  stream: false,
                  thinking: agentThinking,
                  search: false, // disable search in agent mode — tool results are the source of truth
                  session_id: step === 0 ? currentDsSessionId : undefined, // fresh session each step to avoid backend context confusion
                  parent_id: step === 0 ? currentDsParentId : undefined,
                }),
              });
            } catch (e: any) {
              writer.write({ type: "text-start" as const, id: "text-0" });
              writer.write({ type: "text-delta" as const, delta: `**Agent error:** Cannot reach local AI proxy at 127.0.0.1:8000 — is the Python backend running? (${e.message})` });
              writer.write({ type: "text-end" as const });
              return;
            }

            if (!resp.ok) {
              const errText = await resp.text();
              // If auth failed, try fallback file creation directly
              if (resp.status === 500 && errText.includes("Authorization Failed")) {
                console.warn("[agent free] DeepSeek auth failed, trying fallback file creation");
                const fb = await tryFallbackFileCreation(lastUserMessage, "", false);
                if (fb.created) {
                  const fbId = `fallback_auth_${Date.now()}`;
                  writer.write({ type: "tool-input-available" as const, toolCallId: fbId, toolName: "write_file", input: { filepath: fb.filepath, content: "fallback" } } as any);
                  writer.write({ type: "tool-output-available" as const, toolCallId: fbId, output: fb.result } as any);
                  writer.write({ type: "text-start" as const, id: "text-0" });
                  writer.write({ type: "text-delta" as const, delta: `Created **${fb.filepath}** (fallback due to DeepSeek auth expired — file was still created locally). Please refresh your DeepSeek token in Settings → Auth to re-enable full AI.` } as any);
                  writer.write({ type: "text-end" as const });
                  return;
                }
              }
              writer.write({ type: "text-start" as const, id: "text-0" });
              writer.write({ type: "text-delta" as const, delta: `**Agent error ${resp.status}:** ${errText.slice(0, 800)}` });
              writer.write({ type: "text-end" as const });
              return;
            }

            const data = await resp.json();
            const content: string = data.choices?.[0]?.message?.content || "";
            // Only capture session from first call (we intentionally fresh-start each step)
            if (step === 0) {
              if (data.session_id) currentDsSessionId = data.session_id;
              if (data.parent_id) currentDsParentId = data.parent_id;
              if (agentSessionIdForDs && (data.session_id || data.parent_id)) {
                try { updateAgentDsMeta(agentSessionIdForDs, currentDsSessionId || null, currentDsParentId || null); } catch {}
              }
            }

            const toolCall = parseToolCall(content);

            if (toolCall) {
              hadToolCalls = true;
              const toolCallId = `call_${Date.now()}_${step}`;
              const args = toolCall.arguments || {};
              writer.write({
                type: "tool-input-available" as const,
                toolCallId,
                toolName: toolCall.name,
                input: args,
              } as any);

              const result = await execTool(toolCall.name, args);
              console.log(`[agent free] step ${step} tool ${toolCall.name} -> ${result.slice(0, 200)}`);

              writer.write({
                type: "tool-output-available" as const,
                toolCallId,
                output: result,
              } as any);

              // Append to tool log — this is injected on every next iteration
              toolLog.push(`Step ${step + 1}: Called ${toolCall.name}(${JSON.stringify(args).slice(0, 200)})\nResult: ${result.slice(0, 1000)}`);
              continue;
            } else {
              // No tool call -> check fallback: LLM said it would create file but didn't call tool
              if (!hadToolCalls) {
                const fb = await tryFallbackFileCreation(lastUserMessage, content, hadToolCalls);
                if (fb.created) {
                  console.log(`[agent free] fallback creating ${fb.filepath}`);
                  const fbId = `fallback_${Date.now()}`;
                  // Stream fallback tool to UI so it shows as changed file + accurate status
                  writer.write({ type: "tool-input-available" as const, toolCallId: fbId, toolName: "write_file", input: { filepath: fb.filepath, content: "" }, } as any);
                  // Need to get actual content that was written — re-read from fallback
                  writer.write({ type: "tool-output-available" as const, toolCallId: fbId, output: fb.result || `Successfully wrote to ${fb.filepath}` } as any);
                  hadToolCalls = true;
                  toolLog.push(`Step ${step + 1} (Fallback): Created ${fb.filepath}\nResult: ${fb.result}`);
                  
                  // Feed fallback into history and get a proper summary from LLM
                  const fbMessages = buildStepMessages();
                  fbMessages.push({ role: "assistant", content: content || `Created ${fb.filepath}` });
                  fbMessages.push({ role: "user", content: `Tool write_file result:\n${fb.result}\n\nNow provide a COMPLETE summary of what you created, listing the file and confirming done.` });
                  
                  // Do one more LLM call for summary
                  try {
                    const fbResp = await fetch("http://127.0.0.1:8000/v1/chat/completions", {
                      method: "POST",
                      headers,
                      body: JSON.stringify({ model: agentThinking ? "deepseek-reasoner" : "deepseek-chat", messages: fbMessages, stream: false, thinking: agentThinking, search: false, session_id: currentDsSessionId, parent_id: currentDsParentId }),
                    });
                    if (fbResp.ok) {
                      const fbData = await fbResp.json();
                      const fbContent: string = fbData.choices?.[0]?.message?.content || content;
                      if (fbData.session_id) currentDsSessionId = fbData.session_id;
                      if (fbData.parent_id) currentDsParentId = fbData.parent_id;
                      if (agentSessionIdForDs) try { updateAgentDsMeta(agentSessionIdForDs, currentDsSessionId || null, currentDsParentId || null); } catch {}
                      writer.write({ type: "text-start" as const, id: "text-0" });
                      for (let i = 0; i < fbContent.length; i += 40) {
                        writer.write({ type: "text-delta" as const, delta: fbContent.slice(i, i + 40) } as any);
                        await new Promise((r) => setTimeout(r, 10));
                      }
                      writer.write({ type: "text-end" as const });
                      return;
                    }
                  } catch {}
                  // Fallback summary if LLM still fails
                  writer.write({ type: "text-start" as const, id: "text-0" });
                  writer.write({ type: "text-delta" as const, delta: `Created **${fb.filepath}** successfully. ` + content } as any);
                  writer.write({ type: "text-end" as const });
                  return;
                }
              }

              // No tool call -> final answer, stream as text deltas
              finalContent = content;
              writer.write({ type: "text-start" as const, id: "text-0" });
              const chunkSize = 40;
              for (let i = 0; i < content.length; i += chunkSize) {
                writer.write({ type: "text-delta" as const, delta: content.slice(i, i + chunkSize) } as any);
                await new Promise((r) => setTimeout(r, 10));
              }
              writer.write({ type: "text-end" as const });

              // Wakeup/continue loop: if we had file changes but summary is empty/short, force a complete description
              const hasFileChanges = hadToolCalls;
              const isShort = !content || content.trim().length < 80;
              const mentionsFiles = /changed|created|edited|updated|wrote|file/i.test(content);
              if (hasFileChanges && (isShort || !mentionsFiles)) {
                console.log("[agent free] wakeup: summary too short, requesting complete description");
                await new Promise((r) => setTimeout(r, 300));
                
                const wakeMessages = buildStepMessages();
                wakeMessages.push({ role: "assistant", content });
                wakeMessages.push({ role: "user", content: "You made file changes but your summary was incomplete. You MUST now provide a COMPLETE description of all work done: list every file you created or edited, what changed in each, and confirm the task is finished. Do not stop without this." });
                
                try {
                  const wakeResp = await fetch("http://127.0.0.1:8000/v1/chat/completions", {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ model: agentThinking ? "deepseek-reasoner" : "deepseek-chat", messages: wakeMessages, stream: false, thinking: agentThinking, search: false, session_id: currentDsSessionId, parent_id: currentDsParentId }),
                  });
                  if (wakeResp.ok) {
                    const wakeData = await wakeResp.json();
                    const wakeContent: string = wakeData.choices?.[0]?.message?.content || "";
                    if (wakeContent.trim()) {
                      if (wakeData.session_id) currentDsSessionId = wakeData.session_id;
                      if (wakeData.parent_id) currentDsParentId = wakeData.parent_id;
                      if (agentSessionIdForDs) try { updateAgentDsMeta(agentSessionIdForDs, currentDsSessionId || null, currentDsParentId || null); } catch {}
                      writer.write({ type: "text-start" as const, id: "text-2" });
                      for (let i = 0; i < wakeContent.length; i += 40) {
                        writer.write({ type: "text-delta" as const, delta: wakeContent.slice(i, i + 40) } as any);
                        await new Promise((r) => setTimeout(r, 10));
                      }
                      writer.write({ type: "text-end" as const });
                    }
                  }
                } catch {}
              }
              return;
            }
          }
          // Max steps reached — trigger wakeup to ensure summary
          writer.write({ type: "text-start" as const, id: "text-0" });
          writer.write({ type: "text-delta" as const, delta: "\n\n*Agent reached max steps — requesting final summary...*" } as any);
          writer.write({ type: "text-end" as const });
          try {
            const wakeMessages = buildStepMessages();
            wakeMessages.push({ role: "user", content: "You reached max tool steps. Now STOP using tools and provide a COMPLETE final summary listing every file changed, what was done, and confirmation the task is complete." });
            
            const wakeResp = await fetch("http://127.0.0.1:8000/v1/chat/completions", {
              method: "POST",
              headers,
              body: JSON.stringify({
                model: "deepseek-chat",
                messages: wakeMessages,
                stream: false,
                session_id: currentDsSessionId,
                parent_id: currentDsParentId,
              }),
            });
            if (wakeResp.ok) {
              const d = await wakeResp.json();
              const c: string = d.choices?.[0]?.message?.content || "";
              if (c) {
                writer.write({ type: "text-start" as const, id: "text-1" });
                for (let i = 0; i < c.length; i += 40) {
                  writer.write({ type: "text-delta" as const, delta: c.slice(i, i + 40) } as any);
                  await new Promise((r) => setTimeout(r, 10));
                }
                writer.write({ type: "text-end" as const });
              }
            }
          } catch {}
        },
      });

      return createUIMessageStreamResponse({ stream });
    }

    const result = streamText({
      model: modelInstance,
      system: systemWithRoot,
      messages: modelMessages,
      // Autonomous loop — keep calling tools until LLM returns text.
      // Vercel AI SDK v5+ uses stopWhen, older versions used maxSteps.
      // We use stepCountIs(10) as the modern equivalent of maxSteps: 10
      stopWhen: stepCountIs(10),
      // maxSteps fallback for older SDK compat (ignored if stopWhen present)
      // @ts-ignore
      maxSteps: 10,
      tools: {
        execute_command: tool({
          description:
            "Execute a shell command in the project directory. Returns stdout and stderr. Use for npm, build, test, git, file ops. Commands timeout after 30s.",
          inputSchema: z.object({
            command: z.string().describe("Shell command to execute, e.g. 'npm install', 'npm run build', 'ls -la'"),
          }),
          execute: async ({ command }) => {
            const out = await execute_command(command, projectRoot);
            return out;
          },
        }),
        read_file: tool({
          description: "Read a file from the project filesystem. Returns file content or error string.",
          inputSchema: z.object({
            filepath: z.string().describe("Relative path to file from project root, e.g. 'src/app/page.tsx'"),
          }),
          execute: async ({ filepath }) => {
            return await read_file(filepath, projectRoot);
          },
        }),
        write_file: tool({
          description:
            "Create or overwrite a file. Auto-creates parent directories. Returns success or error string.",
          inputSchema: z.object({
            filepath: z.string().describe("Relative path to file from project root"),
            content: z.string().describe("Full file content to write"),
          }),
          execute: async ({ filepath, content }) => {
            return await write_file(filepath, content, projectRoot);
          },
        }),
        list_files: tool({
          description: "List files and directories at a path. Returns newline-separated names (dirs end with '/').",
          inputSchema: z.object({
            dirpath: z.string().describe("Relative path to directory from project root, e.g. '.' or 'src'"),
          }),
          execute: async ({ dirpath }) => {
            return await list_files(dirpath, projectRoot);
          },
        }),
        delete_file: tool({
          description: "Permanently delete a single file. Returns success or error. Use delete_directory for folders.",
          inputSchema: z.object({
            filepath: z.string().describe("Relative path to the file to delete from project root"),
          }),
          execute: async ({ filepath }) => {
            return await delete_file(filepath, projectRoot);
          },
        }),
        delete_directory: tool({
          description: "Permanently delete a directory and ALL its contents recursively. Cannot delete the project root.",
          inputSchema: z.object({
            dirpath: z.string().describe("Relative path to the directory to delete from project root"),
          }),
          execute: async ({ dirpath }) => {
            return await delete_directory(dirpath, projectRoot);
          },
        }),
        move_file: tool({
          description: "Move or rename a file or directory. Auto-creates destination parent directories. Works for both files and directories.",
          inputSchema: z.object({
            sourcePath: z.string().describe("Relative path of the file/directory to move from"),
            destPath: z.string().describe("Relative path of the destination to move to"),
          }),
          execute: async ({ sourcePath, destPath }) => {
            return await move_file(sourcePath, destPath, projectRoot);
          },
        }),
        create_directory: tool({
          description: "Create a new directory (including nested paths). Safe to call even if directory already exists.",
          inputSchema: z.object({
            dirpath: z.string().describe("Relative path of the directory to create from project root"),
          }),
          execute: async ({ dirpath }) => {
            return await create_directory(dirpath, projectRoot);
          },
        }),
      },
      onStepFinish: async ({ toolCalls, toolResults, text, finishReason }) => {
        // Optional logging for observability — visible in server logs
        if (toolCalls && toolCalls.length > 0) {
          console.log(`[agent] step finish: ${toolCalls.length} toolCall(s), reason=${finishReason}`);
        }
      },
      onError: ({ error }) => {
        console.error("[agent] stream error:", error);
      },
    });

    // Stream back to frontend using Vercel AI SDK's UI Message stream.
    // This works with `useChat` from 'ai/react' and the @ai-sdk provider.
    // `toUIMessageStreamResponse` streams tool calls + text deltas.
    return result.toUIMessageStreamResponse();
  } catch (err: any) {
    console.error("[agent] POST error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal agent error", detail: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Health check — lets frontend verify agent route is mounted separately from chat
export async function GET() {
  return new Response(
    JSON.stringify({
      status: "ok",
      route: "/api/agent",
      isolated: true,
      note: "Agent route is separate from /api/chat (Python backend) and /v1/* proxy. This is the autonomous tool-calling loop.",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
