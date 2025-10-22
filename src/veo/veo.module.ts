import { Module } from '@nestjs/common';
import { VeoService } from './veo.service';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AuthModule, StorageModule],
  providers: [VeoService],
  exports: [VeoService],
})
export class VeoModule {}
