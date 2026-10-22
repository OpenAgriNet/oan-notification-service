/**
 * IMD district agromet advisory for the bell: location -> resolver keys -> imd_agromet DB.
 * Nothing is stored here.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import axios from 'axios';
import { DataSource } from 'typeorm';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { NotificationType } from './enums/notification-type.enum';
import { Priority } from './enums/priority.enum';
import type { NotificationItem } from './notifications.service';

interface LookupRow {
  id: string;
  custom_date: string;
  district_name: string | null;
  crop: string | null;
  advisory_eng: string | null;
  advisory_reg: string | null;
}

interface LookupResponse {
  districts: { lgd_district_code: number; name: string | null }[];
  date: string | null;
  valid_until: string | null;
  advisories: LookupRow[];
}

const POINT_RADIUS_KM = 0.1;
const POINT_CACHE_MS = 30 * 24 * 3600 * 1000;
const SIGNATURE_MAX_AGE_S = 300;

/** "2026-10-15" -> "15 Oct 2026" */
function displayDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Same bulletin + district -> same UUID v4-shaped id (the UI sends seen ids back; the DTO requires UUID v4). */
function stableUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

@Injectable()
export class ImdAgrometService {
  private readonly enabled =
    (process.env.IMD_AGROMET_ENABLED ?? 'true').toLowerCase() !== 'false';
  private readonly resolverUrl = (process.env.RESOLVER_URL ?? '').replace(
    /\/$/,
    '',
  );
  private readonly callbackUrl = process.env.RESOLVER_CALLBACK_URL ?? '';
  private readonly apiKey = process.env.RESOLVER_API_KEY ?? '';
  private readonly subscriberId =
    process.env.RESOLVER_SUBSCRIBER_ID || undefined;
  private readonly imdDbUrl = process.env.IMD_DB_URL;
  private imdDb: Promise<DataSource> | null = null;
  private readonly waitMs = parseInt(
    process.env.RESOLVER_WAIT_MS ?? '5000',
    10,
  );

  private readonly pending = new Map<
    string,
    (answer: { status?: string; keys: string[] }) => void
  >();
  private readonly pointCache = new Map<
    string,
    { keys: string[]; expires: number }
  >();

  constructor(
    @InjectPinoLogger(ImdAgrometService.name)
    private readonly logger: PinoLogger,
  ) {
    if (this.enabled && !this.configured) {
      this.logger.warn(
        '[IMD] RESOLVER_URL, RESOLVER_CALLBACK_URL and IMD_DB_URL must be set; IMD bell item is off',
      );
    }
  }

  private get configured(): boolean {
    return Boolean(this.resolverUrl && this.callbackUrl && this.imdDbUrl);
  }

  /** Resolver callback (POST /api/notification/resolver/on_resolve). */
  onResolve(raw: Buffer | undefined, timestamp?: string, signature?: string) {
    if (!raw?.length) throw new BadRequestException('Empty body.');
    if (!this.validSignature(raw, timestamp, signature)) {
      this.logger.warn(
        '[IMD] resolver callback rejected: bad or missing signature',
      );
      throw new UnauthorizedException('Invalid resolver signature.');
    }
    let body: { ref?: unknown; status?: string; cells?: { key?: string }[] };
    try {
      body = JSON.parse(raw.toString('utf8')) as typeof body;
    } catch {
      throw new BadRequestException('Body must be JSON.');
    }
    const done =
      typeof body?.ref === 'string' ? this.pending.get(body.ref) : undefined;
    if (!done) throw new NotFoundException('Unknown ref.');
    const keys = (Array.isArray(body.cells) ? body.cells : [])
      .map((c) => c?.key)
      .filter((k): k is string => !!k);
    done({ status: body.status, keys });
    return { ok: true };
  }

