"use client";
import { useState } from "react";
import { AgentFileExplorer } from "./AgentFileExplorer";
import { Clock, FileCode, CheckCircle2, AlertCircle, Terminal, Trash2, FolderPlus, ArrowRight } from "lucide-react";

type ToolCall = { toolCallId: string; toolName: string; input: any; result?: string; state: "call" | "result" };

function fileStatus(toolName: string, result?: string) {
  if (!result) return { label: "pending", color: "text-amber-400", icon: Clock };
  const lower = result.toLowerCase();
  if (lower.includes("error")) return { label: "failed", color: "text-red-400", icon: AlertCircle };
  if (toolName === "write_file" && (lower.includes("successfully wrote") || lower.includes("success")))
    return { label: "written", color: "text-emerald-400", icon: CheckCircle2 };
  if ((toolName === "delete_file" || toolName === "delete_directory") && lower.includes("successfully deleted"))
    return { label: "deleted", color: "text-red-400", icon: Trash2 };
  if (toolName === "move_file" && lower.includes("successfully moved"))
    return { label: "moved", color: "text-yellow-400", icon: ArrowRight };
  if (toolName === "create_directory" && lower.includes("successfully created"))
    return { label: "created", color: "text-cyan-400", icon: FolderPlus };
  return { label: "done", color: "text-[#888]", icon: FileCode };
}

const FILE_TOUCHING_TOOLS = ["write_file", "delete_file", "delete_directory", "move_file", "create_directory"];

export function AgentWorkspacePanel({
  projectPath,
  projectName,
  sessionMessages,
  refreshKey,
}: {
  projectPath: string;
  projectName?: string;
  sessionMessages: any[];
  refreshKey?: number;
}) {
  const [tab, setTab] = useState<"files" | "activity">("activity");

  // Collect all toolCalls across messages for activity feed
  const allToolCalls: Array<ToolCall & { msgId: string }> = [];
  sessionMessages.forEach((m) => {
    (m.toolCalls || []).forEach((tc: ToolCall) => allToolCalls.push({ ...tc, msgId: m.id }));
  });

  // Derive file operations — all tool types that touch files/dirs
  const fileOps = allToolCalls
    .filter((tc) => FILE_TOUCHING_TOOLS.includes(tc.toolName))
    .map((tc) => {
      let filepath = "unknown";
      if (tc.toolName === "write_file") filepath = tc.input?.filepath || "unknown";
      else if (tc.toolName === "delete_file") filepath = tc.input?.filepath || "unknown";
      else if (tc.toolName === "delete_directory") filepath = tc.input?.dirpath || "unknown";
      else if (tc.toolName === "move_file") filepath = `${tc.input?.sourcePath || "?"} → ${tc.input?.destPath || "?"}`;
      else if (tc.toolName === "create_directory") filepath = tc.input?.dirpath || "unknown";
      return { filepath, toolName: tc.toolName, state: fileStatus(tc.toolName, tc.result), result: tc.result };
    });

  const recentFiles = Array.from(new Set(fileOps.map((o) => o.filepath))).slice(0, 10);

  return (
    <div className="w-[360px] shrink-0 hidden xl:flex flex-col gap-3 h-full pt-24 pb-6 pr-4">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" />
        <span className="text-[11px] font-bold tracking-widest uppercase text-[#888]">{projectName || "Workspace"}</span>
        <span className="ml-auto text-[10px] font-mono text-[#555] truncate max-w-[140px]">{projectPath}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-[#161616] border border-[#222] rounded-xl">
        <button
          onClick={() => setTab("activity")}
          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === "activity" ? "bg-[#222] text-white" : "text-[#888] hover:text-white"}`}
        >
          Activity
        </button>
        <button
          onClick={() => setTab("files")}
          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === "files" ? "bg-[#222] text-white" : "text-[#888] hover:text-white"}`}
        >
          Files
        </button>
      </div>

      {tab === "activity" ? (
        <div className="flex-1 flex flex-col min-h-0 gap-3 overflow-hidden">
          {/* Touched files / dirs */}
          <div className="bg-[#111] border border-[#222] rounded-2xl p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <FileCode size={12} className="text-cyan-400" />
              <span className="text-[11px] font-semibold tracking-wide uppercase text-[#888]">Touched</span>
              <span className="ml-auto text-[10px] bg-[#222] px-1.5 py-0.5 rounded-full text-[#888]">{recentFiles.length}</span>
            </div>
            {recentFiles.length === 0 ? (
              <div className="py-4 text-center text-xs text-[#555]">No files yet — agent will list them here</div>
            ) : (
              <div className="space-y-1">
                {recentFiles.map((fp) => {
                  const op = fileOps.find((o) => o.filepath === fp)!;
                  const Icon = op.state.icon;
                  return (
                    <div key={fp} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#1a1a1a] border border-[#222]">
                      <Icon size={12} className={op.state.color} />
                      <span className="text-[11px] font-mono text-[#ccc] truncate flex-1">{fp}</span>
                      <span className={`text-[10px] font-bold uppercase ${op.state.color}`}>{op.state.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Execution Timeline */}
          <div className="flex-1 bg-[#111] border border-[#222] rounded-2xl p-3 overflow-hidden flex flex-col min-h-0">
            <div className="flex items-center gap-1.5 mb-2">
              <Terminal size={12} className="text-emerald-400" />
              <span className="text-[11px] font-semibold tracking-wide uppercase text-[#888]">Execution</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {allToolCalls.length === 0 && <div className="py-6 text-center text-xs text-[#555]">No tool calls yet</div>}
              {allToolCalls.map((tc, i) => {
                let summary = "";
                if (tc.toolName === "write_file") summary = tc.input?.filepath || "";
                else if (tc.toolName === "read_file") summary = tc.input?.filepath || "";
                else if (tc.toolName === "list_files") summary = tc.input?.dirpath || ".";
                else if (tc.toolName === "execute_command") summary = (tc.input?.command || "").slice(0, 40);
                else if (tc.toolName === "delete_file") summary = tc.input?.filepath || "";
                else if (tc.toolName === "delete_directory") summary = tc.input?.dirpath || "";
                else if (tc.toolName === "move_file") summary = `${tc.input?.sourcePath || "?"} → ${tc.input?.destPath || "?"}`;
                else if (tc.toolName === "create_directory") summary = tc.input?.dirpath || "";
                else summary = JSON.stringify(tc.input || "").slice(0, 40);

                return (
                  <div key={tc.toolCallId + i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#1a1a1a] border border-[#1e1e1e]">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${tc.state === "result" ? "bg-emerald-500" : "bg-amber-500 animate-pulse"}`} />
                    <span className="text-[11px] font-mono font-bold text-[#888] shrink-0">{tc.toolName.replace(/_/g, " ")}</span>
                    <span className="text-[11px] font-mono text-[#666] truncate flex-1">{summary}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <AgentFileExplorer projectPath={projectPath} refreshKey={refreshKey} />
      )}
    </div>
  );
}
