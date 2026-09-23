"use client";
import { Sun, Bell, User } from "lucide-react";

export default function Header() {
  return (
    <div className="absolute top-6 right-6 flex items-center gap-3 z-10">
      <button className="w-10 h-10 bg-white text-gray-600 rounded-full flex items-center justify-center shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors" title="Toggle Theme">
        <Sun size={18} />
      </button>
      <button className="w-10 h-10 bg-white text-gray-600 rounded-full flex items-center justify-center shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors relative" title="Notifications">
        <Bell size={18} />
        <span className="absolute top-2 right-2.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
      </button>
      <button className="h-10 pl-2 pr-4 bg-white text-gray-600 rounded-full flex items-center gap-2 shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors">
        <div className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center">
          <User size={14} />
        </div>
        <span className="text-sm font-medium">Guest User</span>
      </button>
    </div>
  );
}
