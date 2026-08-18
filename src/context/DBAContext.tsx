import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import {
  DBInstance,
  MetricPoint,
  ThresholdRule,
  IncidentAlert,
  ConnectionLog,
  User,
  NotificationChannel,
  EmailTemplate,
  DashboardPreset,
} from "../types/dba";
import {
  INITIAL_DATABASES,
  INITIAL_METRIC_HISTORY,
  INITIAL_THRESHOLDS,
  INITIAL_INCIDENTS,
  INITIAL_CONNECTION_LOGS,
  INITIAL_USERS,
  INITIAL_CHANNELS,
  INITIAL_EMAIL_TEMPLATES,
  INITIAL_DASHBOARD_PRESETS,
} from "../mock/dbaData";

interface AIModalContextData {
  type: "slow_query" | "incident";
  query?: string;
  metrics?: any;
  databaseType?: string;
  incidentContext?: string;
}

interface DBAContextType {
  databases: DBInstance[];
  selectedDbId: string;
  setSelectedDbId: (id: string) => void;
  metricsHistory: MetricPoint[];
  thresholds: ThresholdRule[];
  incidents: IncidentAlert[];
  logs: ConnectionLog[];
  users: User[];
  currentUser: User;
  setCurrentUserRole: (roleId: string) => void;
  channels: NotificationChannel[];
  emailTemplates: EmailTemplate[];
  activePreset: DashboardPreset;
  setActivePreset: (preset: DashboardPreset) => void;
  presetList: DashboardPreset[];
  theme: "dark" | "light";
  toggleTheme: () => void;
  timeRange: string;
  setTimeRange: (range: string) => void;
  refreshRate: number; // in seconds, 0 = paused
  setRefreshRate: (rate: number) => void;
  isStreaming: boolean;
  setIsStreaming: (streaming: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  aiModalOpen: boolean;
  setAiModalOpen: (open: boolean) => void;
  aiModalContext: AIModalContextData | null;
  openAiDiagnosis: (ctx: AIModalContextData) => void;
  // Actions
  addDatabase: (db: Omit<DBInstance, "id" | "uptimeSeconds" | "lastHealthCheck">) => void;
  updateDatabase: (id: string, updates: Partial<DBInstance>) => void;
  removeDatabase: (id: string) => void;
  testDbConnection: (id: string) => Promise<{ success: boolean; latencyMs: number; message: string }>;
  addThreshold: (rule: Omit<ThresholdRule, "id">) => void;
  updateThreshold: (id: string, updates: Partial<ThresholdRule>) => void;
  deleteThreshold: (id: string) => void;
  acknowledgeIncident: (id: string, notes?: string) => void;
  resolveIncident: (id: string) => void;
  triggerRemediation: (incidentId: string) => void;
  addLog: (log: Omit<ConnectionLog, "id" | "timestamp">) => void;
  clearLogs: () => void;
  updateUserRole: (userId: string, role: User["role"]) => void;
  addUser: (user: Omit<User, "id" | "lastLogin">) => void;
  sendTestEmail: (recipient: string, templateId: string, incidentId?: string) => Promise<any>;
}

const DBAContext = createContext<DBAContextType | undefined>(undefined);

export const DBAProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [databases, setDatabases] = useState<DBInstance[]>(INITIAL_DATABASES);
  const [selectedDbId, setSelectedDbId] = useState<string>("ALL");
  const [metricsHistory, setMetricsHistory] = useState<MetricPoint[]>(INITIAL_METRIC_HISTORY);
  const [thresholds, setThresholds] = useState<ThresholdRule[]>(INITIAL_THRESHOLDS);
  const [incidents, setIncidents] = useState<IncidentAlert[]>(INITIAL_INCIDENTS);
  const [logs, setLogs] = useState<ConnectionLog[]>(INITIAL_CONNECTION_LOGS);
  const [users, setUsers] = useState<User[]>(INITIAL_USERS);
  const [currentUser, setCurrentUser] = useState<User>(INITIAL_USERS[0]);
  const [channels] = useState<NotificationChannel[]>(INITIAL_CHANNELS);
  const [emailTemplates] = useState<EmailTemplate[]>(INITIAL_EMAIL_TEMPLATES);
  const [presetList] = useState<DashboardPreset[]>(INITIAL_DASHBOARD_PRESETS);
  const [activePreset, setActivePreset] = useState<DashboardPreset>(INITIAL_DASHBOARD_PRESETS[0]);
  
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [timeRange, setTimeRange] = useState<string>("15m");
  const [refreshRate, setRefreshRate] = useState<number>(3); // 3 seconds live refresh
  const [isStreaming, setIsStreaming] = useState<boolean>(true);

  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [aiModalOpen, setAiModalOpen] = useState<boolean>(false);
  const [aiModalContext, setAiModalContext] = useState<AIModalContextData | null>(null);

  // Sync dark class with document element
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const openAiDiagnosis = (ctx: AIModalContextData) => {
    setAiModalContext(ctx);
    setAiModalOpen(true);
  };

