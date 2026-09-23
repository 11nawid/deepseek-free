import React, { useState } from 'react';
import { Play, Pause, Square, Activity, Terminal, Database, Code, CheckCircle2, ChevronRight, MoreHorizontal } from 'lucide-react';

export default function AgentWorkspace() {
  const [agentState, setAgentState] = useState<'idle' | 'running' | 'paused'>('idle');

  return (
    <div className="flex-1 w-full h-full flex flex-col pt-24 px-6 pb-6 overflow-hidden animate-in fade-in duration-500">
      {/* Agent Header Control */}
      <div className="w-full flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <span className="text-indigo-400 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]">Autonomous</span> Agent
          </h1>
          <p className="text-sm text-muted mt-1">Configure and monitor independent AI workflows</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="px-4 py-1.5 rounded-full border border-foreground/10 bg-panel text-xs font-semibold tracking-wide flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${agentState === 'running' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse' : agentState === 'paused' ? 'bg-amber-500' : 'bg-muted'}`} />
            {agentState === 'running' ? 'ACTIVE' : agentState === 'paused' ? 'PAUSED' : 'IDLE'}
          </div>
          
          {agentState === 'idle' ? (
            <button 
              onClick={() => setAgentState('running')}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_4px_14px_rgba(99,102,241,0.4)] transition-all cursor-pointer"
            >
              <Play size={16} fill="currentColor" />
              <span className="font-semibold text-sm">Deploy Agent</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setAgentState(agentState === 'running' ? 'paused' : 'running')}
                className="p-2 rounded-xl bg-panel border border-foreground/10 hover:bg-foreground/5 text-foreground transition-all cursor-pointer"
              >
                {agentState === 'running' ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              </button>
              <button 
                onClick={() => setAgentState('idle')}
                className="p-2 rounded-xl bg-destructive/10 border border-destructive/20 hover:bg-destructive/20 text-destructive transition-all cursor-pointer"
              >
                <Square size={18} fill="currentColor" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Grid Layout for Agent Tools */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
        
        {/* Left Column: Tasks & Planner */}
        <div className="col-span-1 flex flex-col gap-6">
          <div className="flex-1 bg-panel/50 backdrop-blur-xl border border-foreground/5 rounded-3xl p-5 flex flex-col shadow-soft">
            <div className="flex items-center gap-2 mb-4">
              <Activity size={18} className="text-indigo-400" />
              <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Current Objective</h2>
            </div>
            
            {agentState === 'idle' ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4 opacity-50">
                <p className="text-sm">Agent is waiting for instructions.</p>
                <p className="text-xs mt-2">Deploy the agent to begin autonomous planning.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                {[
                  { title: "Analyze codebase architecture", status: "done" },
                  { title: "Identify missing dependencies", status: "running" },
                  { title: "Generate scaffold files", status: "pending" },
                  { title: "Execute unit tests", status: "pending" },
                ].map((task, i) => (
                  <div key={i} className={`p-3 rounded-2xl border ${task.status === 'done' ? 'bg-emerald-500/10 border-emerald-500/20' : task.status === 'running' ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-background/50 border-border/50'} flex items-start gap-3 transition-colors`}>
                    <div className="mt-0.5">
                      {task.status === 'done' ? <CheckCircle2 size={16} className="text-emerald-500" /> : task.status === 'running' ? <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" /> : <div className="w-4 h-4 rounded-full border-2 border-muted" />}
                    </div>
                    <span className={`text-sm ${task.status === 'done' ? 'text-foreground/70 line-through' : task.status === 'running' ? 'text-foreground font-medium' : 'text-muted'}`}>{task.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Middle & Right: Workspace & Terminal */}
        <div className="col-span-1 lg:col-span-2 flex flex-col gap-6">
          
          {/* Active Workspace */}
          <div className="flex-1 bg-panel/50 backdrop-blur-xl border border-foreground/5 rounded-3xl p-5 flex flex-col shadow-soft relative overflow-hidden">
            <div className="flex items-center gap-2 mb-4 relative z-10">
              <Code size={18} className="text-cyan-400" />
              <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Workspace Memory</h2>
            </div>
            
            <div className="flex-1 rounded-2xl bg-background/50 border border-border/50 p-4 font-mono text-sm overflow-hidden flex flex-col">
               {agentState === 'idle' ? (
                 <div className="flex-1 flex items-center justify-center opacity-40">No active workspace</div>
               ) : (
                 <>
                   <div className="flex items-center justify-between text-xs text-muted mb-4 border-b border-border/50 pb-2">
                     <div className="flex items-center gap-4">
                       <span className="flex items-center gap-1 text-cyan-400"><Database size={12} /> Context: 12.4k tok</span>
                       <span>Files modified: 0</span>
                     </div>
                     <span>agent-workspace-v1.2</span>
                   </div>
                   <div className="flex-1 overflow-y-auto space-y-2 text-foreground/80">
                     <p><span className="text-indigo-400">#</span> Loaded src/components/AgentWorkspace.tsx</p>
                     <p><span className="text-indigo-400">#</span> Loaded src/app/page.tsx</p>
                     <p className="animate-pulse opacity-60">Scanning dependencies...</p>
                   </div>
                 </>
               )}
            </div>
          </div>

          {/* Terminal / Live Logs */}
          <div className="flex-1 bg-[#0a0a0a] border border-foreground/10 rounded-3xl p-5 flex flex-col shadow-soft relative">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Terminal size={18} className="text-emerald-400" />
                <h2 className="font-semibold text-sm uppercase tracking-wider text-white/50">Execution Logs</h2>
              </div>
              <MoreHorizontal size={16} className="text-white/30" />
            </div>
            
            <div className="flex-1 font-mono text-[13px] text-emerald-500/80 overflow-y-auto space-y-1.5 p-2 selection:bg-emerald-500/30">
              {agentState === 'idle' ? (
                <div className="text-white/20">Waiting for agent deployment...</div>
              ) : (
                <>
                  <div className="text-white/40">[SYSTEM] Agent initialized on port 8000</div>
                  <div className="text-white/40">[SYSTEM] Loading environment variables... OK</div>
                  <div>$ Searching for workspace context...</div>
                  <div>$ Found Next.js project structure</div>
                  <div className="text-indigo-400">[AGENT] Planning sequence of actions...</div>
                  {agentState === 'running' && (
                    <div className="flex items-center gap-2 mt-2">
                      <ChevronRight size={14} className="text-emerald-500" />
                      <span className="animate-pulse">_</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
