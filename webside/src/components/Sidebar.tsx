"use client";
import { useEffect, useState } from "react";
import { MessageSquareText, Plus, Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";

export default function Sidebar({ onSelectChat, currentChatId, onNewChat, onOpenSettings }: any) {
  const [chats, setChats] = useState<any[]>([]);

  useEffect(() => {
    const apiKey = localStorage.getItem("apiKey") || "";
    fetch("http://localhost:8000/api/chat", {
      headers: { "Authorization": `Bearer ${apiKey}` }
    })
      .then(res => res.json())
      .then(data => setChats(data.reverse().slice(0, 20)));
  }, [currentChatId]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const apiKey = localStorage.getItem("apiKey") || "";
      await fetch(`http://localhost:8000/api/chat/${id}`, {
        method: 'DELETE',
        headers: { "Authorization": `Bearer ${apiKey}` }
      });
      setChats(prev => prev.filter(c => c.id !== id));
      if (currentChatId === id) {
        onNewChat();
      }
    } catch (err) {
      console.error("Failed to delete chat", err);
    }
  };

  const texts = t();

  return (
    <div className="w-64 bg-panel m-4 rounded-[1.5rem] shadow-soft flex flex-col p-6 z-10 shrink-0">
      <div className="flex items-center gap-3 mb-10">
        <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center shrink-0">
          <div className="w-3 h-3 bg-accent-foreground rounded-full"></div>
        </div>
        <h1 className="text-xl font-bold tracking-tight truncate text-foreground">DeepSeek Free</h1>
      </div>

      <button onClick={onNewChat} className="flex items-center justify-center gap-2 px-4 py-3 bg-accent text-accent-foreground rounded-xl font-medium mb-6 hover:opacity-90 transition shadow-sm">
        <Plus size={20} />
        {texts.sidebar.newChat}
      </button>

      <div className="text-xs font-semibold text-muted mb-3 uppercase tracking-wider px-2">{texts.sidebar.recent}</div>

      <nav className="flex-1 overflow-y-auto flex flex-col gap-1 -mx-2 px-2">
        {chats.map((chat) => (
          <div
            key={chat.id}
            onClick={() => onSelectChat(chat.id)}
            className={`group flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors cursor-pointer w-full ${currentChatId === chat.id ? 'bg-input-bg text-foreground font-medium' : 'text-muted hover:bg-input-bg/50'}`}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <MessageSquareText size={18} className={`shrink-0 ${currentChatId === chat.id ? "stroke-2" : "stroke-1"}`} />
              <span className="truncate text-sm">{chat.title || "New Conversation"}</span>
            </div>
            <button
              onClick={(e) => handleDelete(e, chat.id)}
              className="opacity-0 group-hover:opacity-100 p-1.5 text-muted hover:text-destructive hover:bg-panel rounded-lg transition-all"
              title={texts.chat.deleteChat}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </nav>
    </div>
  );
}
