import Link from "next/link";
import { ArrowLeft, Ghost } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 select-none">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-accent/20 blur-[60px] rounded-full" />
        <div className="relative p-6 bg-panel border border-border rounded-3xl shadow-float">
          <Ghost size={64} className="text-accent animate-bounce" />
        </div>
      </div>
      
      <h1 className="text-6xl font-bold tracking-tighter text-foreground mb-4">404</h1>
      <h2 className="text-2xl font-medium text-foreground mb-4">Page not found</h2>
      <p className="text-muted text-center max-w-md mb-8">
        The page you are looking for doesn't exist or has been moved to another dimension.
      </p>
      
      <Link 
        href="/"
        className="flex items-center gap-2 px-6 py-3 bg-foreground text-background font-semibold rounded-2xl hover:opacity-90 transition-opacity cursor-pointer"
      >
        <ArrowLeft size={18} />
        Back to Chat
      </Link>
    </div>
  );
}
