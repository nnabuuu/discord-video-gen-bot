import { Module, Global } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { RequestTrackingService } from './request-tracking.service';

@Global()
@Module({
  providers: [DatabaseService, RequestTrackingService],
  exports: [DatabaseService, RequestTrackingService],
})
export class DatabaseModule {}
