import express from 'express';
import { HttpError, getAuthUser, requireUser } from '../../authMiddleware.ts';
import { defaultWiring, handleDbBackupRun, handleDbStatus } from './dbBackupContext.ts';

function sendFailure(res: express.Response, err: unknown): void {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err instanceof Error ? err.message : 'Erro inesperado.' });
}

/** Rotas do painel "Banco e backups" (somente owner/admin). */
export function createDbBackupRouter(): express.Router {
  const router = express.Router();

  router.get('/ops/db-status', requireUser, async (req, res) => {
    try {
      const user = getAuthUser(req);
      res.json(await handleDbStatus(user, await defaultWiring()));
    } catch (err) {
      sendFailure(res, err);
    }
  });

  router.post('/ops/db-backup/run', requireUser, async (req, res) => {
    try {
      const user = getAuthUser(req);
      res.json({ lastBackup: await handleDbBackupRun(user, await defaultWiring()) });
    } catch (err) {
      sendFailure(res, err);
    }
  });

  return router;
}
