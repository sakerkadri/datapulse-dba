/**
 * Host Infrastructure & Correlation Types for DataPulse Sentinel
 */

export type OSType = "LINUX" | "WINDOWS" | "linux" | "windows";

export type HostStatus = "ONLINE" | "DEGRADED" | "CRITICAL" | "UNREACHABLE" | "MAINTENANCE";

export interface HostDiskMount {
  filesystem: string;
  totalGb: number;
  usedGb: number;
  availableGb: number;
  usedPercent: number;
  mountPoint: string;
  // Aliases for compatibility
  mount?: string;
  totalBytes?: number;
  usedBytes?: number;
  freeBytes?: number;
}

export interface HostCPUMetrics {
  usagePercent: number;
  cores?: number;
  loadAvg?: [number, number, number] | { load1m: number; load5m: number; load15m: number };
  userPercent?: number;
  systemPercent?: number;
  iowaitPercent?: number;
  stealPercent?: number;
}

export interface HostMemoryMetrics {
  totalGb: number;
  usedGb: number;
  availableGb: number;
  usedPercent: number;
  swapTotalGb: number;
  swapUsedGb: number;
  swapUsedPercent: number;
  totalBytes?: number;
  usedBytes?: number;
  freeBytes?: number;
  availableBytes?: number;
}

export interface HostIOMetrics {
  readIops?: number;
  writeIops?: number;
  totalIops: number;
  utilPercent?: number;
  readBytesPerSec?: number;
  writeBytesPerSec?: number;
  queueLength?: number;
}

export interface HostLoadMetrics {
  load1m: number;
  load5m: number;
  load15m: number;
  runnableProcesses?: number;
  totalProcesses?: number;
}

export interface HostNetworkMetrics {
  rxBytesPerSec?: number;
  txBytesPerSec?: number;
  rxErrors?: number;
  txErrors?: number;
}

export interface HostMetricsSnapshot {
  hostId: string;
  hostname?: string;
  timestamp: string;
  osType: OSType;
  cpu: HostCPUMetrics;
  memory: HostMemoryMetrics;
  disks: HostDiskMount[];
  disk?: HostDiskMount[]; // Alias
  io?: HostIOMetrics;
  loadAverage?: HostLoadMetrics;
  uptimeSeconds: number;
  iopsTotal?: number;
}

// Flat metric representation for parsers & ring buffers
export interface ParsedHostMetrics {
  hostId: string;
  hostname?: string;
  timestamp: string;
  osType: "LINUX" | "WINDOWS";
  cpuUsagePct: number;
  cpuBreakdown: {
    userPct: number;
    systemPct: number;
    iowaitPct: number;
    stealPct: number;
  };
  memory: {
    totalGb: number;
    usedGb: number;
    availableGb: number;
    usedPercent: number;
    swapTotalGb: number;
    swapUsedGb: number;
    swapUsedPercent: number;
  };
  disks: HostDiskMount[];
  loadAverage: {
    load1m: number;
    load5m: number;
    load15m: number;
  };
  uptimeSeconds: number;
  iopsTotal: number;
}

export interface HostTarget {
  id: string;
  hostId: string;
  hostname: string;
  ip: string;
  port?: number;
  osType: "LINUX" | "WINDOWS";
  status: HostStatus;
  zone: string;
  authType: "PASSWORD" | "KEY" | "AGENT" | "NTLM" | "KERBEROS" | "MOCK";
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  isMock?: boolean;
  mockScenario?: string;
  lastMetrics?: HostMetricsSnapshot | ParsedHostMetrics;
  lastSeen?: string;
  associatedDbIds?: string[];
}

export type HostNode = HostTarget;

export interface LinuxRawSnapshot {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
  totalActive: number;
  totalTime: number;
}

export interface WindowsWqlResult {
  cpu?: {
    PercentProcessorTime?: number;
    PercentUserTime?: number;
    PercentPrivilegedTime?: number;
    LoadPercentage?: number;
    NumberOfCores?: number;
  };
  cpuFallback?: Array<{
    LoadPercentage?: number;
    NumberOfCores?: number;
    NumberOfLogicalProcessors?: number;
  }> | {
    LoadPercentage?: number;
    NumberOfCores?: number;
    NumberOfLogicalProcessors?: number;
  };
  os?: {
    TotalVisibleMemorySize?: number; // KB
    FreePhysicalMemory?: number;      // KB
    TotalVirtualMemorySize?: number;  // KB
    FreeVirtualMemory?: number;       // KB
    NumberOfProcesses?: number;
    LastBootUpTime?: string;          // CIM datetime string
    Caption?: string;
    Version?: string;
  };
  disks?: Array<{
    DeviceID: string;
    VolumeName?: string;
    Size?: number;                    // Bytes
    FreeSpace?: number;               // Bytes
    FileSystem?: string;
    DriveType?: number;               // 3 = Fixed local disk
  }>;
  diskPerf?: {
    DiskTransfersPerSec?: number;
    DiskReadsPerSec?: number;
    DiskWritesPerSec?: number;
    PercentDiskTime?: number;
    CurrentDiskQueueLength?: number;
  };
}

export interface CorrelationEvidence {
  hostMetric: {
    name: string;
    value: number | string;
    unit: string;
    threshold?: number;
  };
  dbMetric: {
    name: string;
    value: number | string;
    unit: string;
    threshold?: number;
  };
  details?: Record<string, any>;
}

export type CorrelationRuleId =
  | "NOISY_NEIGHBOR_CPU"
  | "DB_QUERY_STORM"
  | "STORAGE_IOPS_BOTTLENECK"
  | "OS_MEMORY_SWAPPING"
  | "DISK_SPACE_EXHAUSTION";

export interface CorrelationAlert {
  id?: string;
  ruleId: CorrelationRuleId;
  severity: "critical" | "warning" | "info" | "CRITICAL" | "WARNING" | "INFO";
  rootCause: string;
  confidence: number; // 0 - 100%
  dbInstanceId: string;
  hostId: string;
  description: string;
  remediation: string;
  recommendation?: string;
  evidence?: CorrelationEvidence;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface HostConnectionTestResult {
  success: boolean;
  latencyMs: number;
  osType: OSType;
  osVersion?: string;
  hostname?: string;
  message: string;
  error?: string;
}
