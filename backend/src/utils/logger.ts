interface LogLevel {
  INFO: 'info';
  ERROR: 'error';
  WARN: 'warn';
  DEBUG: 'debug';
}

const LOG_LEVELS: LogLevel = {
  INFO: 'info',
  ERROR: 'error',
  WARN: 'warn',
  DEBUG: 'debug'
};

class Logger {
  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const logData = data ? ` ${JSON.stringify(data, null, 2)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${logData}`;
  }

  info(message: string, data?: any): void {
    console.log(this.formatMessage(LOG_LEVELS.INFO, message, data));
  }

  error(message: string, data?: any): void {
    // Always extract stack trace from Error objects
    if (data instanceof Error) {
      data = { message: data.message, stack: data.stack, name: data.name };
    } else if (data && typeof data === 'object' && !data.stack && data.error instanceof Error) {
      data = { ...data, stack: data.error.stack };
    }
    console.error(this.formatMessage(LOG_LEVELS.ERROR, message, data));
  }

  warn(message: string, data?: any): void {
    console.warn(this.formatMessage(LOG_LEVELS.WARN, message, data));
  }

  debug(message: string, data?: any): void {
    if (process.env.NODE_ENV === 'development') {
      console.log(this.formatMessage(LOG_LEVELS.DEBUG, message, data));
    }
  }
}

export const logger = new Logger();