  /** HMAC-SHA256(RESOLVER_API_KEY, "<timestamp>." + raw body) = "sha256=<hex>", at most 5 minutes old. */
  private validSignature(
    raw: Buffer,
    timestamp?: string,
    signature?: string,
  ): boolean {
    if (!this.apiKey) return true; // resolver running without keys (local development only)
    if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_MAX_AGE_S)
      return false;
    const good = Buffer.from(
      'sha256=' +
        createHmac('sha256', this.apiKey)
          .update(`${timestamp}.`)
          .update(raw)
          .digest('hex'),
    );
    const got = Buffer.from(signature);
    return got.length === good.length && timingSafeEqual(got, good);
  }

  /** Never throws: on any problem the bell simply shows no IMD item. */
  async getNotifications(
    lat: number,
    lon: number,
  ): Promise<NotificationItem[]> {
    if (!this.enabled || !this.configured) return [];
    try {
      const keys = await this.locationKeys(lat, lon);
      if (!keys?.length) return [];
      const data = await this.lookup(keys);
      const item = this.toItem(data);
      return item ? [item] : [];
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message },
        '[IMD] agromet advisory skipped',
      );
      return [];
    }
  }

  /** imd_lookup() on the imd_agromet DB. */
  private async lookup(keys: string[]): Promise<LookupResponse> {
    if (!this.imdDbUrl) throw new Error('IMD_DB_URL is not set');
    if (!this.imdDb) {
      this.imdDb = new DataSource({
        type: 'postgres',
        url: this.imdDbUrl,
        extra: { max: 4, connectionTimeoutMillis: 5000 },
      })
        .initialize()
        .catch((err) => {
          this.imdDb = null;
          throw err;
        });
    }
    const db = await this.imdDb;
    const rows: { r: LookupResponse }[] = await db.query(
      'SELECT imd_lookup($1::text[]) AS r',
      [keys],
    );
    return rows[0].r;
  }

  private async locationKeys(
    lat: number,
    lon: number,
  ): Promise<string[] | null> {
    const point = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const cached = this.pointCache.get(point);
    if (cached && cached.expires > Date.now()) return cached.keys;

    const ref = `bvn-${randomUUID()}`;
    const answer = new Promise<{ status?: string; keys: string[] } | null>(
      (resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(ref);
          resolve(null);
        }, this.waitMs);
        this.pending.set(ref, (a) => {
          clearTimeout(timer);
          this.pending.delete(ref);
          resolve(a);
        });
      },
    );
    await axios.post(
      `${this.resolverUrl}/resolver/v1/resolve`,
      {
        ref,
        callback_url: this.callbackUrl,
        ...(this.subscriberId ? { subscriber_id: this.subscriberId } : {}),
        area: {
          method: 'point_radius',
          input: { lat, lon, radius_km: POINT_RADIUS_KM },
        },
      },
      {
        timeout: 5000,
        headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {},
      },
    );
    const result = await answer;
    if (!result || result.status !== 'ok' || !result.keys.length) {
      this.logger.warn(
        { ref, status: result?.status ?? 'timeout' },
        '[IMD] no keys from resolver',
      );
      return null;
    }
    this.pointCache.set(point, {
      keys: result.keys,
      expires: Date.now() + POINT_CACHE_MS,
    });
    return result.keys;
  }

  private toItem(data: LookupResponse): NotificationItem | null {
    const rows = data.advisories ?? [];
    if (!rows.length || !data.date || !data.valid_until) return null;

    const crops = [
      ...new Set(rows.map((r) => r.crop).filter((c): c is string => !!c)),
    ];
    const unnamed = rows.filter((r) => !r.crop).length;
    const cropsLine = crops.length
      ? `Crop advisories available for: ${crops.join(', ')}.`
      : 'Crop advisories are available for your district.';
    const validityLine = `(Source: IMD Agromet · Issued ${displayDate(data.date)} · Valid until ${displayDate(data.valid_until)}, 11:59 PM)`;
    const body = `${cropsLine}\n\n${validityLine}`;

    const district =
      data.districts
        .map((d) => d.name)
        .filter(Boolean)
        .join(', ') || null;

    return {
      notification_id: stableUuid(
        `imd-${data.date}-${data.districts.map((d) => d.lgd_district_code).join('-')}`,
      ),
      type: NotificationType.AGROMET_ADVISORY,
      message_type: 'agromet',
      category_type: 'advisory',
      priority: Priority.HIGH,
      valid_from: data.date,
      valid_to: data.valid_until,
      created_at: `${data.date}T00:00:00.000Z`,
      content: {
        title: `Agromet Advisory${district ? ` · ${district}` : ''}`,
        body,
      },
      location: null,
      metadata: {
        source: 'IMD',
        bulletin_date: data.date,
        valid_until: data.valid_until,
        lgd_district_codes: data.districts.map((d) => d.lgd_district_code),
        district_name: district,
        crops,
        other_advisories: unnamed,
        follow_up_prompt: 'Tell me the IMD agro advisory for my crop.',
      },
    };
  }
}
