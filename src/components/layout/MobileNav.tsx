import React from "react";
import {
  LayoutDashboard,
  Database,
  Bell,
  Terminal,
  Users,
  Mail,
  FileText,
} from "lucide-react";
import { useDBA } from "../../context/DBAContext";

interface MobileNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({ activeTab, setActiveTab }) => {
  const { incidents } = useDBA();
  const firingCount = incidents.filter((i) => i.status === "FIRING").length;

  const items = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "databases", label: "DB Fleet", icon: Database },
    {
      id: "alerts",
      label: "Alerts",
      icon: Bell,
      badge: firingCount > 0 ? firingCount : undefined,
    },
    { id: "logs", label: "Logs", icon: Terminal },
    { id: "rbac", label: "Team", icon: Users },
    { id: "reports", label: "Reports", icon: FileText },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 px-2 py-2 backdrop-blur-md dark:border-[#272a30] dark:bg-[#15181e]/95 lg:hidden">
      <div className="flex items-center justify-around">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`relative flex flex-col items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition cursor-pointer ${
                isActive
                  ? "text-indigo-600 dark:text-indigo-400 font-bold"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? "text-indigo-500" : "text-slate-400"}`} />
              <span>{item.label}</span>

              {item.badge !== undefined && (
                <span className="absolute -top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
