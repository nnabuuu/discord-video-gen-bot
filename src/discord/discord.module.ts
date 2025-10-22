import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { VeoModule } from '../veo/veo.module';
import { StorageModule } from '../storage/storage.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';

@Module({
  imports: [VeoModule, StorageModule, RateLimitModule],
  providers: [DiscordService],
})
export class DiscordModule {}
