import {
  HostDiskMount,
  HostMetricsSnapshot,
  LinuxRawSnapshot,
  ParsedHostMetrics,
} from "../../types/host";

export class LinuxHostMetricParser {
  private previousCpuSamples: Map<string, LinuxRawSnapshot> = new Map();
  private previousDiskStats: Map<string, { totalTransfers: number; timestamp: number }> = new Map();

  /**
   * Parses consolidated atomic batch output string into ParsedHostMetrics.
   */
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

  /**
   * Alias method fulfilling parse(rawOutput, prevSnapshot) contract.
   */
  public parse(
    rawOutput: string,
    prevSnapshot?: LinuxRawSnapshot,
    hostId: string = "default-linux"
  ): HostMetricsSnapshot {
    if (prevSnapshot) {
      this.previousCpuSamples.set(hostId, prevSnapshot);
    }
    const parsed = this.parseBatchOutput(hostId, rawOutput);
    return this.toSnapshot(parsed);
  }

  /**
   * Extracts section contents using ===SECTION=== delimiters.
   */
  public extractSections(raw: string): Map<string, string> {
    const sections = new Map<string, string>();
    const sectionRegex = /===([A-Z0-9_-]+)===\n([\s\S]*?)(?====[A-Z0-9_-]+===|$)/g;
    let match;
    while ((match = sectionRegex.exec(raw)) !== null) {
      sections.set(match[1].trim(), match[2].trim());
    }
    return sections;
  }

