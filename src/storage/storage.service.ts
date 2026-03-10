import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} from '@azure/storage-blob';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Abstracts file storage behind local disk or Azure Blob Storage.
 *
 * When `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_CONTAINER` env
 * vars are set, files are uploaded to Azure Blob Storage and publicly-
 * accessible URLs (or expiring SAS URLs) are returned.
 *
 * Otherwise files are written to `storage/videos/` on the local filesystem.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly blobServiceClient: BlobServiceClient | null;
  private readonly containerName: string | null;
  private readonly useAzure: boolean;

  constructor(private readonly config: ConfigService) {
    const connStr = this.config.get<string>('AZURE_STORAGE_CONNECTION_STRING');
    const container = this.config.get<string>('AZURE_STORAGE_CONTAINER');

    if (connStr && container) {
      this.blobServiceClient = BlobServiceClient.fromConnectionString(connStr);
      this.containerName = container;
      this.useAzure = true;
      this.logger.log(`Storage backend: Azure Blob Storage (container: ${container})`);
    } else {
      this.blobServiceClient = null;
      this.containerName = null;
      this.useAzure = false;
      this.logger.log('Storage backend: local filesystem (storage/videos/)');
    }
  }

  /**
   * Store a file and return the URL / path.
   *
   * @param fileBuffer  Raw file bytes
   * @param originalName  Original filename (used to extract extension)
   * @param contentType  MIME type of the file
   * @returns URL (Azure) or relative path (local) pointing to the stored file
   */
  async store(
    fileBuffer: Buffer,
    originalName: string,
    contentType = 'video/mp4',
  ): Promise<string> {
    const ext = path.extname(originalName) || '.mp4';
    const blobName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

    if (this.useAzure && this.blobServiceClient && this.containerName) {
      return this.uploadToAzure(fileBuffer, blobName, contentType);
    }

    return this.uploadToLocal(fileBuffer, blobName);
  }

  /**
   * Generate a short-lived SAS URL for a blob (Azure only).
   * If using local storage, returns the local path unchanged.
   */
  async generateSasUrl(blobUrl: string, expiresInHours = 2): Promise<string> {
    if (!this.useAzure || !this.blobServiceClient || !this.containerName) {
      return blobUrl; // local path — no SAS needed
    }

    // Extract blob name from the URL
    const urlParts = new URL(blobUrl);
    const blobName = urlParts.pathname.split('/').pop();
    if (!blobName) return blobUrl;

    const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    const blobClient = containerClient.getBlobClient(blobName);

    const expiresOn = new Date();
    expiresOn.setHours(expiresOn.getHours() + expiresInHours);

    // Try managed identity / key-based SAS; fall back to blob URL for anonymous containers
    try {
      const accountName = this.blobServiceClient.accountName;
      const sharedKeyCredential = (this.blobServiceClient as BlobServiceClient & {
        credential?: StorageSharedKeyCredential;
      }).credential;

      if (!(sharedKeyCredential instanceof StorageSharedKeyCredential)) {
        // Can't generate SAS without shared key — return plain URL
        return blobClient.url;
      }

      const sasToken = generateBlobSASQueryParameters(
        {
          containerName: this.containerName,
          blobName,
          permissions: BlobSASPermissions.parse('r'),
          expiresOn,
        },
        sharedKeyCredential,
      ).toString();

      return `${blobClient.url}?${sasToken}`;
    } catch (err) {
      this.logger.warn(`Failed to generate SAS URL: ${(err as Error).message}`);
      return blobClient.url;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async uploadToAzure(
    fileBuffer: Buffer,
    blobName: string,
    contentType: string,
  ): Promise<string> {
    const containerClient = this.blobServiceClient!.getContainerClient(this.containerName!);

    // Ensure container exists (idempotent — no public access)
    await containerClient.createIfNotExists();

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(fileBuffer, {
      blobHTTPHeaders: { blobContentType: contentType },
    });

    this.logger.log(`Uploaded blob: ${blobName}`);
    return blockBlobClient.url;
  }

  private async uploadToLocal(fileBuffer: Buffer, filename: string): Promise<string> {
    const storageDir = path.resolve(process.cwd(), 'storage', 'videos');
    await fs.mkdir(storageDir, { recursive: true });
    await fs.writeFile(path.join(storageDir, filename), fileBuffer);
    return `storage/videos/${filename}`;
  }
}
