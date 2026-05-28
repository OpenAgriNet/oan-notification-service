import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  logLevel: process.env.LOG_LEVEL ?? 'debug',
  notificationRadiusKm: parseFloat(process.env.NOTIFICATION_RADIUS_KM ?? '0'),
}));
