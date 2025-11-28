import { Module, Global } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { RequestTrackingService } from './request-tracking.service';
import { UserApiKeyService } from './user-api-key.service';

@Global()
@Module({
  providers: [DatabaseService, RequestTrackingService, UserApiKeyService],
  exports: [DatabaseService, RequestTrackingService, UserApiKeyService],
})
export class DatabaseModule {}
