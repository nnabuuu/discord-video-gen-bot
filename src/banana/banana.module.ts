import { Module } from '@nestjs/common';
import { BananaService } from './banana.service';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AuthModule, StorageModule],
  providers: [BananaService],
  exports: [BananaService],
})
export class BananaModule {}
