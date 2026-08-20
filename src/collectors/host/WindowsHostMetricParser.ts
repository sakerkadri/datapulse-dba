import {
  HostDiskMount,
  HostMetricsSnapshot,
  ParsedHostMetrics,
  WindowsWqlResult,
} from "../../types/host";

export type WindowsWmiPayload = WindowsWqlResult;

export class WindowsHostMetricParser {
  /**
   * Transforms raw WMI query payload into standardized ParsedHostMetrics.
   */
  public parseWmiPayload(hostId: string, payload: WindowsWmiPayload): ParsedHostMetrics {
    const timestamp = new Date().toISOString();

    // 1. CPU Usage & Breakdown
    let cpuUsagePct = 0;
    let userPct = 0;
    let systemPct = 0;

    if (payload.cpu?.PercentProcessorTime !== undefined && isFinite(payload.cpu.PercentProcessorTime)) {
      cpuUsagePct = Math.max(0, Math.min(100, Number(payload.cpu.PercentProcessorTime)));
      userPct = payload.cpu.PercentUserTime !== undefined
        ? Number(Math.max(0, Math.min(100, payload.cpu.PercentUserTime)).toFixed(1))
        : Number((cpuUsagePct * 0.75).toFixed(1));
      systemPct = payload.cpu.PercentPrivilegedTime !== undefined
        ? Number(Math.max(0, Math.min(100, payload.cpu.PercentPrivilegedTime)).toFixed(1))
        : Number((cpuUsagePct * 0.25).toFixed(1));
    } else if (payload.cpu?.LoadPercentage !== undefined && isFinite(payload.cpu.LoadPercentage)) {
      cpuUsagePct = Math.max(0, Math.min(100, Number(payload.cpu.LoadPercentage)));
      userPct = Number((cpuUsagePct * 0.75).toFixed(1));
      systemPct = Number((cpuUsagePct * 0.25).toFixed(1));
    } else if (payload.cpuFallback) {
      const fallbackList = Array.isArray(payload.cpuFallback) ? payload.cpuFallback : [payload.cpuFallback];
      if (fallbackList.length > 0) {
        const sumLoad = fallbackList.reduce((acc, c) => acc + (c.LoadPercentage || 0), 0);
        cpuUsagePct = Math.max(0, Math.min(100, Number((sumLoad / fallbackList.length).toFixed(1))));
        userPct = Number((cpuUsagePct * 0.75).toFixed(1));
        systemPct = Number((cpuUsagePct * 0.25).toFixed(1));
      }
    }

    // 2. Physical & Virtual Memory (WMI provides values in KB)
    const totalMemKb = Math.max(0, payload.os?.TotalVisibleMemorySize || 0);
    const freeMemKb = Math.max(0, payload.os?.FreePhysicalMemory || 0);
    const usedMemKb = Math.max(0, totalMemKb - freeMemKb);

    const totalGb = Number((totalMemKb / (1024 * 1024)).toFixed(2));
    const usedGb = Number((usedMemKb / (1024 * 1024)).toFixed(2));
    const availableGb = Number((freeMemKb / (1024 * 1024)).toFixed(2));
    const usedPercent = totalMemKb > 0 ? Number(((usedMemKb / totalMemKb) * 100).toFixed(1)) : 0;

    const totalVirtKb = Math.max(0, payload.os?.TotalVirtualMemorySize || 0);
    const freeVirtKb = Math.max(0, payload.os?.FreeVirtualMemory || 0);
    const usedVirtKb = Math.max(0, totalVirtKb - freeVirtKb);
    const swapTotalGb = Number((totalVirtKb / (1024 * 1024)).toFixed(2));
    const swapUsedGb = Number((usedVirtKb / (1024 * 1024)).toFixed(2));
    const swapUsedPercent = totalVirtKb > 0 ? Number(((usedVirtKb / totalVirtKb) * 100).toFixed(1)) : 0;

    // 3. Logical Disks (Strictly DriveType = 3 Fixed Local Disks)
    const disks: HostDiskMount[] = [];
    if (Array.isArray(payload.disks)) {
      for (const d of payload.disks) {
        if (d.DriveType === 3 && d.DeviceID) {
          const sizeBytes = Math.max(0, Number(d.Size || 0));
          const freeBytes = Math.max(0, Number(d.FreeSpace || 0));
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
            mount: d.DeviceID,
            totalBytes: sizeBytes,
            usedBytes: usedBytes,
            freeBytes: freeBytes,
          });
        }
      }
    }

    // 4. System Uptime (Parsed from CIM LastBootUpTime)
    const uptimeSeconds = this.parseWmiDateToUptime(payload.os?.LastBootUpTime);

    // 5. Disk IOPS & Performance
    const iopsTotal = Math.max(0, Number(payload.diskPerf?.DiskTransfersPerSec || 0));

    // 6. Synthetic Normalized Load Average
    const cores = payload.cpu?.NumberOfCores || 4;
    const load1m = Number(((cpuUsagePct / 100) * cores).toFixed(2));
    const load5m = Number(((cpuUsagePct / 100) * cores * 0.95).toFixed(2));
    const load15m = Number(((cpuUsagePct / 100) * cores * 0.90).toFixed(2));

    return {
      hostId,
      timestamp,
      osType: "WINDOWS",
      cpuUsagePct,
      cpuBreakdown: {
        userPct,
        systemPct,
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
        load1m,
        load5m,
        load15m,
      },
      uptimeSeconds,
      iopsTotal,
    };
  }

  /**
   * Alias fulfilling parse(wqlResult) interface contract.
   */
  public parse(wqlResult: WindowsWqlResult, hostId: string = "default-windows"): HostMetricsSnapshot {
    const parsed = this.parseWmiPayload(hostId, wqlResult);
    return this.toSnapshot(parsed);
  }

  /**
   * Parses CIM datetime string (YYYYMMDDhhmmss.ffffff+UUU) to uptime in seconds.
   */
  public parseWmiDateToUptime(wmiDate?: string): number {
    if (!wmiDate) return 86400; // Default 1 day fallback
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
        iowaitPercent: 0,
        stealPercent: 0,
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
}

// Alias for backwards compatibility
export class WindowsWmiMetricParser extends WindowsHostMetricParser {}
