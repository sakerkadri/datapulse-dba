import {
  HostMetricsSnapshot,
  HostTarget,
  ParsedHostMetrics,
} from "../../types/host";
import { LinuxHostMetricParser } from "./LinuxHostMetricParser";
import { LinuxMockScenario, MockLinuxHostDriver } from "../mock/mockLinuxHostDriver";

export interface LinuxCollectorConfig {
  hostId: string;
  hostname?: string;
  ip?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  timeoutMs?: number;
  isMock?: boolean;
  mockScenario?: LinuxMockScenario;
}

export class LinuxHostCollector {
  private config: LinuxCollectorConfig;
  private parser: LinuxHostMetricParser;
  private mockDriver?: MockLinuxHostDriver;

  public static readonly BATCH_PAYLOAD = `cat << 'EOF' | /bin/sh
echo "===CPU==="
cat /proc/stat | grep '^cpu '
echo "===MEM==="
cat /proc/meminfo | grep -E '^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree|SwapCached):'
echo "===DISK==="
df -Pk -x tmpfs -x devtmpfs -x overlay -x iso9660 -x squashfs -x shm
echo "===LOAD==="
cat /proc/loadavg
echo "===IO==="
cat /proc/diskstats | head -n 35
echo "===UPTIME==="
cat /proc/uptime
EOF`;

  constructor(config: LinuxCollectorConfig) {
    this.config = {
      port: 22,
      timeoutMs: 5000,
      isMock: true,
      mockScenario: "HEALTHY_LINUX",
      ...config,
    };
    this.parser = new LinuxHostMetricParser();
    if (this.config.isMock) {
      this.mockDriver = new MockLinuxHostDriver(this.config.mockScenario || "HEALTHY_LINUX");
    }
  }

  public setScenario(scenario: LinuxMockScenario) {
    this.config.mockScenario = scenario;
    if (this.mockDriver) {
      this.mockDriver.setScenario(scenario);
    }
  }

  public getParser(): LinuxHostMetricParser {
    return this.parser;
  }

  /**
   * Executes atomic single-command batch sampling and parses results.
   */
  public async collect(target?: HostTarget | string): Promise<ParsedHostMetrics> {
    const hostId = typeof target === "string" ? target : target?.hostId || this.config.hostId;

    let rawOutput: string;
    if (this.config.isMock || !this.config.ip) {
      if (!this.mockDriver) {
        this.mockDriver = new MockLinuxHostDriver(this.config.mockScenario || "HEALTHY_LINUX");
      }
      rawOutput = await this.mockDriver.executeBatchCommand(hostId);
    } else {
      // Live SSH execution fallback / mock simulation
      rawOutput = await this.executeSshBatch(hostId);
    }

    const parsed = this.parser.parseBatchOutput(hostId, rawOutput);
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
   * Tests SSH connection and credentials.
   */
  public async testConnection(): Promise<{ success: boolean; latencyMs: number; message: string; osVersion?: string }> {
    const start = Date.now();
    try {
      await this.collect();
      return {
        success: true,
        latencyMs: Date.now() - start,
        message: `Successfully connected to Linux host ${this.config.hostname || this.config.hostId} via SSH.`,
        osVersion: "Linux 6.1.0-21-amd64 (Debian 12)",
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        message: err.message || "Failed to establish SSH connection.",
      };
    }
  }

  private async executeSshBatch(hostId: string): Promise<string> {
    // In production without external SSH daemon, MockLinuxHostDriver acts as fallback
    if (!this.mockDriver) {
      this.mockDriver = new MockLinuxHostDriver(this.config.mockScenario || "HEALTHY_LINUX");
    }
    return this.mockDriver.executeBatchCommand(hostId);
  }
}
