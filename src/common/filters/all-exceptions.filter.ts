import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { QueryFailedError } from 'typeorm';

interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, error } = this.resolveException(exception);

    const body: ErrorResponse = {
      statusCode,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    if (statusCode >= 500) {
      this.logger.error({ err: exception, req: request }, 'Unhandled exception');
    } else {
      this.logger.warn({ statusCode, path: request.url }, message as string);
    }

    response.status(statusCode).json(body);
  }

  private resolveException(exception: unknown): {
    statusCode: number;
    message: string | string[];
    error: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message = typeof res === 'object' && 'message' in res
        ? (res as Record<string, unknown>).message as string | string[]
        : exception.message;
      return { statusCode: status, message, error: exception.name };
    }

    // TypeORM unique constraint / query errors
    if (exception instanceof QueryFailedError) {
      const driverError = (exception as QueryFailedError & { code?: string }).code;
      if (driverError === '23505') {
        return { statusCode: HttpStatus.CONFLICT, message: 'Record already exists', error: 'Conflict' };
      }
      if (driverError === '23503') {
        return { statusCode: HttpStatus.BAD_REQUEST, message: 'Referenced record not found', error: 'Bad Request' };
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }
}
