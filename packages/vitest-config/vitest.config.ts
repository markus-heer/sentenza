import { defineConfig, mergeConfig } from 'vitest/config';

import { sentenzaVitestConfig } from './base.js';

export default mergeConfig(sentenzaVitestConfig, defineConfig({}));
