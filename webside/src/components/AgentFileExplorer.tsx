"use client";
import { useEffect, useState } from "react";
import { Folder, File, ChevronRight, ChevronDown, RefreshCw } from "lucide-react";

type Entry = { name: string; isDirectory: boolean; path: string };

export function AgentFileExplorer({ projectPath, refreshKey }: { projectPath: string; refreshKey?: number }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cwd, setCwd] = useState(projectPath);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/filesystem?path=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setCwd(data.path || p);
      setEntries(data.entries || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectPath) load(projectPath);
  }, [projectPath, refreshKey]);

  const navigateUp = () => {
    if (!cwd) return;
    const parent = cwd.split(/[/\\]/).slice(0, -1).join("/") || "";
    if (!parent) return;
    // handle C:/ edge: if cwd is like C:/, parent would be C: -> keep C:/
    const next = parent.match(/^[A-Z]:$/) ? parent + "/" : parent;
    load(next);
  };

  return (
    <div className="flex flex-col h-full bg-[#111] border border-[#222] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#222] bg-[#161616]">
        <div className="flex items-center gap-2 min-w-0">
          <Folder size={12} className="text-[#eab308] shrink-0" />
          <span className="text-[11px] font-mono text-[#888] truncate">{cwd || projectPath || "—"}</span>
        </div>
        <button onClick={() => load(cwd || projectPath)} className="p-1 rounded hover:bg-[#222] text-[#666] hover:text-white" title="Refresh">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {cwd && cwd !== projectPath && (
        <button onClick={navigateUp} className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-[#666] hover:text-white hover:bg-[#1a1a1a] border-b border-[#222]">
          <ChevronRight size={12} /> Up
        </button>
      )}

      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {loading && <div className="py-6 text-center text-xs text-[#555]">Loading…</div>}
        {error && <div className="py-4 text-center text-xs text-red-400 px-2 break-all">{error}</div>}
        {!loading && !error && entries.length === 0 && <div className="py-6 text-center text-xs text-[#555]">Empty folder</div>}
        {entries.map((e) => (
          <button
            key={e.path}
            onClick={() => e.isDirectory && load(e.path)}
            className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-[#1e1e1e] text-left group"
          >
            {e.isDirectory ? <Folder size={12} className="text-[#eab308] shrink-0" /> : <File size={12} className="text-[#888] shrink-0" />}
            <span className="text-[12px] truncate text-[#c0c0c0] group-hover:text-white">{e.name}</span>
            {e.isDirectory && <ChevronRight size={10} className="ml-auto text-[#444]" />}
          </button>
        ))}
      </div>
    </div>
  );
}
