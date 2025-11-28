import { Module } from '@nestjs/common';
import { ConnectController } from './connect.controller';
import { ConnectPageController } from './connect-page.controller';

@Module({
  controllers: [ConnectController, ConnectPageController],
})
export class ApiModule {}
