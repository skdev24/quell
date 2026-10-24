import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './core/config';
import { TASK_FINGERPRINT, TASK_MODEL, assertTaskFrozen } from './moderation/frozen';

async function bootstrap() {
  assertTaskFrozen();
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.setGlobalPrefix('api');
  // Any private network address, so phones in the room can join (an iPhone hotspot hands out 172.20.10.x).
  app.enableCors({
    origin: [
      config.webOrigin,
      /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):\d+$/,
    ],
  });
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  Logger.log(`Quell API on :${config.port} · task ${TASK_MODEL} · fingerprint ${TASK_FINGERPRINT}`, 'Bootstrap');
}

void bootstrap();
