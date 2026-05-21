import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { SystemHealthIndicator } from './indicators/system.health';

@Module({
  imports: [
    TerminusModule,
    TypeOrmModule,
  ],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, SystemHealthIndicator],
})
export class HealthModule {}
