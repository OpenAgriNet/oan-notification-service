import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

// TTL matches the weekly advisory cycle (7 days)
const LOADED_MESSAGES_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @InjectPinoLogger(RedisService.name)
    private readonly logger: PinoLogger,
  ) {}

  async onModuleInit() {
    await this.client.connect();
    this.logger.info('Redis connected');
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  // ─── loaded messages (what the server sent to this user) ──────────────────

  private loadedKey(visitorId: string): string {
    return `oan:loaded:${visitorId}`;
  }

  /**
   * Returns the set of message IDs previously loaded for this user.
   */
  async getLoadedMessages(userId: string): Promise<Set<string>> {
    const members = await this.client.smembers(this.loadedKey(userId));
    return new Set(members);
  }

  /**
   * Adds newly served message IDs to the user's loaded set and refreshes TTL.
   */
  async addLoadedMessages(userId: string, messageIds: string[]): Promise<void> {
    if (!messageIds.length) return;
    const key = this.loadedKey(userId);
    await this.client.sadd(key, ...messageIds);
    await this.client.expire(key, LOADED_MESSAGES_TTL_SECONDS);
  }

  /**
   * Validates client-supplied seen IDs against the server-side loaded set.
   * Only IDs that were genuinely served to this user are returned —
   * prevents clients from excluding arbitrary IDs they never received.
   */
  async validateSeenMessages(userId: string, seenIds: string[]): Promise<string[]> {
    if (!seenIds.length) return [];
    const loaded = await this.getLoadedMessages(userId);
    return seenIds.filter((id) => loaded.has(id));
  }
}
