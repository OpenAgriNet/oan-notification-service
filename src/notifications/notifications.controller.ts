import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { GetAdvisoryDto } from './dto/get-advisory.dto';

@Controller('notification')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * POST /api/notification
   * Body: { user_id?, lat, lon, lang, seen_message_ids? }
   */
  @Post()
  @HttpCode(200)
  getNotifications(@Body() body: GetAdvisoryDto) {
    return this.notificationsService.getNearestNotifications(body);
  }
}
