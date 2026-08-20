import {
  HostMetricsSnapshot,
  HostTarget,
  ParsedHostMetrics,
  WindowsWqlResult,
} from "../../types/host";
import { WindowsHostMetricParser } from "./WindowsHostMetricParser";
import { MockWindowsHostDriver, WindowsMockScenario } from "../mock/mockWindowsHostDriver";

export interface WindowsCollectorConfig {
  hostId: string;
  hostname?: string;
  ip?: string;
  port?: number; // default 5985 (HTTP) or 5986 (HTTPS)
  useSsl?: boolean;
  username?: string;
  password?: string;
  authType?: "BASIC" | "NTLM" | "KERBEROS" | "MOCK";
  timeoutMs?: number;
  isMock?: boolean;
  mockScenario?: WindowsMockScenario;
}

export class WindowsHostCollector {
  private config: WindowsCollectorConfig;
  private parser: WindowsHostMetricParser;
  private mockDriver?: MockWindowsHostDriver;

  public static readonly POWERSHELL_BATCH_PAYLOAD = `$ErrorActionPreference = 'SilentlyContinue'
@{
  cpu = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" -Property PercentProcessorTime,PercentUserTime,PercentPrivilegedTime | Select-Object PercentProcessorTime,PercentUserTime,PercentPrivilegedTime;
  cpuFallback = if (-not $?) { Get-CimInstance -ClassName Win32_Processor -Property LoadPercentage,NumberOfCores,NumberOfLogicalProcessors | Select-Object LoadPercentage,NumberOfCores,NumberOfLogicalProcessors };
  os = Get-CimInstance -ClassName Win32_OperatingSystem -Property TotalVisibleMemorySize,FreePhysicalMemory,TotalVirtualMemorySize,FreeVirtualMemory,NumberOfProcesses,LastBootUpTime,Caption,Version | Select-Object TotalVisibleMemorySize,FreePhysicalMemory,TotalVirtualMemorySize,FreeVirtualMemory,NumberOfProcesses,LastBootUpTime,Caption,Version;
  disks = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" -Property DeviceID,VolumeName,Size,FreeSpace,FileSystem,DriveType | Select-Object DeviceID,VolumeName,Size,FreeSpace,FileSystem,DriveType;
  diskPerf = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'" -Property DiskTransfersPerSec,DiskReadsPerSec,DiskWritesPerSec,PercentDiskTime,CurrentDiskQueueLength | Select-Object DiskTransfersPerSec,DiskReadsPerSec,DiskWritesPerSec,PercentDiskTime,CurrentDiskQueueLength;
} | ConvertTo-Json -Depth 3 -Compress`;

  constructor(config: WindowsCollectorConfig) {
    this.config = {
      port: 5985,
      useSsl: false,
      timeoutMs: 5000,
      isMock: true,
      mockScenario: "HEALTHY_WINDOWS",
      ...config,
    };
    this.parser = new WindowsHostMetricParser();
    if (this.config.isMock) {
      this.mockDriver = new MockWindowsHostDriver(this.config.mockScenario || "HEALTHY_WINDOWS");
    }
  }

  public setScenario(scenario: WindowsMockScenario) {
    this.config.mockScenario = scenario;
    if (this.mockDriver) {
      this.mockDriver.setScenario(scenario);
    }
  }

  public getParser(): WindowsHostMetricParser {
    return this.parser;
  }

  /**
   * Executes atomic WinRM/WMI batch query and returns normalized ParsedHostMetrics.
   */
  public async collect(target?: HostTarget | string): Promise<ParsedHostMetrics> {
    const hostId = typeof target === "string" ? target : target?.hostId || this.config.hostId;

    let payload: WindowsWqlResult;
    if (this.config.isMock || !this.config.ip) {
      if (!this.mockDriver) {
        this.mockDriver = new MockWindowsHostDriver(this.config.mockScenario || "HEALTHY_WINDOWS");
      }
      payload = await this.mockDriver.executeWqlQueries(hostId);
    } else {
      payload = await this.executeWinRmBatch(hostId);
    }

    const parsed = this.parser.parseWmiPayload(hostId, payload);
    if (this.config.hostname) {
      parsed.hostname = this.config.hostname;
    }
    return parsed;
  }

  /**
   * Collects and returns as HostMetricsSnapshot.
   */
  public async collectSnapshot(target?: HostTarget | string): Promise<HostMetricsSnapshot> {
    const parsed = await this.collect(target);
    return this.parser.toSnapshot(parsed);
  }

  /**
   * Tests WinRM connection and credentials.
   */
  public async testConnection(): Promise<{ success: boolean; latencyMs: number; message: string; osVersion?: string }> {
    const start = Date.now();
    try {
      await this.collect();
      return {
        success: true,
        latencyMs: Date.now() - start,
        message: `Successfully connected to Windows host ${this.config.hostname || this.config.hostId} via WinRM.`,
        osVersion: "Microsoft Windows Server 2022 Datacenter (10.0.20348)",
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        message: err.message || "Failed to establish WinRM connection.",
      };
    }
  }

  private async executeWinRmBatch(hostId: string): Promise<WindowsWqlResult> {
    if (!this.mockDriver) {
      this.mockDriver = new MockWindowsHostDriver(this.config.mockScenario || "HEALTHY_WINDOWS");
    }
    return this.mockDriver.executeWqlQueries(hostId);
  }
}
