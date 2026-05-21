import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import { validationSchema } from './config/validation.schema';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig],
      validationSchema,
      validationOptions: { abortEarly: false },
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: () => ({
        pinoHttp: {
          level: process.env.LOG_LEVEL ?? 'debug',
          transport:
            process.env.NODE_ENV !== 'production'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          serializers: {
            req(req: { method: string; url: string }) {
              return { method: req.method, url: req.url };
            },
          },
          redact: ['req.headers.authorization'],
        },
      }),
    }),
    DatabaseModule,
    RedisModule,
    HealthModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService, AllExceptionsFilter, LoggingInterceptor],
})
export class AppModule {}
