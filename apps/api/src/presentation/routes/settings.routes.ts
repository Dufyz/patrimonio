import {
  deleteAllDataSchema,
  exportDataSchema,
  getSettingsSchema,
  runBackupSchema,
} from '@patrimonio/contracts';
import { Router } from 'express';

import type { SettingsDeps } from '../controllers/settings.controller.js';
import { createSettingsController } from '../controllers/settings.controller.js';
import { validate } from '../middleware/validate.js';

export const settingsRoutes = (deps: SettingsDeps): Router => {
  const router = Router();
  const controller = createSettingsController(deps);

  router.get('/settings', validate(getSettingsSchema), controller.settings);
  router.post('/backup', validate(runBackupSchema), controller.backup);
  router.get('/data/export', validate(exportDataSchema), controller.exportAll);
  router.delete('/data', validate(deleteAllDataSchema), controller.deleteAll);

  return router;
};
