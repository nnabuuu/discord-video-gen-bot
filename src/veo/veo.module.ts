import { Module } from '@nestjs/common';
import { VeoService } from './veo.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [VeoService],
  exports: [VeoService],
})
export class VeoModule {}
