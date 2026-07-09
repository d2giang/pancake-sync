import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  // Default to quiet console output (log/warn/error only) — the messaging
  // and realtime pipelines run on every inbound message, so leaving
  // debug/verbose on by default drowns the console in per-step noise.
  // Set LOG_LEVEL=debug to see the detailed step-by-step timings again.
  const isVerbose = (process.env.LOG_LEVEL || '').toLowerCase() === 'debug';

  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: isVerbose
      ? ['log', 'warn', 'error', 'debug', 'verbose']
      : ['log', 'warn', 'error'],
  });
  const port = Number(process.env.PORT || 3000);
  const host = '0.0.0.0';

  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  app.use(
    bodyParser.json({
      // Default 100kb is too small — Pancake conversation/webhook payloads
      // (recent_phone_numbers, tags, customers, raw data) routinely exceed it
      // for active conversations.
      limit: '5mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );

  app.useWebSocketAdapter(new IoAdapter(app));

  await app.listen(port, host);
  console.log(`Server listening on ${host}:${port}`);
}

bootstrap();
