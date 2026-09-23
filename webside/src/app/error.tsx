"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 select-none">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-destructive/20 blur-[60px] rounded-full" />
        <div className="relative p-6 bg-panel border border-destructive/20 rounded-3xl shadow-float">
          <AlertTriangle size={64} className="text-destructive animate-pulse" />
        </div>
      </div>
      
      <h1 className="text-4xl font-bold tracking-tight text-foreground mb-4 text-center">Something went wrong</h1>
      <div className="bg-panel border border-border p-4 rounded-xl max-w-lg mb-8 overflow-hidden">
        <p className="text-sm font-mono text-muted break-all text-center">
          {error.message || "An unexpected error occurred in the application layer."}
        </p>
      </div>
      
      <button
        onClick={() => reset()}
        className="flex items-center gap-2 px-6 py-3 bg-foreground text-background font-semibold rounded-2xl hover:opacity-90 transition-opacity cursor-pointer"
      >
        <RotateCcw size={18} />
        Try Again
      </button>
    </div>
  );
}
