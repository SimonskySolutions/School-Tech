import { readFileSync } from 'node:fs';
import { Global, Module } from '@nestjs/common';
import { type Env, loadEnv } from './env';

export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => loadEnv({ env: process.env, readFile: (path) => readFileSync(path, 'utf8') }),
    },
  ],
  exports: [ENV],
})
export class ConfigModule {}
