import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AdvisoryNotification } from './entities/advisory-notification.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AdvisoryNotification])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
