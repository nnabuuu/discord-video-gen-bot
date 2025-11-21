import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { VideoAttachmentService } from './video-attachment.service';
import { TaskResumeService } from './task-resume.service';
import { VeoModule } from '../veo/veo.module';
import { BananaModule } from '../banana/banana.module';
import { StorageModule } from '../storage/storage.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [VeoModule, BananaModule, StorageModule, RateLimitModule, DatabaseModule],
  providers: [DiscordService, VideoAttachmentService, TaskResumeService],
})
export class DiscordModule {}
