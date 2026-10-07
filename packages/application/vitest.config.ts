import { defineConfig, mergeConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared.js';

export default defineConfig(mergeConfig(sharedTestConfig, {}));
