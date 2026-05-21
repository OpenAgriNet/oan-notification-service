import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { SystemHealthIndicator } from './indicators/system.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DatabaseHealthIndicator,
    private readonly system: SystemHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.system.isHealthy('system'),
      // Warn if heap exceeds 512 MB
      () => this.memory.checkHeap('memory.heap', 512 * 1024 * 1024),
      // Warn if RSS exceeds 1 GB
      () => this.memory.checkRSS('memory.rss', 1024 * 1024 * 1024),
      // Warn if disk usage exceeds 90%
      () =>
        this.disk.checkStorage('disk', {
          path: '/',
          thresholdPercent: 0.9,
        }),
    ]);
  }

  /** Liveness probe — is the process alive? (no DB check) */
  @Get('live')
  live() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    };
  }

  /** Readiness probe — is the app ready to serve traffic? */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.db.isHealthy('database')]);
  }
}
