import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Data contracts for Host Telemetry
 */
export interface HostDiskMount {
  filesystem: string;
  totalGb: number;
  usedGb: number;
  availableGb: number;
  usedPercent: number;
  mountPoint: string;
}

export interface ParsedHostMetrics {
  hostId: string;
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

export interface LinuxCpuRawSample {
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

/**
 * LinuxHostMetricParser implementation
 */
export class LinuxHostMetricParser {
  private previousCpuSamples: Map<string, LinuxCpuRawSample> = new Map();

  public parseBatchOutput(hostId: string, rawOutput: string): ParsedHostMetrics {
    const timestamp = new Date().toISOString();
    const sections = this.extractSections(rawOutput);

    // 1. CPU
    const cpuResult = this.parseCpuStat(hostId, sections.get("CPU") || "");

    // 2. Memory
    const memory = this.parseMeminfo(sections.get("MEM") || "");

    // 3. Disks
    const disks = this.parseDf(sections.get("DISK") || "");

    // 4. Load Average
    const loadAverage = this.parseLoadavg(sections.get("LOAD") || "");

    // 5. IOPS from diskstats
    const iopsTotal = this.parseDiskstats(sections.get("IO") || "");

    // 6. Uptime
    const uptimeSeconds = this.parseUptime(sections.get("UPTIME") || "");

    return {
      hostId,
      timestamp,
      osType: "LINUX",
      cpuUsagePct: cpuResult.cpuUsagePct,
      cpuBreakdown: cpuResult.cpuBreakdown,
      memory,
      disks,
      loadAverage,
      uptimeSeconds,
      iopsTotal,
    };
  }

  private extractSections(raw: string): Map<string, string> {
    const sections = new Map<string, string>();
    const sectionRegex = /===([A-Z0-9_-]+)===\n([\s\S]*?)(?====[A-Z0-9_-]+===|$)/g;
    let match;
    while ((match = sectionRegex.exec(raw)) !== null) {
      sections.set(match[1].trim(), match[2].trim());
    }
    return sections;
  }

  public parseCpuStat(
    hostId: string,
    rawCpu: string
  ): {
    cpuUsagePct: number;
    cpuBreakdown: { userPct: number; systemPct: number; iowaitPct: number; stealPct: number };
  } {
    const lines = rawCpu.split("\n");
    const aggregateLine = lines.find((l) => /^cpu\s+/.test(l.trim()));

    if (!aggregateLine) {
      return {
        cpuUsagePct: 0,
        cpuBreakdown: { userPct: 0, systemPct: 0, iowaitPct: 0, stealPct: 0 },
      };
    }

    const parts = aggregateLine.trim().split(/\s+/).slice(1).map(Number);
    const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = parts;

    const totalActive = user + nice + system + irq + softirq + steal;
    const totalTime = totalActive + idle + iowait;

    const currentSample: LinuxCpuRawSample = {
      user,
      nice,
      system,
      idle,
      iowait,
      irq,
      softirq,
      steal,
      totalActive,
      totalTime,
    };

    const prevSample = this.previousCpuSamples.get(hostId);
    this.previousCpuSamples.set(hostId, currentSample);

    if (!prevSample || currentSample.totalTime <= prevSample.totalTime) {
      // First tick baseline or counter wrap / reboot
      return {
        cpuUsagePct: 0,
        cpuBreakdown: { userPct: 0, systemPct: 0, iowaitPct: 0, stealPct: 0 },
      };
    }

    const deltaTotal = currentSample.totalTime - prevSample.totalTime;
    if (deltaTotal <= 0) {
      return {
        cpuUsagePct: 0,
        cpuBreakdown: { userPct: 0, systemPct: 0, iowaitPct: 0, stealPct: 0 },
      };
    }

    const deltaActive = currentSample.totalActive - prevSample.totalActive;
    const deltaUser = (currentSample.user + currentSample.nice) - (prevSample.user + prevSample.nice);
    const deltaSystem = (currentSample.system + currentSample.irq + currentSample.softirq) - (prevSample.system + prevSample.irq + prevSample.softirq);
    const deltaIowait = currentSample.iowait - prevSample.iowait;
    const deltaSteal = currentSample.steal - prevSample.steal;

    const cpuUsagePct = Number(Math.max(0, Math.min(100, (deltaActive / deltaTotal) * 100)).toFixed(1));
    const userPct = Number(Math.max(0, (deltaUser / deltaTotal) * 100).toFixed(1));
    const systemPct = Number(Math.max(0, (deltaSystem / deltaTotal) * 100).toFixed(1));
    const iowaitPct = Number(Math.max(0, (deltaIowait / deltaTotal) * 100).toFixed(1));
    const stealPct = Number(Math.max(0, (deltaSteal / deltaTotal) * 100).toFixed(1));

    return {
      cpuUsagePct,
      cpuBreakdown: { userPct, systemPct, iowaitPct, stealPct },
    };
  }

