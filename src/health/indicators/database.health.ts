import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const start = Date.now();

    try {
      await this.dataSource.query('SELECT 1');
      const latencyMs = Date.now() - start;

      const [versionRow] = await this.dataSource.query('SELECT version()');
      const [dbStats] = await this.dataSource.query(`
        SELECT
          pg_database_size(current_database()) AS db_size_bytes,
          current_database()                   AS db_name,
          pg_postmaster_start_time()           AS server_started_at
      `);

      const [connectionStats] = await this.dataSource.query(`
        SELECT
          count(*)                                          AS total_connections,
          count(*) FILTER (WHERE state = 'active')         AS active_connections,
          count(*) FILTER (WHERE state = 'idle')           AS idle_connections
        FROM pg_stat_activity
        WHERE datname = current_database()
      `);

      return this.getStatus(key, true, {
        latencyMs,
        database: dbStats.db_name,
        sizeBytes: parseInt(dbStats.db_size_bytes, 10),
        sizeMB: (parseInt(dbStats.db_size_bytes, 10) / 1024 / 1024).toFixed(2),
        serverStartedAt: dbStats.server_started_at,
        version: versionRow.version,
        connections: {
          total: parseInt(connectionStats.total_connections, 10),
          active: parseInt(connectionStats.active_connections, 10),
          idle: parseInt(connectionStats.idle_connections, 10),
        },
        orm: {
          isConnected: this.dataSource.isInitialized,
          driver: this.dataSource.options.type,
        },
      });
    } catch (err) {
      throw new HealthCheckError(
        'Database health check failed',
        this.getStatus(key, false, { error: (err as Error).message }),
      );
    }
  }
}
