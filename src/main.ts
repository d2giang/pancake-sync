import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
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
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );

  await app.listen(port, host);
  console.log(`Server listening on ${host}:${port}`);
}

bootstrap();
