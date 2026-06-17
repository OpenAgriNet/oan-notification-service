import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { GetAdvisoryDto } from './dto/get-advisory.dto';
import { GetAllAdvisoryDto } from './dto/get-all-advisory.dto';
import { NotificationType } from './enums/notification-type.enum';
import { Priority } from './enums/priority.enum';
import { classifyNotification } from './utils/notification-type.classifier';
import { derivePriority } from './utils/priority.classifier';

interface InsertRow {
  uniqueIdIitm: number;
  subdistrictCode: number;
  subdistrictName: string | null;
  districtCode: number;
  districtName: string | null;
  stateCode: number;
  stateName: string | null;
  langAbb: string;
  forecastMessage: string | null;
  fromDate: string;
  toDate: string;
}

interface AllAdvisoryRow extends AdvisoryRow {
  lat: number | null;
  lon: number | null;
  is_active: boolean;
}

interface AdvisoryRow {
  message_id: string;
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

interface GenericMessageRow {
  message_id: string;
  message_type: string;
  message: string;
  lang_abb: string;
  from_date: string;
  to_date: string;
  created_at: Date;
}

interface SubdistrictMatch {
  iitm_id: string;
  distance_meters: number;
  distance_km: number;
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
    private readonly configService: ConfigService,
    @InjectPinoLogger(NotificationsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async getNearestNotifications(dto: GetAdvisoryDto) {
    const visitorId = dto.visitor_id ?? null;
    const radiusKm = this.getNotificationRadiusKm();

    this.logger.debug(
      { lat: dto.lat, lon: dto.lon, lang: dto.lang, radiusKm },
      '[STEP 0] Request received',
    );

    try {
      this.logger.debug(
        { lon: dto.lon, lat: dto.lat, radiusKm, lang: dto.lang },
        '[STEP 1] Querying subdistricts and generic_messages in parallel',
      );

      const [subdistricts, genericRows] = await Promise.all([
        this.findMatchingSubdistricts(dto.lon, dto.lat, radiusKm),
        this.fetchActiveGenericMessages(dto.lang),
      ]);

      let weatherRows: AdvisoryRow[] = [];

      if (!subdistricts.length) {
        this.logger.warn(
          { lat: dto.lat, lon: dto.lon, radiusKm },
          '[STEP 1] No subdistrict polygon found — skipping weather advisories',
        );
      } else {
        const iitmIds = subdistricts.map((subdistrict) => subdistrict.iitm_id);
        this.logger.debug(
          { iitmIds, radiusKm, subdistrictsFound: subdistricts.length },
          '[STEP 1] Subdistrict iitm_ids resolved',
        );

        this.logger.debug(
          { iitmIds, lang: dto.lang, radiusKm },
          '[STEP 2] Querying advisory_notifications',
        );

        weatherRows = await this.fetchActiveWeatherAdvisories(iitmIds, dto.lang);

        this.logger.debug(
          { iitmIds, rowsFound: weatherRows.length, langs: weatherRows.map((r) => r.lang_abb) },
          '[STEP 2] advisory_notifications result',
        );
      }

      this.logger.debug(
        { rowsFound: genericRows.length, lang: dto.lang },
        '[STEP 3] generic_messages result',
      );

      const notifications = [
        ...weatherRows.map((row) => this.toNotificationItem(row)),
        ...genericRows.map((row) => this.toGenericNotificationItem(row)),
      ];

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

  async getAllAdvisories(dto: GetAllAdvisoryDto) {
    const unpaginated = dto.limit === 0;
    const limit  = unpaginated ? 20_000 : (dto.limit ?? 100);
    const page   = unpaginated ? 1 : (dto.page ?? 1);
    const offset = unpaginated ? 0 : (page - 1) * limit;

    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    if (dto.lang) {
      filterParams.push(dto.lang);
      conditions.push(`LOWER(an.lang_abb) = LOWER($${filterParams.length})`);
    }

    if (dto.state_code !== undefined) {
      filterParams.push(dto.state_code);
      conditions.push(`an.state_code = $${filterParams.length}`);
    }

    if (dto.from_date) {
      filterParams.push(dto.from_date);
      conditions.push(`an.from_date >= $${filterParams.length}`);
    }

    if (dto.to_date) {
      filterParams.push(dto.to_date);
      conditions.push(`an.to_date <= $${filterParams.length}`);
    }

    if (dto.active_only) {
      conditions.push('an.from_date <= CURRENT_DATE AND an.to_date >= CURRENT_DATE');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Build paginated query params (filter params + limit + offset)
    const dataParams = [...filterParams, limit, offset];
    const limitParam  = dataParams.length - 1;
    const offsetParam = dataParams.length;

    try {
      const [rows, countResult] = await Promise.all([
        this.dataSource.query<AllAdvisoryRow[]>(
          `
          SELECT
            an.message_id,
            an.unique_id_iitm,
            an.subdistrict_code,
            an.subdistrict_name,
            an.district_code,
            an.district_name,
            an.state_code,
            an.state_name,
            an.lang_abb,
            an.forecast_message,
            an.template_abbreviation,
            an.from_date,
            an.to_date,
            an.created_at,
            (an.from_date <= CURRENT_DATE AND an.to_date >= CURRENT_DATE) AS is_active,
            ST_Y(ST_Transform(ST_Centroid(s.geom), 4326)) AS lat,
            ST_X(ST_Transform(ST_Centroid(s.geom), 4326)) AS lon
          FROM advisory_notifications an
          LEFT JOIN subdistricts s ON s.iitm_id::text = an.unique_id_iitm::text
          ${where}
          ORDER BY an.created_at DESC
          LIMIT $${limitParam} OFFSET $${offsetParam}
          `,
          dataParams,
        ),
        this.dataSource.query<{ total: string }[]>(
          `SELECT COUNT(*) AS total FROM advisory_notifications an ${where}`,
          filterParams,
        ),
      ]);

      const total = parseInt(countResult[0]?.total ?? '0', 10);

      return {
        success:      true,
        total,
        page:         unpaginated ? null : page,
        limit:        unpaginated ? null : limit,
        pages:        unpaginated ? null : Math.ceil(total / limit),
        unpaginated,
        data:         rows.map((row) => this.toAllAdvisoryItem(row)),
        error:        null,
      };
    } catch (err) {
      this.logger.error({ err }, 'Failed to fetch all advisories');
      return {
        success:    false,
        total:      0,
        page:       unpaginated ? null : page,
        limit:      unpaginated ? null : limit,
        pages:      unpaginated ? null : 0,
        unpaginated,
        data:       [],
        error: {
          code:    'DB_ERROR',
          message: (err as Error).message,
        },
      };
    }
  }

  async getAdvisoryCounts() {
    const weatherPattern =
      'rain|bv|bin|precip|cyclone|flood|storm|thunder|wind|humid|temp|heat|cold|fog|frost|drizzle|monsoon|season|kharif|rabi|onset|withdrawal';

    try {
      const [[result], langRows] = await Promise.all([
        this.dataSource.query<
          { total: string; weather_advisory: string; general: string; states: string; districts: string; subdistricts: string }[]
        >(
          `
          SELECT
            COUNT(*)                                                                    AS total,
            COUNT(*) FILTER (WHERE template_abbreviation ~* $1)                        AS weather_advisory,
            COUNT(*) FILTER (WHERE template_abbreviation IS NULL
                                OR template_abbreviation !~* $1)                       AS general,
            COUNT(DISTINCT state_code)                                                  AS states,
            COUNT(DISTINCT district_code)                                               AS districts,
            COUNT(DISTINCT subdistrict_code)                                            AS subdistricts
          FROM advisory_notifications
          `,
          [weatherPattern],
        ),
        this.dataSource.query<{ lang_abb: string; count: string }[]>(
          `
          SELECT lang_abb, COUNT(*) AS count
          FROM advisory_notifications
          GROUP BY lang_abb
          ORDER BY count DESC
          `,
        ),
      ]);

      const by_language = Object.fromEntries(
        langRows.map((r) => [r.lang_abb?.trim(), parseInt(r.count, 10)]),
      );

      return {
        success: true,
        data: {
          total:             parseInt(result.total, 10),
          weather_advisory:  parseInt(result.weather_advisory, 10),
          general:           parseInt(result.general, 10),
          states:            parseInt(result.states, 10),
          districts:         parseInt(result.districts, 10),
          subdistricts:      parseInt(result.subdistricts, 10),
          by_language,
        },
        error: null,
      };
    } catch (err) {
      this.logger.error({ err }, 'Failed to fetch advisory counts');
      return {
        success: false,
        data:    null,
        error: {
          code:    'DB_ERROR',
          message: (err as Error).message,
        },
      };
    }
  }

  // ─── private helpers ────────────────────────────────────────────────────────

  private async fetchActiveWeatherAdvisories(
    iitmIds: string[],
    lang: string,
  ): Promise<AdvisoryRow[]> {
    return this.dataSource.query(
      `
      SELECT
        message_id,
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
        AND LOWER(TRIM(lang_abb)) = LOWER($2)
        AND from_date <= CURRENT_DATE
        AND to_date   >= CURRENT_DATE
      ORDER BY array_position($1::text[], unique_id_iitm::text), created_at DESC
      LIMIT 2
      `,
      [iitmIds, lang],
    );
  }

  private async fetchActiveGenericMessages(lang: string): Promise<GenericMessageRow[]> {
    return this.dataSource.query(
      `
      SELECT
        message_id,
        message_type,
        message,
        lang_abb,
        from_date,
        to_date,
        created_at
      FROM generic_messages
      WHERE
        LOWER(TRIM(lang_abb)) = ANY($1::text[])
        AND from_date <= CURRENT_DATE
        AND to_date   >= CURRENT_DATE
      ORDER BY created_at DESC
      `,
      [this.resolveLangAbbVariants(lang)],
    );
  }

  private resolveLangAbbVariants(lang: string): string[] {
    const normalized = lang.toLowerCase().trim();
    const aliases: Record<string, string[]> = {
      en: ['en', 'eng'],
      hi: ['hi', 'hin'],
    };

    return aliases[normalized] ?? [normalized];
  }

  private async findMatchingSubdistricts(
    lon: number,
    lat: number,
    radiusKm: number,
  ): Promise<SubdistrictMatch[]> {
    const pointSql = 'ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3857)';

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
      SELECT iitm_id, distance_meters, ROUND((distance_meters / 1000)::numeric, 2) AS distance_km
      FROM matches
      ORDER BY distance_meters ASC
      `,
      [lon, lat, radiusKm * 1000],
    );
  }

  private getNotificationRadiusKm(): number {
    const radiusKm = this.configService.get<number>('app.notificationRadiusKm', 2);
    return Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 2;
  }

  private toGenericNotificationItem(row: GenericMessageRow): NotificationItem {
    return {
      notification_id: row.message_id,
      type:            NotificationType.GENERAL,
      priority:        Priority.LOW,
      valid_from:      row.from_date,
      valid_to:        row.to_date,
      created_at:      new Date(row.created_at).toISOString(),
      content: {
        title: 'General Notification',
        body:  row.message,
      },
      location: null,
      metadata: {
        message_type: row.message_type,
      },
    };
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
      },
    };
  }

  async uploadAdvisories(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');

    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    let rawRows: Record<string, unknown>[];

    try {
      if (ext === 'csv' || file.mimetype === 'text/csv' || file.mimetype === 'text/plain') {
        rawRows = parseCsv(file.buffer.toString('utf8'), {
          columns: true,
          skip_empty_lines: true,
          relax_quotes: true,
        }) as Record<string, unknown>[];
      } else if (ext === 'xlsx' || ext === 'xls') {
        const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
      } else {
        throw new BadRequestException('Unsupported file type. Upload a CSV or XLSX file.');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      return {
        success: false,
        summary: { total: 0, inserted: 0, skipped: 0, errors: [`Parse error: ${(err as Error).message}`] },
        error: { code: 'PARSE_ERROR', message: (err as Error).message },
      };
    }

    const validRows: InsertRow[] = [];
    const parseErrors: string[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNum = i + 2;
      try {
        const iitm = parseInt(String(row['unique_id_iitm'] ?? ''), 10);
        if (isNaN(iitm)) { parseErrors.push(`Row ${rowNum}: missing unique_id_iitm`); continue; }

        const sdCode = parseInt(String(row['subdistrict_code'] ?? row['subdist_code_dbf'] ?? ''), 10);
        if (isNaN(sdCode)) { parseErrors.push(`Row ${rowNum}: missing subdistrict_code`); continue; }

        const dCode = parseInt(String(row['district_code'] ?? row['dist_code_dbf'] ?? ''), 10);
        if (isNaN(dCode)) { parseErrors.push(`Row ${rowNum}: missing district_code`); continue; }

        const sCode = parseInt(String(row['state_code'] ?? row['state_code_dbf'] ?? ''), 10);
        if (isNaN(sCode)) { parseErrors.push(`Row ${rowNum}: missing state_code`); continue; }

        const lang = String(row['lang_abb'] ?? '').trim();
        if (!lang) { parseErrors.push(`Row ${rowNum}: missing lang_abb`); continue; }

        validRows.push({
          uniqueIdIitm:     iitm,
          subdistrictCode:  sdCode,
          subdistrictName:  this.strOrNull(row['subdistrict_name'] ?? row['subdist_name_dbf']),
          districtCode:     dCode,
          districtName:     this.strOrNull(row['district_name'] ?? row['dist_name_dbf']),
          stateCode:        sCode,
          stateName:        this.strOrNull(row['state_name'] ?? row['state_name_dbf']),
          langAbb:          lang,
          forecastMessage:  this.strOrNull(row['forecast_message']),
          fromDate:         this.parseDate(row['from_date']),
          toDate:           this.parseDate(row['to_date']),
        });
      } catch (err) {
        parseErrors.push(`Row ${rowNum}: ${(err as Error).message}`);
      }
    }

    if (!validRows.length) {
      return {
        success: false,
        summary: { total: rawRows.length, inserted: 0, skipped: rawRows.length, errors: parseErrors },
        error: { code: 'NO_VALID_ROWS', message: 'No valid rows to insert' },
      };
    }

    try {
      const inserted = await this.bulkInsertAdvisories(validRows);
      return {
        success: true,
        summary: { total: rawRows.length, inserted, skipped: rawRows.length - validRows.length, errors: parseErrors },
        error: null,
      };
    } catch (err) {
      this.logger.error({ err }, 'Bulk insert from upload failed');
      return {
        success: false,
        summary: { total: rawRows.length, inserted: 0, skipped: rawRows.length - validRows.length, errors: parseErrors },
        error: { code: 'DB_ERROR', message: (err as Error).message },
      };
    }
  }

  private async bulkInsertAdvisories(rows: InsertRow[]): Promise<number> {
    const result = await this.dataSource.query<{ message_id: string }[]>(
      `
      INSERT INTO advisory_notifications
        (message_id, unique_id_iitm, subdistrict_code, subdistrict_name,
         district_code, district_name, state_code, state_name,
         lang_abb, forecast_message, template_abbreviation,
         from_date, to_date, created_at)
      SELECT
        gen_random_uuid(),
        u.iitm, u.sd_code, u.sd_name,
        u.d_code, u.d_name,
        u.s_code, u.s_name,
        u.lang, u.msg,
        '2bin_v2_bv',
        u.from_d, u.to_d,
        NOW()
      FROM unnest(
        $1::bigint[], $2::integer[], $3::text[],
        $4::integer[], $5::text[],
        $6::integer[], $7::text[],
        $8::text[], $9::text[],
        $10::date[], $11::date[]
      ) AS u(iitm, sd_code, sd_name, d_code, d_name, s_code, s_name, lang, msg, from_d, to_d)
      ON CONFLICT DO NOTHING
      RETURNING message_id
      `,
      [
        rows.map(r => r.uniqueIdIitm),
        rows.map(r => r.subdistrictCode),
        rows.map(r => r.subdistrictName),
        rows.map(r => r.districtCode),
        rows.map(r => r.districtName),
        rows.map(r => r.stateCode),
        rows.map(r => r.stateName),
        rows.map(r => r.langAbb),
        rows.map(r => r.forecastMessage),
        rows.map(r => r.fromDate),
        rows.map(r => r.toDate),
      ],
    );
    return result.length;
  }

  private parseDate(val: unknown): string {
    if (val instanceof Date) return val.toISOString().split('T')[0];
    const str = String(val ?? '').trim();
    if (!str) throw new Error('missing date');
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const parts = str.split(/[-\/]/);
    if (parts.length === 3 && parts[2].length === 4) {
      const [d, m, y] = parts;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    throw new Error(`invalid date format: "${str}"`);
  }

  private strOrNull(val: unknown): string | null {
    if (val === null || val === undefined) return null;
    const s = String(val).trim();
    return s || null;
  }

  private buildTitle(type: NotificationType, subdistrictName: string | null): string {
    const location = subdistrictName ?? '';
    if (type === NotificationType.WEATHER_ADVISORY) {
      return location ? `Weather Advisory - ${location}` : 'Weather Advisory';
    }
    return 'General Notification';
  }

  private toAllAdvisoryItem(row: AllAdvisoryRow) {
    const type     = classifyNotification(row.template_abbreviation);
    const priority = derivePriority(type);

    return {
      message_id:            row.message_id,
      unique_id_iitm:        row.unique_id_iitm,
      subdistrict_code:      row.subdistrict_code,
      subdistrict_name:      row.subdistrict_name,
      district_code:         row.district_code,
      district_name:         row.district_name,
      state_code:            row.state_code,
      state_name:            row.state_name,
      lang:                  row.lang_abb?.trim(),
      forecast_message:      row.forecast_message,
      template:              row.template_abbreviation,
      type,
      priority,
      valid_from:            row.from_date,
      valid_to:              row.to_date,
      created_at:            new Date(row.created_at).toISOString(),
      is_active:             row.is_active,
      lat:                   row.lat !== null ? Number(row.lat) : null,
      lon:                   row.lon !== null ? Number(row.lon) : null,
    };
  }

}
