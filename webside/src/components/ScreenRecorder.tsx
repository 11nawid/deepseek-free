"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X, Loader2, Check, Circle, Pause, Play, Square, FolderOpen, FolderInput,
  RefreshCw, Monitor, Mic, Volume2, Minimize2, Maximize2, GripVertical,
} from "lucide-react";

type Phase = "pick" | "preview" | "recording" | "review";

interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  appIcon?: string | null;
}

interface ElectronScreenAPI {
  minimize?: () => void;
  screenGetSources?: () => Promise<ScreenSource[] | { error: string }>;
  screenGetDefaultPath?: () => Promise<{ dir: string; fileName: string; fullPath: string }>;
  screenSaveDialog?: (name: string) => Promise<{ canceled: boolean; filePath?: string }>;
  screenSaveFile?: (filePath: string, data: ArrayBuffer) => Promise<{ success: boolean; path?: string; error?: string }>;
  screenOpenFolder?: (filePath: string) => Promise<{ success: boolean }>;
  openDirectory?: () => Promise<string | null>;
}

function getElectron(): ElectronScreenAPI | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronAPI?: ElectronScreenAPI }).electronAPI;
  return api ?? null;
}

const isElectron = () => !!getElectron()?.screenGetSources;

// Pick the most efficient supported mime type. Prefer real MP4 (Electron 35 / Chrome 126+ supports it)
// so the default `.../deepseek-free-recording/<random>.mp4` file is a genuine MP4.
function pickMimeType(): { mime: string; ext: "mp4" | "webm" } {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
    return { mime: "", ext: "webm" };
  }
  const candidates: Array<{ mime: string; ext: "mp4" | "webm" }> = [
    { mime: "video/mp4;codecs=avc1.640028", ext: "mp4" },
    { mime: "video/mp4;codecs=avc1", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm;codecs=h264,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return c;
    } catch { /* ignore */ }
  }
  return { mime: "", ext: "webm" };
}

const QUALITY = {
  "720p": { label: "720p · HD · light", w: 1280, h: 720, fps: 30, bps: 5_000_000 },
  "1080p": { label: "1080p · Full HD · balanced", w: 1920, h: 1080, fps: 30, bps: 8_000_000 },
  "4K": { label: "2160p · 4K · best", w: 3840, h: 2160, fps: 30, bps: 16_000_000 },
} as const;
type QualityKey = keyof typeof QUALITY;

function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