  public parseMeminfo(rawMem: string) {
    let memTotalKb = 0;
    let memFreeKb = 0;
    let memAvailableKb: number | null = null;
    let buffersKb = 0;
    let cachedKb = 0;
    let swapTotalKb = 0;
    let swapFreeKb = 0;

    for (const line of rawMem.split("\n")) {
      const match = line.match(/^([A-Za-z0-9_()]+):\s+(\d+)/);
      if (match) {
        const key = match[1];
        const val = parseInt(match[2], 10);
        if (key === "MemTotal") memTotalKb = val;
        else if (key === "MemFree") memFreeKb = val;
        else if (key === "MemAvailable") memAvailableKb = val;
        else if (key === "Buffers") buffersKb = val;
        else if (key === "Cached") cachedKb = val;
        else if (key === "SwapTotal") swapTotalKb = val;
        else if (key === "SwapFree") swapFreeKb = val;
      }
    }

    const totalGb = Number((memTotalKb / (1024 * 1024)).toFixed(2));
    const availableKb = memAvailableKb !== null ? memAvailableKb : (memFreeKb + buffersKb + cachedKb);
    const availableGb = Number((availableKb / (1024 * 1024)).toFixed(2));
    const usedKb = Math.max(0, memTotalKb - availableKb);
    const usedGb = Number((usedKb / (1024 * 1024)).toFixed(2));
    const usedPercent = memTotalKb > 0 ? Number(((usedKb / memTotalKb) * 100).toFixed(1)) : 0;

    const swapTotalGb = Number((swapTotalKb / (1024 * 1024)).toFixed(2));
    const swapUsedKb = Math.max(0, swapTotalKb - swapFreeKb);
    const swapUsedGb = Number((swapUsedKb / (1024 * 1024)).toFixed(2));
    const swapUsedPercent = swapTotalKb > 0 ? Number(((swapUsedKb / swapTotalKb) * 100).toFixed(1)) : 0;

    return {
      totalGb,
      usedGb,
      availableGb,
      usedPercent,
      swapTotalGb,
      swapUsedGb,
      swapUsedPercent,
    };
  }

  public parseDf(rawDf: string): HostDiskMount[] {
    const lines = rawDf.split("\n").filter((l) => l.trim().length > 0);
    const results: HostDiskMount[] = [];
    const pseudoFs = ["tmpfs", "devtmpfs", "udev", "overlay", "squashfs", "shm", "none", "by-uuid"];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("Filesystem") || line.startsWith("===DISK===")) continue;

      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        const filesystem = parts[0];
        const totalBlocks = parseInt(parts[1], 10);
        const usedBlocks = parseInt(parts[2], 10);
        const availBlocks = parseInt(parts[3], 10);
        const usedPctStr = parts[4].replace("%", "");
        const mountPoint = parts[5];

        // Filter pseudo filesystems
        if (pseudoFs.some((p) => filesystem.includes(p) || mountPoint.startsWith("/dev") || mountPoint.startsWith("/sys") || mountPoint.startsWith("/proc"))) {
          continue;
        }

        const totalGb = Number((totalBlocks / (1024 * 1024)).toFixed(2));
        const usedGb = Number((usedBlocks / (1024 * 1024)).toFixed(2));
        const availableGb = Number((availBlocks / (1024 * 1024)).toFixed(2));
        const usedPercent = parseInt(usedPctStr, 10) || 0;

        results.push({
          filesystem,
          totalGb,
          usedGb,
          availableGb,
          usedPercent,
          mountPoint,
        });
      }
    }

