import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscordModule } from './discord/discord.module';
import { VeoModule } from './veo/veo.module';
import { StorageModule } from './storage/storage.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    StorageModule,
    RateLimitModule,
    VeoModule,
    DiscordModule,
  ],
})
export class AppModule {}
