import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AdvisoryNotification } from './entities/advisory-notification.entity';
import { GenericMessage } from './entities/generic-message.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AdvisoryNotification, GenericMessage])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