  /**
   * Calculates accurate CPU tick-delta percentage from /proc/stat.
   */
  public parseCpuStat(
    hostId: string,
    rawCpu: string
  ): {
    cpuUsagePct: number;
    cpuBreakdown: { userPct: number; systemPct: number; iowaitPct: number; stealPct: number };
    currentSample?: LinuxRawSnapshot;
  } {
    const lines = rawCpu.split("\n");
    // Strictly find the aggregate line 'cpu ' and avoid 'cpu0', 'cpu1'
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

    const currentSample: LinuxRawSnapshot = {
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

    // Baseline tick 1 or reboot/counter wrap
    if (!prevSample || currentSample.totalTime <= prevSample.totalTime) {
      return {
        cpuUsagePct: 0,
        cpuBreakdown: { userPct: 0, systemPct: 0, iowaitPct: 0, stealPct: 0 },
        currentSample,
      };
    }

    const deltaTotal = currentSample.totalTime - prevSample.totalTime;
    if (deltaTotal <= 0) {
      return {
        cpuUsagePct: 0,
        cpuBreakdown: { userPct: 0, systemPct: 0, iowaitPct: 0, stealPct: 0 },
        currentSample,
      };
    }

    const deltaActive = currentSample.totalActive - prevSample.totalActive;
    const deltaUser = (currentSample.user + currentSample.nice) - (prevSample.user + prevSample.nice);
    const deltaSystem =
      (currentSample.system + currentSample.irq + currentSample.softirq) -
      (prevSample.system + prevSample.irq + prevSample.softirq);
    const deltaIowait = currentSample.iowait - prevSample.iowait;
    const deltaSteal = currentSample.steal - prevSample.steal;

    const cpuUsagePct = Number(Math.max(0, Math.min(100, (deltaActive / deltaTotal) * 100)).toFixed(1));
    const userPct = Number(Math.max(0, Math.min(100, (deltaUser / deltaTotal) * 100)).toFixed(1));
    const systemPct = Number(Math.max(0, Math.min(100, (deltaSystem / deltaTotal) * 100)).toFixed(1));
    const iowaitPct = Number(Math.max(0, Math.min(100, (deltaIowait / deltaTotal) * 100)).toFixed(1));
    const stealPct = Number(Math.max(0, Math.min(100, (deltaSteal / deltaTotal) * 100)).toFixed(1));

    return {
      cpuUsagePct,
      cpuBreakdown: { userPct, systemPct, iowaitPct, stealPct },
      currentSample,
    };
  }

  /**
   * Parses /proc/meminfo with MemAvailable fallback calculation for legacy kernels.
   */
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
    // Modern Linux 3.14+ provides MemAvailable; legacy falls back to MemFree + Buffers + Cached
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
      totalBytes: memTotalKb * 1024,
      usedBytes: usedKb * 1024,
      freeBytes: availableKb * 1024,
      availableBytes: availableKb * 1024,
    };
  }

  /**
   * Parses POSIX df -Pk output and strictly filters out pseudo/virtual filesystems.
   */
  public parseDf(rawDf: string): HostDiskMount[] {
    const lines = rawDf.split("\n").filter((l) => l.trim().length > 0);
    const results: HostDiskMount[] = [];
    const pseudoFs = ["tmpfs", "devtmpfs", "udev", "overlay", "squashfs", "shm", "none", "by-uuid", "iso9660"];

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

        // Filter pseudo filesystems and kernel pseudo mounts
        if (
          pseudoFs.some((p) => filesystem.includes(p)) ||
          mountPoint.startsWith("/dev") ||
          mountPoint.startsWith("/sys") ||
          mountPoint.startsWith("/proc") ||
          filesystem.startsWith("/dev/loop")
        ) {
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
          mount: mountPoint,
          totalBytes: totalBlocks * 1024,
          usedBytes: usedBlocks * 1024,
          freeBytes: availBlocks * 1024,
        });
      }
    }

    return results;
  }

  /**
   * Parses /proc/loadavg for 1m, 5m, 15m load averages and process queue counts.
   */
  public parseLoadavg(rawLoad: string) {
    const parts = rawLoad.trim().split(/\s+/);
    const procParts = parts[3] ? parts[3].split("/") : ["0", "0"];
    return {
      load1m: parseFloat(parts[0]) || 0,
      load5m: parseFloat(parts[1]) || 0,
      load15m: parseFloat(parts[2]) || 0,
      runnableProcesses: parseInt(procParts[0], 10) || 0,
      totalProcesses: parseInt(procParts[1], 10) || 0,
    };
  }

  /**
   * Parses /proc/diskstats for total physical drive I/O operations.
   */
  public parseDiskstats(rawIo: string): number {
    let totalIops = 0;
    for (const line of rawIo.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 14) {
        const devName = parts[2];
        // Ignore loopback, ramdisks, optical drives
        if (devName.startsWith("loop") || devName.startsWith("ram") || devName.startsWith("sr")) {
          continue;
        }
        const readsCompleted = parseInt(parts[3], 10) || 0;
        const writesCompleted = parseInt(parts[7], 10) || 0;
        totalIops += readsCompleted + writesCompleted;
      }
    }
    return totalIops;
  }

  /**
   * Parses /proc/uptime seconds.
   */
  public parseUptime(rawUptime: string): number {
    const parts = rawUptime.trim().split(/\s+/);
    return Math.floor(parseFloat(parts[0]) || 0);
  }

  /**
   * Converts ParsedHostMetrics to HostMetricsSnapshot.
   */
  public toSnapshot(parsed: ParsedHostMetrics): HostMetricsSnapshot {
    return {
      hostId: parsed.hostId,
      hostname: parsed.hostname,
      timestamp: parsed.timestamp,
      osType: parsed.osType,
      cpu: {
        usagePercent: parsed.cpuUsagePct,
        userPercent: parsed.cpuBreakdown.userPct,
        systemPercent: parsed.cpuBreakdown.systemPct,
        iowaitPercent: parsed.cpuBreakdown.iowaitPct,
        stealPercent: parsed.cpuBreakdown.stealPct,
        loadAvg: [parsed.loadAverage.load1m, parsed.loadAverage.load5m, parsed.loadAverage.load15m],
      },
      memory: parsed.memory,
      disks: parsed.disks,
      disk: parsed.disks,
      io: {
        totalIops: parsed.iopsTotal,
        readIops: Math.floor(parsed.iopsTotal * 0.6),
        writeIops: Math.floor(parsed.iopsTotal * 0.4),
        utilPercent: Math.min(100, Math.round((parsed.iopsTotal / 4000) * 100)),
      },
      loadAverage: parsed.loadAverage,
      uptimeSeconds: parsed.uptimeSeconds,
      iopsTotal: parsed.iopsTotal,
    };
  }

  /**
   * Resets sample caches.
   */
  public reset(hostId?: string) {
    if (hostId) {
      this.previousCpuSamples.delete(hostId);
      this.previousDiskStats.delete(hostId);
    } else {
      this.previousCpuSamples.clear();
      this.previousDiskStats.clear();
    }
  }
}
