import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { QwenImageService } from "./qwen-image.service";

@Module({
  imports: [StorageModule],
  providers: [QwenImageService],
  exports: [QwenImageService],
})
export class QwenImageModule {}