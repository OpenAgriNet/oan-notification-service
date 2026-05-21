import { ValidationPipe } from '@nestjs/common';

export const globalValidationPipe = new ValidationPipe({
  whitelist: true,           // strip unknown properties
  forbidNonWhitelisted: true, // throw on unknown properties
  transform: true,           // auto-transform payloads to DTO class instances
  transformOptions: {
    enableImplicitConversion: true,
  },
});
