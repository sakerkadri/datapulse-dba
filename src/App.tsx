import React from "react";
import { DBAProvider, useDBA } from "./context/DBAContext";
import { Navbar } from "./components/layout/Navbar";
import { Sidebar } from "./components/layout/Sidebar";
import { MobileNav } from "./components/layout/MobileNav";
import { CustomizableDashboard } from "./components/dashboard/CustomizableDashboard";
import { DatabaseManager } from "./components/databases/DatabaseManager";
import { ThresholdAlertsManager } from "./components/alerts/ThresholdAlertsManager";
import { ConnectionLogsViewer } from "./components/logs/ConnectionLogsViewer";
import { TeamRBACManager } from "./components/rbac/TeamRBACManager";
import { EmailNotificationManager } from "./components/notifications/EmailNotificationManager";
import { PDFReportGenerator } from "./components/reports/PDFReportGenerator";
import { AIDiagnosticModal } from "./components/ai/AIDiagnosticModal";
import { GlobalSearchPalette } from "./components/search/GlobalSearchPalette";

const MainContent: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<string>("dashboard");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors duration-200 dark:bg-[#0f1115] dark:text-slate-300 font-sans">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="flex">
        {/* Desktop Sidebar */}
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

        {/* Main View Area */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-20 lg:pb-8">
          {activeTab === "dashboard" && <CustomizableDashboard />}
          {activeTab === "databases" && <DatabaseManager />}
          {activeTab === "alerts" && <ThresholdAlertsManager />}
          {activeTab === "logs" && <ConnectionLogsViewer />}
          {activeTab === "rbac" && <TeamRBACManager />}
          {activeTab === "notifications" && <EmailNotificationManager />}
          {activeTab === "reports" && <PDFReportGenerator />}
        </main>
      </div>

      {/* Mobile Navigation Bar */}
      <MobileNav activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Global AI Diagnostic Modal */}
      <AIDiagnosticModal />

      {/* Cmd+K Search Palette */}
      <GlobalSearchPalette />
    </div>
  );
};

export default function App() {
  return (
    <DBAProvider>
      <MainContent />
    </DBAProvider>
  );
}
