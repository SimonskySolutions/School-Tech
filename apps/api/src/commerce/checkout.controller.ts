import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { type CheckoutGroupView, type CheckoutResponse } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { CheckoutRejected } from './checkout-plan';
import { CheckoutService } from './checkout.service';

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        studentId: z.uuid(),
        offeringId: z.uuid(),
        sessionIds: z.array(z.uuid()).max(60).optional(),
        stopId: z.uuid().optional(),
      }),
    )
    .min(1)
    .max(50),
});

// The client chooses the key (one per basket); repeating it never creates a second order.
const IDEMPOTENCY_KEY = /^[A-Za-z0-9-]{16,100}$/;

@Controller()
export class CheckoutController {
  constructor(@Inject(CheckoutService) private readonly checkout: CheckoutService) {}

  @Post('checkout')
  @HttpCode(201)
  async create(
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<CheckoutResponse> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new BadRequestException(
        'an Idempotency-Key header of 16-100 letters, digits or dashes is required',
      );
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('the basket is not valid');
    try {
      return await this.checkout.checkout(principal, idempotencyKey, parsed.data.items);
    } catch (error) {
      if (error instanceof CheckoutRejected) {
        if (error.status === 403) throw new ForbiddenException(error.message);
        if (error.status === 404) throw new NotFoundException(error.message);
        throw new HttpException(error.message, error.status);
      }
      throw error;
    }
  }

  @Get('checkout-groups/:groupId')
  async view(
    @CurrentPrincipal() principal: Principal,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
  ): Promise<CheckoutGroupView> {
    const view = await this.checkout.view(principal, groupId);
    if (!view) throw new NotFoundException('no such checkout');
    return view;
  }
}
