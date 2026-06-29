import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NoResponseDetectorService } from '../services/no-response-detector.service';

@Injectable()
export class NoResponseScheduler implements OnModuleInit {
  private readonly logger = new Logger(NoResponseScheduler.name);

  constructor(
    private readonly noResponseService: NoResponseDetectorService,
  ) {}

  onModuleInit() {
    const cron = process.env.NO_RESPONSE_CHECK_CRON || '0 * * * *';
    this.logger.log(`No-response check scheduler registered (cron: ${cron})`);
  }

  /**
   * No-response detection — runs on configurable cron (default: every hour).
   */
  @Cron(process.env.NO_RESPONSE_CHECK_CRON || '0 * * * *', {
    name: 'no-response-check',
    timeZone: 'Asia/Bangkok',
  })
  async handleNoResponseCheck() {
    this.logger.log('No-response check triggered by scheduler');
    await this.noResponseService.checkAllPages();
  }
}