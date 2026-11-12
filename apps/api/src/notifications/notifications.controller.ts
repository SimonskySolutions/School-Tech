import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type MessageStatus, type MyNotifications } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database } from '../database/database';

// A person's own notifications (M7.2, ADR 0031): which kinds they receive and
// what was sent to them lately. Essential kinds cannot be turned off.

export const preferenceSchema = z.strictObject({
  kind: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
  enabled: z.boolean(),
});

@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  mine(@CurrentPrincipal() principal: Principal): Promise<MyNotifications> {
    return this.database.withPerson(principal, async (tx) => {
      const kinds = await tx.query<{
        code: string;
        description: string;
        essential: boolean;
        enabled: boolean;
      }>(
        `SELECT k.code, k.description, k.essential, k.essential OR coalesce(p.enabled, true) AS enabled
           FROM notify.kind k LEFT JOIN notify.preference p ON p.kind_code = k.code AND p.person_id = app.current_person_id()
          ORDER BY k.essential DESC, k.description`,
      );
      const recent = await tx.query<{
        id: string;
        kind_code: string;
        description: string;
        status: MessageStatus;
        created_at: Date;
        sent_at: Date | null;
      }>(
        `SELECT m.id, m.kind_code, k.description, m.status, m.created_at, m.sent_at
           FROM notify.message m JOIN notify.kind k ON k.code = m.kind_code
          ORDER BY m.created_at DESC LIMIT 20`,
      );
      return {
        kinds,
        recent: recent.map((row) => ({
          id: row.id,
          kind: row.kind_code,
          description: row.description,
          status: row.status,
          createdAt: row.created_at.toISOString(),
          sentAt: row.sent_at?.toISOString() ?? null,
        })),
      };
    });
  }

  @Post('preferences')
  @HttpCode(200)
  async choose(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ): Promise<{ kind: string; enabled: boolean }> {
    const parsed = preferenceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('give a kind of message and whether to receive it');
    const { kind, enabled } = parsed.data;
    try {
      await this.database.withPerson(principal, (tx) =>
        tx.query('SELECT notify.set_preference($1, $2)', [kind, enabled]),
      );
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'P0002') throw new NotFoundException('no such kind of message');
      if (code === '23514') throw new UnprocessableEntityException('this message is always sent');
      throw error;
    }
    return { kind, enabled };
  }
}
