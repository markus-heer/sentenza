import { sentenzaVitestConfig } from '@sentenza/vitest-config';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(sentenzaVitestConfig, defineConfig({}));
