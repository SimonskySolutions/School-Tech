import { BadRequestException, Controller, Get, Inject, NotFoundException, Query } from '@nestjs/common';
import { type SiteInfo } from '@pythagoras/shared';
import { Public } from '../auth/principal';
import { Database } from '../database/database';

// Which public website a host name belongs to (M3.5, ADR 0011, 0017). Asked
// by the web app before it renders a website's pages. Only verified domains
// of live websites answer; the gateway does not expose this to the internet.

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

@Public()
@Controller('sites')
export class SitesController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get('resolve')
  async resolve(@Query('host') host: unknown): Promise<SiteInfo> {
    const hostname = typeof host === 'string' ? host.trim().toLowerCase().replace(/:\d+$/, '') : '';
    if (!HOSTNAME.test(hostname)) throw new BadRequestException('host must be a host name');
    const row = await this.database.resolveWebsite(hostname);
    if (!row) throw new NotFoundException('no live website on this host');
    return {
      websiteId: row.website_id,
      code: row.code,
      name: row.name,
      purpose: row.purpose as SiteInfo['purpose'],
      cmsKey: row.cms_tenant_key,
      locale: row.default_locale,
      schools: row.schools,
    };
  }
}
