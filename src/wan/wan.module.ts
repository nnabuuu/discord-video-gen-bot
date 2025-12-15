import { Module } from '@nestjs/common';
import { WanService } from './wan.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [WanService],
  exports: [WanService],
})
export class WanModule {}