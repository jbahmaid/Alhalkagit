import { Controller, Get, Header, Param } from '@nestjs/common';
import { LookupItemDto } from '@sanad/shared';
import { Public } from '../common/decorators';
import { LookupsService } from './lookups.service';

@Controller('lookups')
export class LookupsController {
  constructor(private readonly lookups: LookupsService) {}

  /** GET /api/lookups/:type: countries | sectors | education-levels | dars | fakhdhs | business-types */
  @Public()
  @Get(':type')
  @Header('Cache-Control', 'public, max-age=60')
  list(@Param('type') type: string): Promise<LookupItemDto[]> {
    return this.lookups.list(type);
  }
}
