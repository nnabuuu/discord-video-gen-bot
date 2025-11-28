import { Controller, Get, Post, Delete, Query, Body, HttpException, HttpStatus } from '@nestjs/common';
import { UserApiKeyService } from '../database/user-api-key.service';
import { logger } from '../common/logger';

interface SetApiKeyBody {
  code: string;
  apiKey: string;
}

@Controller('api/connect')
export class ConnectController {
  constructor(private readonly userApiKeyService: UserApiKeyService) {}

  @Get()
  async getStatus(@Query('code') code: string) {
    if (!code) {
      throw new HttpException('Connection code is required', HttpStatus.BAD_REQUEST);
    }

    const status = await this.userApiKeyService.getStatusByCode(code);

    if (!status) {
      throw new HttpException(
        'Invalid or expired connection code. Please run /api-key connect again.',
        HttpStatus.NOT_FOUND,
      );
    }

    logger.info({ codePrefix: code.slice(0, 8) }, 'API key status retrieved');

    return status;
  }

  @Post()
  async setApiKey(@Body() body: SetApiKeyBody) {
    const { code, apiKey } = body;

    if (!code) {
      throw new HttpException('Connection code is required', HttpStatus.BAD_REQUEST);
    }

    if (!apiKey) {
      throw new HttpException('API key is required', HttpStatus.BAD_REQUEST);
    }

    const result = await this.userApiKeyService.setApiKeyByCode(code, apiKey);

    if (!result.success) {
      const statusCode = result.error?.includes('expired')
        ? HttpStatus.BAD_REQUEST
        : result.error?.includes('Invalid')
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR;

      throw new HttpException(result.error || 'Failed to save API key', statusCode);
    }

    logger.info({ codePrefix: code.slice(0, 8) }, 'API key set via HTTP');

    return {
      success: true,
      maskedKey: result.maskedKey,
    };
  }

  @Delete()
  async removeApiKey(@Query('code') code: string) {
    if (!code) {
      throw new HttpException('Connection code is required', HttpStatus.BAD_REQUEST);
    }

    const result = await this.userApiKeyService.removeApiKeyByCode(code);

    if (!result.success) {
      const statusCode = result.error?.includes('expired')
        ? HttpStatus.BAD_REQUEST
        : result.error?.includes('Invalid')
          ? HttpStatus.NOT_FOUND
          : result.error?.includes('No API key')
            ? HttpStatus.BAD_REQUEST
            : HttpStatus.INTERNAL_SERVER_ERROR;

      throw new HttpException(result.error || 'Failed to remove API key', statusCode);
    }

    logger.info({ codePrefix: code.slice(0, 8) }, 'API key removed via HTTP');

    return { success: true };
  }
}
