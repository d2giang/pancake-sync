import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
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