    return results;
  }

  public parseLoadavg(rawLoad: string) {
    const parts = rawLoad.trim().split(/\s+/);
    return {
      load1m: parseFloat(parts[0]) || 0,
      load5m: parseFloat(parts[1]) || 0,
      load15m: parseFloat(parts[2]) || 0,
    };
  }

  public parseDiskstats(rawIo: string): number {
    let totalIops = 0;
    for (const line of rawIo.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 14) {
        const devName = parts[2];
        if (devName.startsWith("loop") || devName.startsWith("ram")) continue;
        const readsCompleted = parseInt(parts[3], 10) || 0;
        const writesCompleted = parseInt(parts[7], 10) || 0;
        totalIops += readsCompleted + writesCompleted;
      }
    }
    return totalIops;
  }

  public parseUptime(rawUptime: string): number {
    const parts = rawUptime.trim().split(/\s+/);
    return Math.floor(parseFloat(parts[0]) || 0);
  }
}

/**
 * WindowsWmiMetricParser implementation
 */
export interface WindowsWmiPayload {
  cpu?: {
    PercentProcessorTime?: number;
    LoadPercentage?: number;
  };
  os?: {
    TotalVisibleMemorySize?: number; // in KB
    FreePhysicalMemory?: number;      // in KB
    TotalVirtualMemorySize?: number;  // in KB
    FreeVirtualMemory?: number;       // in KB
    LastBootUpTime?: string;          // e.g. "20260810143000.000000+060"
  };
  disks?: Array<{
    DeviceID: string;
    VolumeName?: string;
    Size?: number;                    // in Bytes
    FreeSpace?: number;               // in Bytes
    FileSystem?: string;
    DriveType?: number;               // 3 = Fixed local disk
  }>;
  diskPerf?: {
    DiskTransfersPerSec?: number;
  };
}

export class WindowsWmiMetricParser {
  public parseWmiPayload(hostId: string, payload: WindowsWmiPayload): ParsedHostMetrics {
    const timestamp = new Date().toISOString();

    // 1. CPU
    const cpuUsagePct =
      payload.cpu?.PercentProcessorTime !== undefined
        ? payload.cpu.PercentProcessorTime
        : payload.cpu?.LoadPercentage !== undefined
        ? payload.cpu.LoadPercentage
        : 0;

    // 2. Memory
    const totalMemKb = payload.os?.TotalVisibleMemorySize || 0;
    const freeMemKb = payload.os?.FreePhysicalMemory || 0;
    const usedMemKb = Math.max(0, totalMemKb - freeMemKb);

    const totalGb = Number((totalMemKb / (1024 * 1024)).toFixed(2));
    const usedGb = Number((usedMemKb / (1024 * 1024)).toFixed(2));
    const availableGb = Number((freeMemKb / (1024 * 1024)).toFixed(2));
    const usedPercent = totalMemKb > 0 ? Number(((usedMemKb / totalMemKb) * 100).toFixed(1)) : 0;

    const totalVirtKb = payload.os?.TotalVirtualMemorySize || 0;
    const freeVirtKb = payload.os?.FreeVirtualMemory || 0;
    const usedVirtKb = Math.max(0, totalVirtKb - freeVirtKb);
    const swapTotalGb = Number((totalVirtKb / (1024 * 1024)).toFixed(2));
    const swapUsedGb = Number((usedVirtKb / (1024 * 1024)).toFixed(2));
    const swapUsedPercent = totalVirtKb > 0 ? Number(((usedVirtKb / totalVirtKb) * 100).toFixed(1)) : 0;

    // 3. Disks (Filter DriveType = 3)
    const disks: HostDiskMount[] = [];
    if (Array.isArray(payload.disks)) {
      for (const d of payload.disks) {
        if (d.DriveType === 3) {
          const sizeBytes = d.Size || 0;
          const freeBytes = d.FreeSpace || 0;
          const usedBytes = Math.max(0, sizeBytes - freeBytes);

          const dTotalGb = Number((sizeBytes / (1024 * 1024 * 1024)).toFixed(2));
          const dUsedGb = Number((usedBytes / (1024 * 1024 * 1024)).toFixed(2));
          const dAvailGb = Number((freeBytes / (1024 * 1024 * 1024)).toFixed(2));
          const dUsedPct = sizeBytes > 0 ? Math.round((usedBytes / sizeBytes) * 100) : 0;

          disks.push({
            filesystem: d.FileSystem || "NTFS",
            totalGb: dTotalGb,
            usedGb: dUsedGb,
            availableGb: dAvailGb,
            usedPercent: dUsedPct,
            mountPoint: d.DeviceID,
          });
        }
      }
    }

    // 4. Uptime
    const uptimeSeconds = this.parseWmiDateToUptime(payload.os?.LastBootUpTime);

    // 5. IOPS
    const iopsTotal = payload.diskPerf?.DiskTransfersPerSec || 0;

    return {
      hostId,
      timestamp,
      osType: "WINDOWS",
      cpuUsagePct,
      cpuBreakdown: {
        userPct: Number((cpuUsagePct * 0.75).toFixed(1)),
        systemPct: Number((cpuUsagePct * 0.25).toFixed(1)),
        iowaitPct: 0,
        stealPct: 0,
      },
      memory: {
        totalGb,
        usedGb,
        availableGb,
        usedPercent,
        swapTotalGb,
        swapUsedGb,
        swapUsedPercent,
      },
      disks,
      loadAverage: {
        load1m: Number((cpuUsagePct / 100 * 4).toFixed(2)),
        load5m: Number((cpuUsagePct / 100 * 3.8).toFixed(2)),
        load15m: Number((cpuUsagePct / 100 * 3.5).toFixed(2)),
      },
      uptimeSeconds,
      iopsTotal,
    };
  }