  // Real-time metrics tick simulation
  useEffect(() => {
    if (!isStreaming || refreshRate === 0) return;

    const interval = setInterval(() => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      const timestamp = `${hh}:${mm}:${ss}`;

      // 1. Update Database metrics slightly
      setDatabases((prevDbs) =>
        prevDbs.map((db) => {
          const cpuDelta = (Math.random() - 0.48) * 4;
          const newCpu = Math.min(99, Math.max(10, db.cpuUsage + cpuDelta));
          const connDelta = Math.floor((Math.random() - 0.5) * 6);
          const newConn = Math.min(db.maxConnections, Math.max(10, db.activeConnections + connDelta));
          const latencyDelta = (Math.random() - 0.49) * 5;
          const newLatency = Math.max(1.5, db.queryLatencyMs + latencyDelta);

          return {
            ...db,
            cpuUsage: Number(newCpu.toFixed(1)),
            activeConnections: newConn,
            queryLatencyMs: Number(newLatency.toFixed(1)),
            lastHealthCheck: "Just now",
          };
        })
      );

      // 2. Append new MetricPoint to metricsHistory
      setMetricsHistory((prev) => {
        const last = prev[prev.length - 1] || { cpu: 45, memory: 65, iops: 1200, activeConn: 180, latencyMs: 15, slowQueries: 2, replicationLag: 0.1 };
        const newCpu = Math.min(99, Math.max(15, last.cpu + (Math.random() - 0.48) * 6));
        const newMem = Math.min(98, Math.max(30, last.memory + (Math.random() - 0.5) * 2));
        const newIops = Math.floor(Math.max(400, last.iops + (Math.random() - 0.5) * 200));
        const newConn = Math.floor(Math.max(50, last.activeConn + (Math.random() - 0.5) * 10));
        const newLatency = Number(Math.max(2, last.latencyMs + (Math.random() - 0.49) * 8).toFixed(1));

        const newPoint: MetricPoint = {
          timestamp,
          cpu: Number(newCpu.toFixed(1)),
          memory: Number(newMem.toFixed(1)),
          iops: newIops,
          activeConn: newConn,
          latencyMs: newLatency,
          slowQueries: Math.floor(Math.random() * 3),
          replicationLag: Number((Math.random() * 1.2).toFixed(1)),
        };

        return [...prev.slice(1), newPoint];
      });

      // 3. Random chance of generating a real-time connection log
      if (Math.random() > 0.6) {
        const sampleIps = ["10.240.12.84", "192.168.4.112", "172.16.88.19", "10.128.0.45", "10.240.15.201"];
        const sampleUsers = ["app_orders_rw", "bi_etl_worker", "reporting_svc", "auth_service", "sa_admin"];
        const eventTypes: ConnectionLog["eventType"][] = [
          "AUTH_SUCCESS",
          "AUTH_SUCCESS",
          "AUTH_SUCCESS",
          "AUTH_FAILURE",
          "QUERY_TIMEOUT",
        ];
        const selectedEngine: ConnectionLog["engine"] = Math.random() > 0.5 ? "PostgreSQL" : Math.random() > 0.5 ? "SQL Server" : "MySQL";
        const randomEvt = eventTypes[Math.floor(Math.random() * eventTypes.length)];
        const isError = randomEvt === "AUTH_FAILURE" || randomEvt === "SSL_HANDSHAKE_ERROR" || randomEvt === "CONNECTION_EXHAUSTED";
        const isWarn = randomEvt === "QUERY_TIMEOUT" || randomEvt === "MAX_IDLE_TIMEOUT";

        const newLog: ConnectionLog = {
          id: `log-${Date.now().toString().slice(-5)}`,
          timestamp,
          databaseId: "db-pg-01",
          databaseName: selectedEngine === "PostgreSQL" ? "pg-prod-primary-eu" : selectedEngine === "SQL Server" ? "sql-fin-analytics-us" : "mysql-userauth-asia",
          engine: selectedEngine,
          clientIp: sampleIps[Math.floor(Math.random() * sampleIps.length)],
          username: sampleUsers[Math.floor(Math.random() * sampleUsers.length)],
          eventType: randomEvt,
          severity: isError ? "ERROR" : isWarn ? "WARN" : "INFO",
          latencyMs: Number((1.5 + Math.random() * 25).toFixed(1)),
          details: isError ? "Authentication challenge or execution delay detected" : "Client session acquired over TLSv1.3",
        };

        setLogs((prevLogs) => [newLog, ...prevLogs.slice(0, 49)]);
      }
    }, refreshRate * 1000);

    return () => clearInterval(interval);
  }, [isStreaming, refreshRate]);

  // Context Action Handlers
  const setCurrentUserRole = (userId: string) => {
    const found = users.find((u) => u.id === userId);
    if (found) setCurrentUser(found);
  };

  const addDatabase = (dbData: Omit<DBInstance, "id" | "uptimeSeconds" | "lastHealthCheck">) => {
    const newDb: DBInstance = {
      ...dbData,
      id: `db-custom-${Date.now().toString().slice(-4)}`,
      uptimeSeconds: 3600,
      lastHealthCheck: "Just now",
    };
    setDatabases((prev) => [...prev, newDb]);
  };

  const updateDatabase = (id: string, updates: Partial<DBInstance>) => {
    setDatabases((prev) => prev.map((db) => (db.id === id ? { ...db, ...updates } : db)));
  };

  const removeDatabase = (id: string) => {
    setDatabases((prev) => prev.filter((db) => db.id !== id));
  };

  const testDbConnection = async (id: string) => {
    const target = databases.find((d) => d.id === id);
    await new Promise((res) => setTimeout(res, 800)); // Simulate network check
    if (!target) return { success: false, latencyMs: 0, message: "Database not found" };

    const simulatedLatency = Math.floor(10 + Math.random() * 35);
    return {
      success: true,
      latencyMs: simulatedLatency,
      message: `Connection successful! Ping to ${target.host}:${target.port} responded in ${simulatedLatency}ms. SSL handshake verified.`,
    };
  };

  const addThreshold = (ruleData: Omit<ThresholdRule, "id">) => {
    const newRule: ThresholdRule = {
      ...ruleData,
      id: `thresh-${Date.now().toString().slice(-4)}`,
    };
    setThresholds((prev) => [...prev, newRule]);
  };

  const updateThreshold = (id: string, updates: Partial<ThresholdRule>) => {
    setThresholds((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const deleteThreshold = (id: string) => {
    setThresholds((prev) => prev.filter((t) => t.id !== id));
  };

  const acknowledgeIncident = (id: string, notes?: string) => {
    setIncidents((prev) =>
      prev.map((inc) =>
        inc.id === id
          ? {
              ...inc,
              status: "ACKNOWLEDGED",
              acknowledgedBy: currentUser.name,
              acknowledgedAt: new Date().toISOString(),
              notes: notes || inc.notes,
            }
          : inc
      )
    );
  };

  const resolveIncident = (id: string) => {
    setIncidents((prev) =>
      prev.map((inc) =>
        inc.id === id
          ? {
              ...inc,
              status: "RESOLVED",
              resolvedAt: new Date().toISOString(),
            }
          : inc
      )
    );
  };

  const triggerRemediation = (incidentId: string) => {
    const inc = incidents.find((i) => i.id === incidentId);
    if (!inc) return;

    // Simulate remediation execution
    resolveIncident(incidentId);

    // Add log
    addLog({
      databaseId: inc.databaseId,
      databaseName: inc.databaseName,
      engine: inc.engine,
      clientIp: "127.0.0.1",
      username: currentUser.email,
      eventType: "AUTH_SUCCESS",
      severity: "INFO",
      latencyMs: 12.0,
      details: `Remediation script executed by DBA ${currentUser.name} for incident ${inc.id}`,
    });
  };

  const addLog = (logData: Omit<ConnectionLog, "id" | "timestamp">) => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");

    const newLog: ConnectionLog = {
      ...logData,
      id: `log-${Date.now().toString().slice(-5)}`,
      timestamp: `${hh}:${mm}:${ss}`,
    };
    setLogs((prev) => [newLog, ...prev]);
  };

  const clearLogs = () => setLogs([]);

  const updateUserRole = (userId: string, role: User["role"]) => {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
    if (currentUser.id === userId) {
      setCurrentUser((prev) => ({ ...prev, role }));
    }
  };

  const addUser = (userData: Omit<User, "id" | "lastLogin">) => {
    const newUser: User = {
      ...userData,
      id: `usr-${Date.now().toString().slice(-4)}`,
      lastLogin: "Never",
    };
    setUsers((prev) => [...prev, newUser]);
  };

  const sendTestEmail = async (recipient: string, templateId: string, incidentId?: string) => {
    const targetInc = incidents.find((i) => i.id === incidentId) || incidents[0];
    const payload = {
      recipient,
      subject: `🚨 CRITICAL INCIDENT ALERT: ${targetInc ? targetInc.databaseName : "Database Cluster"}`,
      incident: targetInc,
    };

    const res = await fetch("/api/notifications/test-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    return await res.json();
  };

  return (
    <DBAContext.Provider
      value={{
        databases,
        selectedDbId,
        setSelectedDbId,
        metricsHistory,
        thresholds,
        incidents,
        logs,
        users,
        currentUser,
        setCurrentUserRole,
        channels,
        emailTemplates,
        activePreset,
        setActivePreset,
        presetList,
        theme,
        toggleTheme,
        timeRange,
        setTimeRange,
        refreshRate,
        setRefreshRate,
        isStreaming,
        setIsStreaming,
        searchOpen,
        setSearchOpen,
        aiModalOpen,
        setAiModalOpen,
        aiModalContext,
        openAiDiagnosis,
        addDatabase,
        updateDatabase,
        removeDatabase,
        testDbConnection,
        addThreshold,
        updateThreshold,
        deleteThreshold,
        acknowledgeIncident,
        resolveIncident,
        triggerRemediation,
        addLog,
        clearLogs,
        updateUserRole,
        addUser,
        sendTestEmail,
      }}
    >
      {children}
    </DBAContext.Provider>
  );
};

export const useDBA = () => {
  const context = useContext(DBAContext);
  if (!context) {
    throw new Error("useDBA must be used within a DBAProvider");
  }
  return context;
};
