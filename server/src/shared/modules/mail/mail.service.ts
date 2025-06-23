import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { SendMail } from './interfaces';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  constructor(private readonly mailerService: MailerService) {}

  async sendMail(dto: SendMail) {
    const { to, template, context, subject } = dto;

    if ((process.env.MAILER_MODE || 'log') === 'log') {
      this.logger.log(`Local email: ${subject} -> ${to} (${template})`);
      return;
    }

    try {
      await this.mailerService.sendMail({
        from: 'noreply@SchoolKeep.com',
        to,
        subject,
        template,
        context,
      });
    } catch (error) {
      throw new BadRequestException(error);
    }
  }
}