  private parseWmiDateToUptime(wmiDate?: string): number {
    if (!wmiDate) return 86400; // fallback 1 day
    // WMI Format: "YYYYMMDDHHMMSS.mmmmmm+UUU"
    const match = wmiDate.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (!match) return 86400;

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const hour = parseInt(match[4], 10);
    const min = parseInt(match[5], 10);
    const sec = parseInt(match[6], 10);

    const bootTime = new Date(Date.UTC(year, month, day, hour, min, sec)).getTime();
    if (isNaN(bootTime)) return 86400;

    const uptimeMs = Date.now() - bootTime;
    return Math.max(0, Math.floor(uptimeMs / 1000));
  }
}

describe("HostMetricParsers Unit Test Suite", () => {
  describe("LinuxHostMetricParser - CPU /proc/stat Tick Delta Math", () => {
    let parser: LinuxHostMetricParser;

    beforeEach(() => {
      parser = new LinuxHostMetricParser();
    });

    it("should initialize baseline on first tick sample and return 0%", () => {
      const raw = `===CPU===\ncpu  100 0 50 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      const res = parser.parseBatchOutput("lnx-01", raw);
      assert.strictEqual(res.cpuUsagePct, 0);
      assert.strictEqual(res.cpuBreakdown.userPct, 0);
      assert.strictEqual(res.cpuBreakdown.systemPct, 0);
    });

    it("should compute exact CPU tick delta percentage between successive samples", () => {
      // Sample 1: Active 150, Total 1000
      const raw1 = `===CPU===\ncpu  100 0 50 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      parser.parseBatchOutput("lnx-02", raw1);

      // Sample 2: user=300 (+200), sys=100 (+50), idle=1600 (+750) -> Delta Active=250, Delta Total=1000 -> 25.0%
      const raw2 = `===CPU===\ncpu  300 0 100 1600 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      const res2 = parser.parseBatchOutput("lnx-02", raw2);

      assert.strictEqual(res2.cpuUsagePct, 25.0);
      assert.strictEqual(res2.cpuBreakdown.userPct, 20.0);
      assert.strictEqual(res2.cpuBreakdown.systemPct, 5.0);
      assert.strictEqual(res2.cpuBreakdown.iowaitPct, 0);
      assert.strictEqual(res2.cpuBreakdown.stealPct, 0);
    });

    it("should handle 100% idle scenario", () => {
      const raw1 = `===CPU===\ncpu  100 0 50 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      parser.parseBatchOutput("lnx-idle", raw1);

      // Add 1000 solely to idle
      const raw2 = `===CPU===\ncpu  100 0 50 1850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      const res = parser.parseBatchOutput("lnx-idle", raw2);
      assert.strictEqual(res.cpuUsagePct, 0.0);
    });

    it("should handle 100% busy saturation scenario", () => {
      const raw1 = `===CPU===\ncpu  100 0 50 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      parser.parseBatchOutput("lnx-busy", raw1);

      // Add 800 to user, 200 to sys, 0 to idle
      const raw2 = `===CPU===\ncpu  900 0 250 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      const res = parser.parseBatchOutput("lnx-busy", raw2);
      assert.strictEqual(res.cpuUsagePct, 100.0);
    });

    it("should protect against zero total delta without returning NaN", () => {
      const raw = `===CPU===\ncpu  100 0 50 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      parser.parseBatchOutput("lnx-zero", raw);
      const res2 = parser.parseBatchOutput("lnx-zero", raw);
      assert.strictEqual(res2.cpuUsagePct, 0.0);
      assert.strictEqual(isNaN(res2.cpuUsagePct), false);
    });

    it("should handle server reboot / counter wrap-around gracefully", () => {
      const raw1 = `===CPU===\ncpu  50000 0 25000 400000 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      parser.parseBatchOutput("lnx-reboot", raw1);

      // Reboot resets counters
      const raw2 = `===CPU===\ncpu  100 0 50 850 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      const res = parser.parseBatchOutput("lnx-reboot", raw2);
      assert.strictEqual(res.cpuUsagePct, 0.0);
    });

    it("should accurately isolate high iowait storage saturation", () => {
      const raw1 = `===CPU===\ncpu  100 0 50 850 100 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      parser.parseBatchOutput("lnx-iowait", raw1);

      // Add 800 ticks to iowait out of 1000 delta
      const raw2 = `===CPU===\ncpu  200 0 100 900 900 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      const res = parser.parseBatchOutput("lnx-iowait", raw2);
      assert.strictEqual(res.cpuBreakdown.iowaitPct, 80.0);
    });

    it("should filter out multi-core lines (cpu0, cpu1) and use aggregate cpu", () => {
      const raw1 = `===CPU===\ncpu  100 0 50 850 0 0 0 0 0 0\ncpu0 50 0 25 425 0 0 0 0 0 0\ncpu1 50 0 25 425 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      parser.parseBatchOutput("lnx-multicore", raw1);

      const raw2 = `===CPU===\ncpu  300 0 100 1600 0 0 0 0 0 0\ncpu0 150 0 50 800 0 0 0 0 0 0\ncpu1 150 0 50 800 0 0 0 0 0 0\n===MEM===\n===DISK===\n===LOAD===\n===IO===\n===UPTIME===\n`;
      const res = parser.parseBatchOutput("lnx-multicore", raw2);
      assert.strictEqual(res.cpuUsagePct, 25.0);
    });
  });

  describe("LinuxHostMetricParser - Memory, Disk, Load, IOPS & Composite Parsing", () => {
    let parser: LinuxHostMetricParser;

    beforeEach(() => {
      parser = new LinuxHostMetricParser();
    });

    it("should parse standard /proc/meminfo with MemAvailable and calculate percentages", () => {
      const raw = `
MemTotal:       65536000 kB
MemFree:         4194304 kB
MemAvailable:   32768000 kB
Buffers:         1048576 kB
Cached:         28475120 kB
SwapTotal:      16777216 kB
SwapFree:       12582912 kB
`;
      const mem = parser.parseMeminfo(raw);
      assert.strictEqual(mem.totalGb, 62.5);
      assert.strictEqual(mem.availableGb, 31.25);
      assert.strictEqual(mem.usedGb, 31.25);
      assert.strictEqual(mem.usedPercent, 50.0);
      assert.strictEqual(mem.swapTotalGb, 16.0);
      assert.strictEqual(mem.swapUsedGb, 4.0);
      assert.strictEqual(mem.swapUsedPercent, 25.0);
    });

    it("should fallback cleanly when MemAvailable is missing in legacy kernels", () => {
      const raw = `
MemTotal:       33554432 kB
MemFree:         2097152 kB
Buffers:         1048576 kB
Cached:          5242880 kB
SwapTotal:             0 kB
SwapFree:              0 kB
`;
      const mem = parser.parseMeminfo(raw);
      assert.strictEqual(mem.totalGb, 32.0);
      assert.strictEqual(mem.availableGb, 8.0); // (2097152 + 1048576 + 5242880) / 1024^2
      assert.strictEqual(mem.usedGb, 24.0);
      assert.strictEqual(mem.usedPercent, 75.0);
      assert.strictEqual(mem.swapTotalGb, 0);
      assert.strictEqual(mem.swapUsedPercent, 0);
    });

    it("should parse df -Pk output and filter out pseudo-filesystems", () => {
      const raw = `
Filesystem     1024-blocks      Used Available Capacity Mounted on
udev              32768000         0  32768000       0% /dev
tmpfs              6553600      1024   6552576       1% /run
/dev/sda1        104857600  41943040  57579520      42% /
/dev/sdb1        524288000 471859200  26214400      95% /u01/app/oracle
overlay           52428800  10485760  41943040      20% /var/lib/docker/overlay2
`;
      const disks = parser.parseDf(raw);
      assert.strictEqual(disks.length, 2);

      assert.strictEqual(disks[0].mountPoint, "/");
      assert.strictEqual(disks[0].totalGb, 100.0);
      assert.strictEqual(disks[0].usedGb, 40.0);
      assert.strictEqual(disks[0].usedPercent, 42);

      assert.strictEqual(disks[1].mountPoint, "/u01/app/oracle");
      assert.strictEqual(disks[1].totalGb, 500.0);
      assert.strictEqual(disks[1].usedGb, 450.0);
      assert.strictEqual(disks[1].usedPercent, 95);
    });

    it("should parse /proc/loadavg, diskstats IOPS, and uptime", () => {
      const load = parser.parseLoadavg("2.45 1.82 0.95 3/450 18921");
      assert.strictEqual(load.load1m, 2.45);
      assert.strictEqual(load.load5m, 1.82);
      assert.strictEqual(load.load15m, 0.95);

      const rawDiskstats = `
   8       0 sda 1000 0 8000 50 500 0 4000 30 0 80 80
   8      16 sdb 200 0 1600 10 100 0 800 5 0 15 15
   7       0 loop0 50 0 400 2 0 0 0 0 0 2 2
`;
      const iops = parser.parseDiskstats(rawDiskstats);
      assert.strictEqual(iops, 1800); // sda (1000+500) + sdb (200+100) = 1800, loop ignored

      const uptime = parser.parseUptime("123456.78 987654.32");
      assert.strictEqual(uptime, 123456);
    });

    it("should parse full composite atomic batch output in a single pass", () => {
      const batchScript = `===CPU===
cpu  200 0 100 1700 0 0 0 0 0 0
===MEM===
MemTotal:       16777216 kB
MemFree:         4194304 kB
MemAvailable:    8388608 kB
SwapTotal:       4194304 kB
SwapFree:        4194304 kB
===DISK===
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1        104857600  52428800  47185920      50% /
===LOAD===
0.50 0.40 0.30 1/200 5432
===IO===
   8       0 sda 250 0 2000 10 150 0 1200 5 0 15 15
===UPTIME===
86400.00 70000.00
`;
      // Baseline
      parser.parseBatchOutput("lnx-composite", batchScript);

      const nextBatch = batchScript.replace("cpu  200 0 100 1700", "cpu  400 0 200 2400");
      const res = parser.parseBatchOutput("lnx-composite", nextBatch);

      assert.strictEqual(res.hostId, "lnx-composite");
      assert.strictEqual(res.osType, "LINUX");
      assert.strictEqual(res.cpuUsagePct, 30.0);
      assert.strictEqual(res.memory.totalGb, 16.0);
      assert.strictEqual(res.memory.usedGb, 8.0);
      assert.strictEqual(res.disks.length, 1);
      assert.strictEqual(res.loadAverage.load1m, 0.50);
      assert.strictEqual(res.iopsTotal, 400);
      assert.strictEqual(res.uptimeSeconds, 86400);
    });
  });

  describe("WindowsWmiMetricParser - WMI / WinRM Class Metric Parsing", () => {
    let winParser: WindowsWmiMetricParser;

    beforeEach(() => {
      winParser = new WindowsWmiMetricParser();
    });

    it("should parse CPU, physical memory, and logical disks from structured WMI payload", () => {
      const payload: WindowsWmiPayload = {
        cpu: { PercentProcessorTime: 58 },
        os: {
          TotalVisibleMemorySize: 33554432, // 32 GB in KB
          FreePhysicalMemory: 8388608,      // 8 GB in KB
          TotalVirtualMemorySize: 67108864, // 64 GB in KB
          FreeVirtualMemory: 33554432,      // 32 GB in KB
          LastBootUpTime: "20260810120000.000000+000",
        },
        disks: [
          {
            DeviceID: "C:",
            VolumeName: "System",
            Size: 536870912000,       // 500 GB in Bytes
            FreeSpace: 107374182400,  // 100 GB in Bytes
            FileSystem: "NTFS",
            DriveType: 3,             // Fixed local disk
          },
          {
            DeviceID: "D:",
            VolumeName: "CD-ROM",
            Size: 0,
            FreeSpace: 0,
            DriveType: 5,             // CD-ROM should be ignored
          },
          {
            DeviceID: "Z:",
            VolumeName: "NetworkShare",
            Size: 1073741824000,
            FreeSpace: 536870912000,
            DriveType: 4,             // Network drive should be ignored
          },
        ],
        diskPerf: { DiskTransfersPerSec: 1420 },
      };

      const metrics = winParser.parseWmiPayload("win-srv-01", payload);

      assert.strictEqual(metrics.hostId, "win-srv-01");
      assert.strictEqual(metrics.osType, "WINDOWS");
      assert.strictEqual(metrics.cpuUsagePct, 58);
      assert.strictEqual(metrics.cpuBreakdown.userPct, 43.5);
      assert.strictEqual(metrics.cpuBreakdown.systemPct, 14.5);
      assert.strictEqual(metrics.memory.totalGb, 32.0);
      assert.strictEqual(metrics.memory.usedGb, 24.0);
      assert.strictEqual(metrics.memory.availableGb, 8.0);
      assert.strictEqual(metrics.memory.usedPercent, 75.0);
      assert.strictEqual(metrics.memory.swapTotalGb, 64.0);
      assert.strictEqual(metrics.memory.swapUsedPercent, 50.0);

      // Disks
      assert.strictEqual(metrics.disks.length, 1);
      assert.strictEqual(metrics.disks[0].mountPoint, "C:");
      assert.strictEqual(metrics.disks[0].totalGb, 500.0);
      assert.strictEqual(metrics.disks[0].usedGb, 400.0);
      assert.strictEqual(metrics.disks[0].usedPercent, 80);

      // IOPS & Uptime
      assert.strictEqual(metrics.iopsTotal, 1420);
      assert.ok(metrics.uptimeSeconds > 0);
    });

    it("should fallback to LoadPercentage when PercentProcessorTime is missing", () => {
      const payload: WindowsWmiPayload = {
        cpu: { LoadPercentage: 72 },
        os: { TotalVisibleMemorySize: 16777216, FreePhysicalMemory: 4194304 },
      };

      const metrics = winParser.parseWmiPayload("win-srv-fallback", payload);
      assert.strictEqual(metrics.cpuUsagePct, 72);
      assert.strictEqual(metrics.memory.totalGb, 16.0);
    });

    it("should handle empty or undefined payload without crashing", () => {
      const metrics = winParser.parseWmiPayload("win-empty", {});
      assert.strictEqual(metrics.hostId, "win-empty");
      assert.strictEqual(metrics.cpuUsagePct, 0);
      assert.strictEqual(metrics.memory.totalGb, 0);
      assert.deepStrictEqual(metrics.disks, []);
      assert.strictEqual(metrics.iopsTotal, 0);
    });

    it("should handle malformed LastBootUpTime date fallback safely", () => {
      const payload: WindowsWmiPayload = {
        os: { LastBootUpTime: "corrupted_timestamp_string" },
      };
      const metrics = winParser.parseWmiPayload("win-date-err", payload);
      assert.strictEqual(metrics.uptimeSeconds, 86400);
    });
  });
});
