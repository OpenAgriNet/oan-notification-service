import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  from_date: string;
  to_date: string;
  created_at: Date;
}

interface SubdistrictMatch {
  iitm_id: string;
  distance_meters: number;
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
    private readonly configService: ConfigService,
    @InjectPinoLogger(NotificationsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async getNearestNotifications(dto: GetAdvisoryDto) {
    const week = this.getCurrentWeek();
    const visitorId = dto.visitor_id ?? null;
    const radiusKm = this.getNotificationRadiusKm();

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
      { lat: dto.lat, lon: dto.lon, lang: dto.lang, week, excludeIds, radiusKm },
      '[STEP 0] Request received',
    );

    try {
      // Step 1: resolve subdistrict(s) + iitm_id(s) from lat/lon
      this.logger.debug(
        { lon: dto.lon, lat: dto.lat, radiusKm },
        '[STEP 1] Querying subdistricts for lat/lon',
      );

      const subdistricts = await this.findMatchingSubdistricts(
        dto.lon,
        dto.lat,
        radiusKm,
      );

      if (!subdistricts.length) {
        this.logger.warn(
          { lat: dto.lat, lon: dto.lon, radiusKm },
          '[STEP 1] FAILED — no subdistrict polygon found for coordinates',
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

      const iitmIds = subdistricts.map((subdistrict) => subdistrict.iitm_id);
      this.logger.debug(
        { iitmIds, radiusKm, subdistrictsFound: subdistricts.length },
        '[STEP 1] SUCCESS — subdistrict iitm_ids resolved',
      );

      // Step 2: fetch advisories by iitm_id(s) + lang + date range
      this.logger.debug(
        {
          iitmIds,
          lang: dto.lang,
          weekStart: week.start,
          weekEnd: week.end,
          excludeIds,
          radiusKm,
        },
        '[STEP 2] Querying advisory_notifications',
      );

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
          from_date,
          to_date,
          created_at
        FROM advisory_notifications
        WHERE
          unique_id_iitm::text = ANY($1::text[])
          AND LOWER(lang_abb) = LOWER($2)
          AND from_date      <= $3::date
          AND to_date        >= $4::date
          AND ($5::uuid[] IS NULL OR message_id != ALL($5::uuid[]))
        ORDER BY array_position($1::text[], unique_id_iitm::text), created_at DESC
        LIMIT 5
        `,
        [
          iitmIds,
          dto.lang,
          week.end,
          week.start,
          excludeIds.length ? excludeIds : null,
        ],
      );

      this.logger.debug(
        { iitmIds, rowsFound: rows.length, langs: rows.map(r => r.lang_abb) },
        '[STEP 2] advisory_notifications result',
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

  private async findMatchingSubdistricts(
    lon: number,
    lat: number,
    radiusKm: number,
  ): Promise<SubdistrictMatch[]> {
    const pointSql = 'ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3857)';

    if (radiusKm <= 0) {
      return this.dataSource.query(
        `
        SELECT iitm_id::text, 0::double precision AS distance_meters
        FROM subdistricts
        WHERE ST_Intersects(
          geom,
          ${pointSql}
        )
        LIMIT 1
        `,
        [lon, lat],
      );
    }

    return this.dataSource.query(
      `
      WITH request_point AS (
        SELECT ${pointSql} AS geom
      ),
      matches AS (
        SELECT DISTINCT ON (s.iitm_id)
          s.iitm_id::text,
          ST_Distance(s.geom, p.geom) AS distance_meters
        FROM subdistricts s
        CROSS JOIN request_point p
        WHERE ST_DWithin(s.geom, p.geom, $3)
        ORDER BY s.iitm_id, distance_meters ASC
      )
      SELECT iitm_id, distance_meters
      FROM matches
      ORDER BY distance_meters ASC
      `,
      [lon, lat, radiusKm * 1000],
    );
  }

  private getNotificationRadiusKm(): number {
    const radiusKm = this.configService.get<number>('app.notificationRadiusKm', 0);
    return Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 0;
  }

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
