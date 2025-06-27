import { Controller, Get } from '@nestjs/common';
import { IsPublic } from './core/decorators/auth.decoractor';

@Controller()
export class AppController {
  @Get('health-check')
  @IsPublic()
  getHello(): string {
    return 'OK';
  }
}
