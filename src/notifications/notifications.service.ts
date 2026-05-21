import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { GetAdvisoryDto } from './dto/get-advisory.dto';
import { NotificationType } from './enums/notification-type.enum';
import { Priority } from './enums/priority.enum';
import { classifyNotification } from './utils/notification-type.classifier';
import { derivePriority } from './utils/priority.classifier';
import { RedisService } from '../redis/redis.service';

interface WeekRange {
  start: string;
  end: string;
}

interface AdvisoryRow {
  message_id: string;
  unique_id_pm_kisan: number;
  unique_id_iitm: string;
  subdistrict_code: number;
  subdistrict_name: string | null;
  district_code: number;
  district_name: string | null;
  state_code: number;
  state_name: string | null;
  lang_abb: string;
  forecast_message: string | null;
  template_abbreviation: string | null;
  lat: string | null;
  lon: string | null;
  from_date: string;
  to_date: string;
  created_at: Date;
}

export interface NotificationItem {
  notification_id: string;
  type: NotificationType;
  priority: Priority;
  valid_from: string;
  valid_to: string;
  created_at: string;
  content: {
    title: string;
    body: string | null;
  };
  location: {
    subdistrict_name: string | null;
    district_name: string | null;
    state_name: string | null;
  } | null;
  metadata: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    @InjectPinoLogger(NotificationsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async getNearestNotifications(dto: GetAdvisoryDto) {
    const week = this.getCurrentWeek();
    const visitorId = dto.visitor_id ?? null;

    // Validate client-supplied seen IDs against Redis — only exclude IDs we
    // actually served to this visitor, preventing arbitrary exclusion.
    let excludeIds: string[] = [];
    if (visitorId && dto.seen_message_ids?.length) {
      excludeIds = await this.redisService.validateSeenMessages(
        visitorId,
        dto.seen_message_ids,
      );
      this.logger.debug(
        { visitorId, requested: dto.seen_message_ids.length, validated: excludeIds.length },
        'Validated seen message IDs',
      );
    }

    this.logger.debug(
      { lat: dto.lat, lon: dto.lon, lang: dto.lang, week, excludeIds },
      'Fetching nearest notifications',
    );

    try {
      // Step 1: resolve subdistrict + iitm_id from lat/lon
      const subdistrict: { iitm_id: string }[] = await this.dataSource.query(
        `
        SELECT iitm_id::text
        FROM subdistricts
        WHERE ST_Intersects(
          geom,
          ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3857)
        )
        LIMIT 1
        `,
        [dto.lon, dto.lat],
      );

      if (!subdistrict.length) {
        this.logger.debug(
          { lat: dto.lat, lon: dto.lon },
          'No subdistrict found for coordinates',
        );
        return {
          success: true,
          recipient: {
            visitor_id: visitorId,
            lang_code:  dto.lang.toLowerCase(),
            lat:        dto.lat,
            lon:        dto.lon,
          },
          count:         0,
          notifications: [],
          error:         null,
        };
      }

      const iitmId = subdistrict[0].iitm_id;
      this.logger.debug({ iitmId }, 'Resolved iitm_id from subdistrict');

      // Step 2: fetch advisories by iitm_id + lang (case-insensitive) + date range
      const rows: AdvisoryRow[] = await this.dataSource.query(
        `
        SELECT
          message_id,
          unique_id_pm_kisan,
          unique_id_iitm,
          subdistrict_code,
          subdistrict_name,
          district_code,
          district_name,
          state_code,
          state_name,
          lang_abb,
          forecast_message,
          template_abbreviation,
          lat,
          lon,
          from_date,
          to_date,
          created_at
        FROM advisory_notifications
        WHERE
          unique_id_iitm = $1
          AND LOWER(lang_abb) = LOWER($2)
          AND from_date      <= $3::date
          AND to_date        >= $4::date
          AND ($5::uuid[] IS NULL OR message_id != ALL($5::uuid[]))
        ORDER BY created_at DESC
        LIMIT 5
        `,
        [
          iitmId,
          dto.lang,
          week.end,
          week.start,
          excludeIds.length ? excludeIds : null,
        ],
      );

      const notifications = rows.map((row) => this.toNotificationItem(row));

      // Cache the IDs we just served so future requests can validate seen IDs
      if (visitorId && notifications.length) {
        await this.redisService.addLoadedMessages(
          visitorId,
          notifications.map((n) => n.notification_id),
        );
      }

      return {
        success: true,
        recipient: {
          visitor_id: visitorId,
          lang_code:  dto.lang.toLowerCase(),
          lat:        dto.lat,
          lon:        dto.lon,
        },
        count:         notifications.length,
        notifications,
        error:         null,
      };
    } catch (err) {
      this.logger.error({ err }, 'Failed to fetch notifications');
      return {
        success: false,
        recipient: {
          visitor_id: visitorId,
          lang_code:  dto.lang.toLowerCase(),
          lat:        dto.lat,
          lon:        dto.lon,
        },
        count:         0,
        notifications: [],
        error: {
          code:    'DB_ERROR',
          message: (err as Error).message,
        },
      };
    }
  }

  // ─── private helpers ────────────────────────────────────────────────────────

  private toNotificationItem(row: AdvisoryRow): NotificationItem {
    const type            = classifyNotification(row.template_abbreviation);
    const priority        = derivePriority(type);
    const isLocationBased = type === NotificationType.WEATHER_ADVISORY;

    return {
      notification_id: row.message_id,
      type,
      priority,
      valid_from:  row.from_date,
      valid_to:    row.to_date,
      created_at:  new Date(row.created_at).toISOString(),
      content: {
        title: this.buildTitle(type, row.subdistrict_name),
        body:  row.forecast_message,
      },
      location: isLocationBased
        ? {
            subdistrict_name: row.subdistrict_name,
            district_name:    row.district_name,
            state_name:       row.state_name,
          }
        : null,
      metadata: {
        source:             'IITM',
        template:           row.template_abbreviation,
        unique_id_iitm:     row.unique_id_iitm,
        unique_id_pm_kisan: row.unique_id_pm_kisan,
      },
    };
  }

  private buildTitle(type: NotificationType, subdistrictName: string | null): string {
    const location = subdistrictName ?? '';
    if (type === NotificationType.WEATHER_ADVISORY) {
      return location ? `Weather Advisory - ${location}` : 'Weather Advisory';
    }
    return 'General Notification';
  }

  private getCurrentWeek(): WeekRange {
    const today    = new Date();
    const sunday   = new Date(today);
    sunday.setDate(today.getDate() - today.getDay());
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    return {
      start: sunday.toISOString().slice(0, 10),
      end:   saturday.toISOString().slice(0, 10),
    };
  }
}