function formatBytes(b: number) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function randomFileName(ext: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `recording-${stamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

export default function ScreenRecorder({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [minimized, setMinimized] = useState(false);
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityKey>("1080p");
  const [withMic, setWithMic] = useState(false);
  const [withSysAudio, setWithSysAudio] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // recording state
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [recordedSize, setRecordedSize] = useState(0);

  // review state
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobSize, setBlobSize] = useState(0);
  const [saveDir, setSaveDir] = useState("");
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // floating mini-bar drag position (null = docked bottom-right)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const liveRef = useRef<HTMLVideoElement | null>(null);
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunksBytesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeRef = useRef<{ mime: string; ext: "mp4" | "webm" }>({ mime: "", ext: "webm" });
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } });
    streamRef.current = null;
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // Closing the window mid-capture would kill the recording, so collapse instead.
  const busy = phase === "preview" || phase === "recording";
  const handleBackdrop = useCallback(() => {
    if (busy) setMinimized(true);
    else onClose();
  }, [busy, onClose]);

  // ---- load sources ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingSources(true);
      setSourcesError(null);
      const api = getElectron();
      if (api?.screenGetSources) {
        try {
          const res = await api.screenGetSources();
          if (cancelled) return;
          if (Array.isArray(res)) {
            setSources(res);
            if (res.length > 0) setSelectedId(res[0].id);
          } else {
            setSourcesError(res?.error || "Could not list windows.");
          }
        } catch (e) {
          if (!cancelled) setSourcesError(e instanceof Error ? e.message : "Could not list windows.");
        } finally {
          if (!cancelled) setLoadingSources(false);
        }
        try {
          const def = await api.screenGetDefaultPath?.();
          if (!cancelled && def) {
            setSaveDir(def.dir);
            mimeRef.current = pickMimeType();
            setFileName(def.fileName.replace(/\.mp4$/i, `.${mimeRef.current.ext}`));
          }
        } catch { /* keep manual fallback */ }
      } else {
        // Browser fallback: no thumbnail picker; user picks via native dialog.
        if (!cancelled) {
          setSources([]);
          setLoadingSources(false);
        }
        mimeRef.current = pickMimeType();
        setFileName(randomFileName(mimeRef.current.ext));
      }
      if (!saveDir) {
        setSaveDir((prev) => prev || "Downloads (browser)");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cleanup on unmount
  useEffect(() => () => {
    stopTimer();
    try { recorderRef.current?.state !== "inactive" && recorderRef.current?.stop(); } catch { /* noop */ }
    stopTracks();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-attach the live stream whenever the full panel (re)mounts — e.g. after un-minimizing.
  useEffect(() => {
    if (minimized) return;
    const stream = streamRef.current;
    if (!stream) return;
    if (phase === "recording" && liveRef.current) {
      liveRef.current.srcObject = stream;
      liveRef.current.play().catch(() => {});
    }
    if (phase === "preview" && previewRef.current) {
      previewRef.current.srcObject = stream;
      previewRef.current.play().catch(() => {});
    }
  }, [minimized, phase]);

  // ---- acquire stream for selected source (live preview) ----
  const acquireStream = useCallback(async (sourceId: string | null): Promise<MediaStream> => {
    const q = QUALITY[quality];
    const api = getElectron();
    // Electron path: capture the exact window/screen via chromeMediaSource.
    if (api?.screenGetSources && sourceId) {
      // `mandatory.chromeMediaSource` is Electron/Chromium-specific — cast to any.
      const constraints = {
        audio: withSysAudio ? {
          mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId },
        } : false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: sourceId,
            maxWidth: q.w,
            maxHeight: q.h,
            maxFrameRate: q.fps,
          },
        },
      } as unknown as MediaStreamConstraints;
      const display = await navigator.mediaDevices.getUserMedia(constraints);
      if (withMic) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
          });
          mic.getAudioTracks().forEach((t) => display.addTrack(t));
        } catch { /* mic optional */ }
      }
      return display;
    }
    // Browser fallback: native picker (source choice happens in the browser UI).
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps, max: q.fps } } as MediaTrackConstraints,
      audio: withSysAudio,
    });
    if (withMic) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        mic.getAudioTracks().forEach((t) => display.addTrack(t));
      } catch { /* mic optional */ }
    }
    return display;
  }, [quality, withMic, withSysAudio]);

  const showPreview = useCallback(async () => {
    const api = getElectron();
    if (api?.screenGetSources && !selectedId) {
      setStartError("Select a window or screen first.");
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      stopTracks();
      const stream = await acquireStream(selectedId);
      streamRef.current = stream;
      setPhase("preview");
      requestAnimationFrame(() => {
        const v = previewRef.current;
        if (v) { v.srcObject = stream; v.play().catch(() => {}); }
      });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Could not capture that source.");
    } finally {
      setStarting(false);
    }
  }, [acquireStream, selectedId, stopTracks]);

  // re-acquire when quality/audio toggles change while previewing
  const refreshPreview = useCallback(async () => {
    if (phase !== "preview") return;
    try {
      stopTracks();
      const stream = await acquireStream(selectedIdRef.current);
      streamRef.current = stream;
      const v = previewRef.current;
      if (v) { v.srcObject = stream; v.play().catch(() => {}); }
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Preview failed.");
    }
  }, [acquireStream, phase, stopTracks]);

  // ---- recording (optimised: timesliced chunks, capped bitrate, no state churn) ----
  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) { setStartError("No preview stream. Go back and select a source."); return; }
    const q = QUALITY[quality];
    mimeRef.current = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mimeRef.current.mime || undefined,
        videoBitsPerSecond: q.bps,
        audioBitsPerSecond: 128_000,
      });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    chunksRef.current = [];
    chunksBytesRef.current = 0;
    setRecordedSize(0);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data); // ref only — no re-render per chunk
        chunksBytesRef.current += e.data.size;
      }
    };
    recorder.onerror = () => setStartError("Recording error. Try a lower quality.");
    recorder.onstop = () => {
      stopTimer();
      const type = mimeRef.current.mime || recorder.mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      const url = URL.createObjectURL(blob);
      setBlobUrl((old) => { if (old) URL.revokeObjectURL(old); return url; });
      setBlobSize(blob.size);
      stopTracks();
      // sync filename extension to actual container
      const ext: "mp4" | "webm" = type.includes("mp4") ? "mp4" : "webm";
      mimeRef.current = { mime: type, ext };
      setFileName((prev) => {
        const base = prev.replace(/\.(mp4|webm|mkv)$/i, "") || randomFileName(ext).replace(/\.\w+$/, "");
        return `${base}.${ext}`;
      });
      setSavedPath(null);
      setSaveError(null);
      setMinimized(false); // pop back open for review/save
      setPhase("review");
      // stash blob for saving without keeping it in state
      (window as unknown as { __lastRecording?: Blob }).__lastRecording = blob;
    };
    // 1000ms timeslice keeps memory flat for long recordings
    recorder.start(1000);
    recorderRef.current = recorder;
    setElapsed(0);
    setPaused(false);
    setPhase("recording");
    setMinimized(true); // collapse so you can freely use/record anything
    stopTimer();
    timerRef.current = setInterval(() => {
      setElapsed((s) => s + 1);
      setRecordedSize(chunksBytesRef.current);
    }, 1000);
    requestAnimationFrame(() => {
      const v = liveRef.current;
      if (v && stream) { v.srcObject = stream; v.play().catch(() => {}); }
    });
  }, [quality, stopTimer, stopTracks]);

  const togglePause = useCallback(() => {
    const r = recorderRef.current;
    if (!r) return;
    try {
      if (r.state === "recording") {
        r.pause();
        setPaused(true);
        stopTimer();
      } else if (r.state === "paused") {
        r.resume();
        setPaused(false);
        stopTimer();
        timerRef.current = setInterval(() => {
          setElapsed((s) => s + 1);
          setRecordedSize(chunksBytesRef.current);
        }, 1000);
      }
    } catch { /* noop */ }
  }, [stopTimer]);

  const stopRecording = useCallback(() => {
    const r = recorderRef.current;
    if (!r) return;
    try {
      if (r.state === "paused") r.resume(); // flush final chunk cleanly
      setRecordedSize(chunksBytesRef.current);
      r.stop();
    } catch { /* noop */ }
  }, []);

  const discardAndBack = useCallback(() => {
    try { recorderRef.current?.state !== "inactive" && recorderRef.current?.stop(); } catch { /* noop */ }
    stopTimer();
    stopTracks();
    if (blobUrl) { URL.revokeObjectURL(blobUrl); setBlobUrl(null); }
    (window as unknown as { __lastRecording?: Blob }).__lastRecording = undefined;
    setElapsed(0);
    setPaused(false);
    setSavedPath(null);
    setSaveError(null);
    setMinimized(false);
    setPhase("pick");
  }, [blobUrl, stopTimer, stopTracks]);

  // ---- saving ----
  const browseFolder = useCallback(async () => {
    const api = getElectron();
    if (api?.openDirectory) {
      const dir = await api.openDirectory();
      if (dir) setSaveDir(dir);
    } else {
      setSaveError("Folder picker needs the desktop app. Your browser will download instead.");
    }
  }, []);

  const openSavedFolder = useCallback(async () => {
    if (!savedPath) return;
    const api = getElectron();
    if (api?.screenOpenFolder) await api.screenOpenFolder(savedPath);
  }, [savedPath]);

  const hideAppWindow = useCallback(() => {
    getElectron()?.minimize?.();
  }, []);

  const saveRecording = useCallback(async (useDialog = true) => {
    const blob: Blob | undefined = (window as unknown as { __lastRecording?: Blob }).__lastRecording;
    if (!blob) { setSaveError("Nothing to save yet."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const api = getElectron();
      const buffer = await blob.arrayBuffer();
      if (api?.screenSaveFile) {
        let target: string | null = null;
        if (useDialog && api.screenSaveDialog) {
          const res = await api.screenSaveDialog(fileName || randomFileName(mimeRef.current.ext));
          if (res.canceled || !res.filePath) { setSaving(false); return; }
          target = res.filePath;
        } else {
          const dir = saveDir && saveDir !== "Downloads (browser)" ? saveDir : (await api.screenGetDefaultPath?.())?.dir;
          if (!dir) throw new Error("No save folder.");
          target = `${dir.replace(/[\\/]+$/, "")}/${fileName || randomFileName(mimeRef.current.ext)}`;
        }
        // Send a copy; structured-clone of ArrayBuffer is efficient (no base64 bloat).
        const res = await api.screenSaveFile(target, buffer.slice(0));
        if (!res.success) throw new Error(res.error || "Save failed.");
        setSavedPath(res.path ?? target);
        setSaveDir(target.substring(0, Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\"))));
      } else {
        // Browser fallback: trigger download.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName || randomFileName(mimeRef.current.ext);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        setSavedPath(`Downloads/${a.download}`);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [fileName, saveDir]);

  // ---- floating mini-bar drag ----
  const startDrag = (e: React.PointerEvent) => {
    const r = widgetRef.current?.getBoundingClientRect();
    if (!r) return;
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
  };
  const onDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPos({
      left: Math.max(0, Math.min(window.innerWidth - 220, e.clientX - dragRef.current.dx)),
      top: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragRef.current.dy)),
    });
  };
  const endDrag = () => { dragRef.current = null; };

  const selected = sources.find((s) => s.id === selectedId) ?? null;
  const recDot = phase === "recording" && !paused;

  // ---------- minimized floating control ----------
  if (minimized) {
    return (
      <div
        ref={widgetRef}
        className="fixed z-[130] flex items-center gap-1.5 pl-1 pr-1.5 py-1.5 rounded-full bg-[#141414]/95 backdrop-blur border border-white/15 shadow-2xl select-none"
        style={pos ? { left: pos.left, top: pos.top } : { right: 20, bottom: 20 }}
      >
        {/* drag grip */}
        <div
          className="p-1.5 cursor-move text-white/30 hover:text-white/70"
          style={{ touchAction: "none" }}
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          title="Drag me anywhere"
        >
          <GripVertical size={14} />
        </div>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${recDot ? "bg-red-500 animate-pulse" : paused ? "bg-amber-500" : "bg-red-500/20"}`}>
          {recDot || phase !== "recording"
            ? <span className={`w-3 h-3 rounded-full ${phase === "recording" ? "bg-white" : "bg-red-500"}`} />
            : <span className="w-3 h-3 rounded-sm bg-white" />}
        </div>
        <div className="px-1 min-w-[76px]">
          <div className="font-mono text-xs font-bold text-white tabular-nums leading-none">
            {phase === "recording" ? formatTime(elapsed) : phase === "preview" ? "Preview" : phase === "review" ? "Done" : "Setup"}
          </div>
          <div className="text-[9px] text-white/40 font-mono leading-tight mt-0.5">
            {phase === "recording" ? (paused ? "paused" : formatBytes(recordedSize)) : "recorder"}
          </div>
        </div>
        {phase === "recording" && (
          <>
            <button onClick={togglePause} title={paused ? "Resume" : "Pause"}
              className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center hover:bg-amber-500/35 transition-colors">
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button onClick={stopRecording} title="Stop & save"
              className="h-8 px-3 rounded-full bg-red-500 hover:bg-red-600 text-white text-[11px] font-bold flex items-center gap-1 transition-colors">
              <Square size={11} fill="currentColor" /> Stop
            </button>
          </>
        )}
        {phase === "preview" && (
          <button onClick={() => { setMinimized(false); setTimeout(startRecording, 50); }} title="Start recording"
            className="h-8 px-3 rounded-full bg-red-500 hover:bg-red-600 text-white text-[11px] font-bold flex items-center gap-1 transition-colors">
            <Circle size={11} fill="currentColor" /> Record
          </button>
        )}
        <button onClick={() => setMinimized(false)} title="Expand"
          className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
          <Maximize2 size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={handleBackdrop}>
      <div
        className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-[#141414] border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 sticky top-0 bg-[#141414] z-10">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${recDot ? "bg-red-500 animate-pulse" : "bg-red-500/15"}`}>
            <Circle size={16} className={recDot ? "text-white" : "text-red-400"} fill="currentColor" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white">Screen Recorder</h2>
            <p className="text-[11px] text-white/50 truncate">
              {phase === "pick" && "Choose a window or screen to record"}
              {phase === "preview" && "Preview — check the frame, then hit Record"}
              {phase === "recording" && `${paused ? "Paused" : "Recording"} · ${formatTime(elapsed)} · ${formatBytes(recordedSize)}`}
              {phase === "review" && "Stopped — preview & choose where to save"}
            </p>
          </div>
          {phase === "recording" && (
            <span className="font-mono text-sm font-bold text-red-400 tabular-nums">{formatTime(elapsed)}</span>
          )}
          {isElectron() && busy && (
            <button onClick={hideAppWindow} title="Minimize the app window so you can record anything"
              className="px-2.5 py-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors text-[11px] font-semibold hidden sm:block">
              Hide app
            </button>
          )}
          <button onClick={() => setMinimized(true)} title="Minimize (keeps recording)"
            className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors">
            <Minimize2 size={18} />
          </button>
          <button onClick={handleBackdrop} title={busy ? "Minimize (keeps recording)" : "Close"}
            className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {startError && (
            <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">{startError}</div>
          )}

          {/* STEP 1: source picker */}
          {phase === "pick" && (
            <>
              {isElectron() ? (
                loadingSources ? (
                  <div className="flex items-center justify-center py-10 text-white/50 text-sm gap-2">
                    <Loader2 size={18} className="animate-spin" /> Finding windows & screens…
                  </div>
                ) : sourcesError ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-red-300 mb-3">{sourcesError}</p>
                    <button onClick={() => window.location.reload()} className="text-xs px-3 py-2 rounded-lg bg-white/10 text-white hover:bg-white/15">Retry</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[320px] overflow-y-auto pr-1">
                    {sources.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSelectedId(s.id)}
                        className={`group text-left rounded-xl overflow-hidden border-2 transition-all ${selectedId === s.id ? "border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.35)]" : "border-white/10 hover:border-white/30"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.thumbnail} alt={s.name} className="w-full h-24 object-cover bg-black" draggable={false} />
                        <div className="px-2 py-1.5 bg-[#1d1d1d] flex items-center gap-1.5">
                          {selectedId === s.id && <Check size={12} className="text-red-400 shrink-0" />}
                          <span className="text-[10px] text-white/80 truncate" title={s.name}>{s.name}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )
              ) : (
                <div className="py-6 text-center text-sm text-white/60">
                  <Monitor size={28} className="mx-auto mb-2 text-white/40" />
                  <p>Your browser will show a picker when you press Continue.</p>
                </div>
              )}

              {/* options */}
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">
                  Quality
                  <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value as QualityKey)}
                    className="mt-1.5 w-full bg-[#1e1e1e] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white normal-case font-normal outline-none focus:border-red-500/60"
                  >
                    {(Object.keys(QUALITY) as QualityKey[]).map((k) => (
                      <option key={k} value={k}>{QUALITY[k].label}</option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end gap-2 pb-0.5">
                  <button
                    onClick={() => setWithSysAudio((v) => !v)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all ${withSysAudio ? "bg-red-500/15 border-red-500/50 text-red-300" : "bg-[#1e1e1e] border-white/10 text-white/50"}`}
                  >
                    <Volume2 size={15} /> System audio
                  </button>
                  <button
                    onClick={() => setWithMic((v) => !v)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all ${withMic ? "bg-red-500/15 border-red-500/50 text-red-300" : "bg-[#1e1e1e] border-white/10 text-white/50"}`}
                  >
                    <Mic size={15} /> Mic
                  </button>
                </div>
              </div>

              <button
                onClick={showPreview}
                disabled={starting || (isElectron() && !selectedId)}
                className="w-full py-3 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
              >
                {starting ? <Loader2 size={17} className="animate-spin" /> : <Play size={17} />}
                {starting ? "Opening preview…" : "Continue to preview"}
              </button>
            </>
          )}

          {/* STEP 2: live preview before recording */}
          {phase === "preview" && (
            <>
              <div className="rounded-xl overflow-hidden border border-white/10 bg-black">
                <video ref={previewRef} muted autoPlay playsInline className="w-full max-h-[360px] object-contain" />
              </div>
              <p className="text-[11px] text-white/50 text-center truncate">
                Previewing: <span className="text-white/80 font-semibold">{selected?.name ?? "selected screen"}</span> · {QUALITY[quality].label}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { stopTracks(); setPhase("pick"); }}
                  className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-semibold transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={refreshPreview}
                  className="px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-semibold transition-colors flex items-center gap-1.5"
                  title="Re-apply quality / audio settings"
                >
                  <RefreshCw size={15} />
                </button>
                <button
                  onClick={startRecording}
                  className="flex-[2] py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
                >
                  <Circle size={16} fill="currentColor" /> Record
                </button>
              </div>
              <p className="text-[11px] text-white/40 text-center">Recording auto-minimizes to a floating control so you can capture anything.</p>
            </>
          )}

          {/* STEP 3: recording */}
          {phase === "recording" && (
            <>
              <div className="relative rounded-xl overflow-hidden border border-red-500/40 bg-black">
                <video ref={liveRef} muted autoPlay playsInline className="w-full max-h-[360px] object-contain" />
                <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur text-xs font-bold text-white">
                  <span className={`w-2.5 h-2.5 rounded-full ${paused ? "bg-amber-400" : "bg-red-500 animate-pulse"}`} />
                  {paused ? "PAUSED" : "REC"} · <span className="font-mono tabular-nums">{formatTime(elapsed)}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={togglePause}
                  className="flex-1 py-3 rounded-xl bg-amber-500/15 border border-amber-500/40 hover:bg-amber-500/25 text-amber-300 text-sm font-bold transition-colors flex items-center justify-center gap-2"
                >
                  {paused ? <><Play size={17} /> Resume</> : <><Pause size={17} /> Pause</>}
                </button>
                <button
                  onClick={stopRecording}
                  className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
                >
                  <Square size={16} fill="currentColor" /> Stop
                </button>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setMinimized(true)}
                  className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2">
                  <Minimize2 size={14} /> Minimize & keep recording
                </button>
                {isElectron() && (
                  <button onClick={hideAppWindow}
                    className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors">
                    Hide app window
                  </button>
                )}
              </div>
              <p className="text-[11px] text-white/40 text-center">Chunks stream to memory in 1s slices — safe for long sessions.</p>
            </>
          )}

          {/* STEP 4: review + save */}
          {phase === "review" && (
            <>
              <div className="rounded-xl overflow-hidden border border-white/10 bg-black">
                {blobUrl && <video src={blobUrl} controls playsInline className="w-full max-h-[320px] object-contain" />}
              </div>
              <div className="flex items-center gap-3 text-xs text-white/60">
                <span className="px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold">
                  {formatTime(elapsed)}
                </span>
                <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 font-mono">{formatBytes(blobSize)}</span>
                <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 font-mono uppercase">.{mimeRef.current.ext}</span>
                <button onClick={discardAndBack} className="ml-auto text-white/40 hover:text-white/80 underline underline-offset-2">Discard & re-record</button>
              </div>

              {/* save location */}
              <div className="rounded-xl border border-white/10 bg-[#1a1a1a] p-4 space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-white/50">Save to folder</div>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[#111] border border-white/10 min-w-0">
                    <FolderOpen size={15} className="text-white/40 shrink-0" />
                    <span className="text-xs text-white/80 truncate font-mono" title={saveDir}>{saveDir || "—"}</span>
                  </div>
                  <button onClick={browseFolder} className="px-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0">
                    <FolderInput size={14} /> Browse
                  </button>
                </div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-white/50">
                  File name
                  <input
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    spellCheck={false}
                    className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-[#111] border border-white/10 text-xs text-white font-mono normal-case font-normal outline-none focus:border-red-500/60"
                  />
                </label>
                {saveError && <p className="text-xs text-red-300">{saveError}</p>}
                {savedPath && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
                    <Check size={14} className="shrink-0" />
                    <span className="truncate font-mono" title={savedPath}>Saved: {savedPath}</span>
                    {isElectron() && (
                      <button onClick={openSavedFolder} className="ml-auto underline underline-offset-2 shrink-0 hover:text-emerald-200">Show in folder</button>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  {isElectron() ? (
                    <>
                      <button
                        onClick={() => saveRecording(false)}
                        disabled={saving}
                        className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                      >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                        Quick save
                      </button>
                      <button
                        onClick={() => saveRecording(true)}
                        disabled={saving}
                        className="flex-[2] py-3 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
                      >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                        Save as…
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => saveRecording(false)}
                      disabled={saving}
                      className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white text-sm font-bold transition-colors"
                    >
                      Download recording
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-white/35">
                  Default: <span className="font-mono">Videos/deepseek-free-recording/&lt;random&gt;.mp4</span>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
