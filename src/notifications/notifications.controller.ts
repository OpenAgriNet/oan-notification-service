import {
  Body, Controller, Get, HttpCode, Post, Query,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { NotificationsService } from './notifications.service';
import { GetAdvisoryDto } from './dto/get-advisory.dto';
import { GetAllAdvisoryDto } from './dto/get-all-advisory.dto';

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

  /**
   * POST /api/notification/upload
   * Multipart form-data: file (CSV or XLSX)
   * Parses rows and bulk-inserts into advisory_notifications with template_abbreviation = '2bin_v2_bv'.
   */
  @Post('upload')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    }),
  )
  uploadAdvisories(@UploadedFile() file: Express.Multer.File) {
    return this.notificationsService.uploadAdvisories(file);
  }

  /**
   * GET /api/notification/all
   * Query params: lang?, state_code?, from_date?, to_date?, active_only?, page?, limit?
   * Returns all advisory notifications joined with subdistrict centroid lat/lon.
   * Suitable for table and map views — always reflects the latest ingested data.
   */
  @Get('all')
  getAllAdvisories(@Query() query: GetAllAdvisoryDto) {
    return this.notificationsService.getAllAdvisories(query);
  }

  /**
   * GET /api/notification/counts
   * Returns total, weather_advisory, and general notification counts.
   */
  @Get('counts')
  getAdvisoryCounts() {
    return this.notificationsService.getAdvisoryCounts();
  }
}
