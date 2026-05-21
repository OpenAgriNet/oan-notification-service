import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import * as os from 'os';

@Injectable()
export class SystemHealthIndicator extends HealthIndicator {
  isHealthy(key: string): HealthIndicatorResult {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const cpus = os.cpus();
    const cpuUsage = process.cpuUsage();

    return this.getStatus(key, true, {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      nodeVersion: process.version,
      pid: process.pid,
      uptime: {
        processSeconds: Math.floor(process.uptime()),
        systemSeconds: Math.floor(os.uptime()),
        processHuman: this.formatUptime(process.uptime()),
        systemHuman: this.formatUptime(os.uptime()),
      },
      memory: {
        totalBytes: totalMem,
        totalMB: (totalMem / 1024 / 1024).toFixed(2),
        usedBytes: usedMem,
        usedMB: (usedMem / 1024 / 1024).toFixed(2),
        freeBytes: freeMem,
        freeMB: (freeMem / 1024 / 1024).toFixed(2),
        usagePercent: ((usedMem / totalMem) * 100).toFixed(2),
      },
      process: {
        heapUsedBytes: process.memoryUsage().heapUsed,
        heapUsedMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
        heapTotalBytes: process.memoryUsage().heapTotal,
        heapTotalMB: (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2),
        rssBytes: process.memoryUsage().rss,
        rssMB: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
        externalBytes: process.memoryUsage().external,
        cpuUserMicros: cpuUsage.user,
        cpuSystemMicros: cpuUsage.system,
      },
      cpu: {
        count: cpus.length,
        model: cpus[0]?.model ?? 'unknown',
        speedMHz: cpus[0]?.speed ?? 0,
        loadAvg: os.loadavg().map((v) => parseFloat(v.toFixed(2))),
      },
    });
  }

  private formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d}d ${h}h ${m}m ${s}s`;
  }
}
