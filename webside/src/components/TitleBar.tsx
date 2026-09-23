"use client";

import { useState, useEffect } from "react";
import { Minus, Square, X, Maximize2 } from "lucide-react";

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onWindowState: (cb: (state: string) => void) => void;
      platform: string;
      getAppPath: () => Promise<{ root: string; cookies: string; isDev: boolean }>;
      areCookiesFresh: () => Promise<boolean>;
      transcribeAudio: (float32Buffer: ArrayBuffer) => Promise<{ text: string }>;
    };
  }
}

export default function TitleBar() {
  const [ready, setReady] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    setReady(true);
    api.isMaximized().then(setMaximized);
    api.onWindowState((state) => setMaximized(state === "maximized"));
  }, []);

  // Always render the 40px bar so server/client match.
  // When not in Electron, it's just an invisible spacer.
  if (!ready) {
    return <div className="h-10 w-full shrink-0" />;
  }

  const isMac = window.electronAPI!.platform === "darwin";

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[200] h-10 flex items-center justify-between select-none bg-background border-b border-border"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className={`h-full ${isMac ? "w-20" : "w-4"}`} />

      <div className="text-xs font-semibold text-muted tracking-wide">
        DeepSeek Free
      </div>

      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={() => window.electronAPI?.minimize()}
          className="h-full px-4 flex items-center justify-center text-muted hover:bg-input-bg hover:text-foreground transition-colors"
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => window.electronAPI?.maximize()}
          className="h-full px-4 flex items-center justify-center text-muted hover:bg-input-bg hover:text-foreground transition-colors"
        >
          {maximized ? <Maximize2 size={12} strokeWidth={1.5} /> : <Square size={11} strokeWidth={1.5} />}
        </button>
        <button
          onClick={() => window.electronAPI?.close()}
          className="h-full px-4 flex items-center justify-center text-muted hover:bg-red-500 hover:text-white transition-colors"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
