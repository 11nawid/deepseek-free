import React, { useState, useEffect } from 'react';
import { FolderPlus, Search, Edit3, Settings, HelpCircle, Triangle, Trash2, Folder, ArrowLeft, HardDrive } from 'lucide-react';

interface AgentProjectsScreenProps {
  onStartChat: (project: any) => void;
  onResumeChat: (project: any, session: any) => void;
  onSettings: () => void;
}

// Minimal file browser modal for web fallback (when Electron not available)
function FolderPickerModal({ onClose, onPick }: { onClose: () => void; onPick: (path: string) => void }) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/filesystem?path=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to list");
      setCurrentPath(data.path ?? p);
      // only dirs for picker
      setEntries((data.entries || []).filter((e: any) => e.isDirectory));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(currentPath);
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#1c1c1c] border border-[#333] rounded-2xl w-full max-w-lg max-h-[70vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-[#2a2a2a] flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <HardDrive size={14} className="text-[#666]" />
            <span className="text-[12px] font-mono text-[#a0a0a0] truncate">{currentPath || "My Computer"}</span>
          </div>
          <button onClick={onClose} className="text-[#666] hover:text-white text-sm px-2">✕</button>
        </div>

        <div className="px-3 py-2 flex items-center gap-2 border-b border-[#2a2a2a] bg-[#161616]">
          <button
            onClick={() => {
              if (!currentPath) return;
              const parent = currentPath.split(/[/\\]/).slice(0, -1).join("/") || "";
              // Windows C:/ edge
              const next = parent || (currentPath.match(/^[A-Z]:\//) ? "" : "/");
              load(next);
            }}
            disabled={!currentPath}
            className="flex items-center gap-1 text-xs text-[#a0a0a0] hover:text-white disabled:opacity-30"
          >
            <ArrowLeft size={12} /> Up
          </button>
          <span className="ml-auto text-[11px] text-[#555]">{entries.length} folders</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading && <div className="py-8 text-center text-sm text-[#555]">Loading…</div>}
          {error && <div className="py-4 text-center text-xs text-red-400">{error}</div>}
          {!loading && !error && entries.length === 0 && <div className="py-8 text-center text-sm text-[#555]">No subfolders</div>}
          {entries.map((e) => (
            <button
              key={e.path}
              onClick={() => load(e.path)}
              onDoubleClick={() => load(e.path)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#2a2a2a] text-left text-sm text-[#d0d0d0]"
            >
              <Folder size={14} className="text-[#eab308]" /> <span className="truncate">{e.name}</span>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-[#2a2a2a] flex items-center justify-between gap-3 bg-[#161616]">
          <span className="text-[11px] font-mono text-[#666] truncate flex-1">{currentPath || "Select a folder"}</span>
          <button
            onClick={() => currentPath && onPick(currentPath)}
            disabled={!currentPath}
            className="px-4 py-1.5 rounded-lg bg-[#ededed] text-[#111] text-xs font-semibold disabled:opacity-30 hover:bg-white"
          >
            Select this folder
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AgentProjectsScreen({ onStartChat, onResumeChat, onSettings }: AgentProjectsScreenProps) {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sessions, setSessions] = useState<any[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const fetchProjects = async () => {
    try {
      setLoadingProjects(true);
      const res = await fetch("/api/agent/projects");
      const data = await res.json();
      if (Array.isArray(data)) {
        setProjects(data);
        if (data.length > 0 && !selectedProjectId) setSelectedProjectId(data[0].id);
      }
    } catch {}
    finally { setLoadingProjects(false); }
  };

  const fetchSessions = async (projectId: string) => {
    try {
      const res = await fetch(`/api/agent/projects/${projectId}/sessions`);
      const data = await res.json();
      if (Array.isArray(data)) setSessions(data);
    } catch { setSessions([]); }
  };

  useEffect(() => { fetchProjects(); }, []);
  useEffect(() => { if (selectedProjectId) fetchSessions(selectedProjectId); else setSessions([]); }, [selectedProjectId]);

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const handleOpenProject = async () => {
    // 1) Try Electron native dialog
    const electron = (window as any).electronAPI;
    if (electron?.openDirectory) {
      const picked = await electron.openDirectory();
      if (picked) {
        const res = await fetch("/api/agent/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: picked }),
        });
        const proj = await res.json();
        if (res.ok) { await fetchProjects(); setSelectedProjectId(proj.id); }
        else alert(proj.error || "Failed to add project");
        return;
      }
      return;
    }
    // 2) Try File System Access API (best-effort) — note it doesn't give real path, so fallback to manual picker
    try {
      if ((window as any).showDirectoryPicker) {
        // Will still need real path; we open our own filesystem modal instead
        setShowPicker(true);
        return;
      }
    } catch {}
    setShowPicker(true);
  };

  const handlePickerPick = async (pickedPath: string) => {
    setShowPicker(false);
    const res = await fetch("/api/agent/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pickedPath }),
    });
    const proj = await res.json();
    if (res.ok) { await fetchProjects(); setSelectedProjectId(proj.id); }
    else alert(proj.error || "Failed to add");
  };

  const handleNewSession = async () => {
    if (!selectedProject) return;
    const res = await fetch(`/api/agent/projects/${selectedProject.id}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New session" }),
    });
    const sess = await res.json();
    if (res.ok) {
      // Refresh session list in background, then open the new session in chat
      fetchSessions(selectedProject.id);
      onResumeChat(selectedProject, sess);
    }
  };

  const handleDeleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Delete project and all its sessions?")) return;
    await fetch(`/api/agent/projects/${id}`, { method: "DELETE" });
    await fetchProjects();
    if (selectedProjectId === id) { setSelectedProjectId(null); setSessions([]); }
  };

  // Group sessions
  const filteredSessions = sessions.filter(s => !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const now = new Date();
  const isToday = (d: string) => new Date(d).toDateString() === now.toDateString();
  const isYesterday = (d: string) => {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return new Date(d).toDateString() === y.toDateString();
  };
  const today = filteredSessions.filter(s => isToday(s.updatedAt || s.createdAt));
  const yesterday = filteredSessions.filter(s => isYesterday(s.updatedAt || s.createdAt));
  const older = filteredSessions.filter(s => !isToday(s.updatedAt || s.createdAt) && !isYesterday(s.updatedAt || s.createdAt));

  const SessionButton = ({ s }: { s: any }) => (
    <button
      onClick={() => onResumeChat(selectedProject, s)}
      className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-[#1f1f1f] text-[#d0d0d0] group text-left"
    >
      <div className="w-[18px] h-[18px] bg-[#2a2a2a] rounded-[4px] flex items-center justify-center border border-[#333] shrink-0">
        <Triangle size={10} className="fill-[#a3e635] text-[#a3e635]" />
      </div>
      <span className="text-[13px] font-medium tracking-wide truncate flex-1">{s.name}</span>
      <span className="text-[10px] text-[#555] hidden group-hover:block">{new Date(s.updatedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
    </button>
  );

  return (
    <div className="flex-1 w-full h-full flex justify-center bg-[#0e0e0e] text-[#a0a0a0] font-sans pt-24 sm:pt-28 pb-6 overflow-hidden z-20 pointer-events-auto px-4 md:px-0">
      <div className="w-full max-w-[1000px] flex flex-col md:flex-row gap-8 md:gap-12 h-full">
        {/* Left Column: Projects */}
        <div className="w-full md:w-[280px] flex flex-col h-1/3 md:h-full shrink-0">
          <div className="flex items-center justify-between px-3 mb-6">
            <h2 className="text-[13px] font-semibold text-[#a0a0a0]">Projects</h2>
            <button onClick={handleOpenProject} className="text-[#a0a0a0] hover:text-white transition-colors cursor-pointer" title="Add project folder">
              <FolderPlus size={16} strokeWidth={1.5} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-[2px] min-h-[100px]">
            {loadingProjects && <div className="px-3 py-4 text-xs text-[#555]">Loading projects…</div>}
            {!loadingProjects && projects.length === 0 && (
              <div className="px-3 py-6 text-center">
                <p className="text-xs text-[#555]">No projects yet</p>
                <p className="text-[11px] text-[#444] mt-1">Add a real folder to begin</p>
                <button onClick={handleOpenProject} className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-[#1c1c1c] border border-[#333] hover:bg-[#2a2a2a] text-[#a0a0a0]">Choose folder</button>
              </div>
            )}
            {projects.map(proj => (
              <button
                key={proj.id}
                onClick={() => setSelectedProjectId(proj.id)}
                className={`group w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                  selectedProjectId === proj.id ? 'bg-[#2a2a2a] text-[#ededed]' : 'hover:bg-[#1f1f1f] text-[#a0a0a0]'
                }`}
                title={proj.path}
              >
                <div className={`w-[18px] h-[18px] rounded-[4px] flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${proj.color}`}>
                  {proj.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col items-start min-w-0 flex-1">
                  <span className="text-[13px] tracking-wide truncate w-full text-left">{proj.name}</span>
                  <span className="text-[10px] font-mono text-[#555] truncate w-full text-left">{proj.path}</span>
                </div>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${proj.exists === false ? 'bg-red-500' : 'bg-emerald-500/60'}`} title={proj.exists === false ? 'Folder not found' : 'Ready'} />
                <Trash2 size={12} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-400 shrink-0" onClick={(e) => handleDeleteProject(e, proj.id)} />
              </button>
            ))}
          </div>

          <div className="mt-4 md:mt-auto pt-6 pb-2 space-y-1 hidden md:block">
            <button onClick={onSettings} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#1f1f1f] text-[#a0a0a0] transition-colors cursor-pointer text-[13px]">
              <Settings size={15} strokeWidth={1.5} /> Settings
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#1f1f1f] text-[#a0a0a0] transition-colors cursor-pointer text-[13px]">
              <HelpCircle size={15} strokeWidth={1.5} /> Help
            </button>
          </div>
        </div>

        {/* Right Column: Sessions */}
        <div className="flex-1 flex flex-col h-full min-h-0">
          <div className="relative mb-6 w-full max-w-[600px]">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#555]" strokeWidth={2} />
            <input
              type="text"
              placeholder={`Search sessions in ${selectedProject?.name || 'project'}`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 bg-[#1c1c1c] rounded-md pl-11 pr-4 text-[13px] text-[#ededed] placeholder-[#555] outline-none border border-transparent focus:border-[#333] transition-colors"
            />
          </div>

          {!selectedProject ? (
            <div className="flex-1 flex items-center justify-center text-sm text-[#555]">Select a project</div>
          ) : (
            <div className="flex-1 overflow-y-auto max-w-[800px] pr-2">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[13px] font-semibold text-[#a0a0a0]">Today</h3>
                <button onClick={handleNewSession} className="flex items-center gap-1.5 text-[13px] text-[#a0a0a0] hover:text-[#ededed] transition-colors cursor-pointer">
                  <Edit3 size={14} strokeWidth={1.5} /> New session
                </button>
              </div>
              <div className="space-y-1 mb-8">
                {today.length === 0 && <div className="px-2 py-2 text-xs text-[#444]">No sessions today — start a new one</div>}
                {today.map(s => <SessionButton key={s.id} s={s} />)}
              </div>

              <h3 className="text-[13px] font-semibold text-[#a0a0a0] mb-4">Yesterday</h3>
              <div className="space-y-1 mb-8">
                {yesterday.length === 0 && <div className="px-2 py-2 text-xs text-[#444]">—</div>}
                {yesterday.map(s => <SessionButton key={s.id} s={s} />)}
              </div>

              <h3 className="text-[13px] font-semibold text-[#a0a0a0] mb-4">Older</h3>
              <div className="space-y-1">
                {older.length === 0 && <div className="px-2 py-2 text-xs text-[#444]">—</div>}
                {older.map(s => <SessionButton key={s.id} s={s} />)}
              </div>
            </div>
          )}
        </div>
      </div>

      {showPicker && <FolderPickerModal onClose={() => setShowPicker(false)} onPick={handlePickerPick} />}
    </div>
  );
}
