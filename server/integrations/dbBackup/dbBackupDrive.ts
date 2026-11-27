import {
  deleteDriveFile,
  findOrCreateDriveFolderByName,
  listDriveFolder,
  uploadDriveFile,
  type DriveFile,
} from '../google/googleClient.ts';
import { DB_BACKUP_EXT, DB_BACKUP_PREFIX, type DbBackupDrive } from './dbBackupService.ts';

export const DB_BACKUP_DRIVE_FOLDER = 'Backups do banco (cifrados)';
const FOLDER_DESCRIPTION = 'Backups cifrados (AES-256-GCM) do banco de dados. A restauração exige a BACKUP_ENCRYPTION_KEY.';

/** Operações do Drive de que o destino precisa (injetáveis para teste). */
export interface DriveApi {
  findOrCreateFolder(name: string, description: string): Promise<string>;
  upload(folderId: string, fileName: string, content: Buffer, description: string): Promise<{ id: string }>;
  list(folderId: string): Promise<DriveFile[]>;
  remove(fileId: string): Promise<void>;
}

export function googleDriveApi(tenantId: string): DriveApi {
  return {
    findOrCreateFolder: (name, description) => findOrCreateDriveFolderByName(tenantId, name, description),
    upload: (folderId, fileName, content, description) => uploadDriveFile(tenantId, folderId, fileName, content, description),
    list: (folderId) => listDriveFolder(tenantId, folderId),
    remove: (fileId) => deleteDriveFile(tenantId, fileId),
  };
}

const isOurFile = (name: string) => name.startsWith(DB_BACKUP_PREFIX) && name.endsWith(DB_BACKUP_EXT);

/** Destino no Drive: pasta própria; a retenção remove só arquivos com o nosso prefixo e extensão. */
export function createDbBackupDrive(api: DriveApi): DbBackupDrive {
  let folderId: string | null = null;
  const folder = async () => (folderId ??= await api.findOrCreateFolder(DB_BACKUP_DRIVE_FOLDER, FOLDER_DESCRIPTION));
  return {
    async upload(fileName, content, description) {
      return api.upload(await folder(), fileName, content, description);
    },
    async prune(keep) {
      const files = (await api.list(await folder()))
        .filter((f) => isOurFile(f.name))
        .sort((a, b) => (b.createdTime ?? '').localeCompare(a.createdTime ?? '') || b.name.localeCompare(a.name));
      let removed = 0;
      for (const f of files.slice(Math.max(1, keep))) {
        await api.remove(f.id);
        removed += 1;
      }
      return removed;
    },
  };
}
