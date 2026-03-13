import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Azure Key Vault secrets provider.
 *
 * When `KEY_VAULT_URL` is set, the service fetches secrets from Azure Key Vault
 * using DefaultAzureCredential (managed identity in production, az CLI locally).
 *
 * When running without Key Vault (e.g. local dev), secrets are read from `.env`
 * via ConfigService as a fallback.
 */
@Injectable()
export class KeyVaultService implements OnModuleInit {
  private readonly logger = new Logger(KeyVaultService.name);
  private secretCache: Map<string, string> = new Map();
  private client: { getSecret(name: string): Promise<{ value?: string }> } | null = null;
  private readonly vaultUrl: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.vaultUrl = this.config.get<string>('KEY_VAULT_URL');
  }

  async onModuleInit() {
    if (!this.vaultUrl) {
      this.logger.log('Key Vault: disabled (no KEY_VAULT_URL). Using .env fallback.');
      return;
    }

    try {
      // Dynamic imports to avoid hard dependency when Key Vault is not configured
      const { DefaultAzureCredential } = await import('@azure/identity');
      const { SecretClient } = await import('@azure/keyvault-secrets');

      const credential = new DefaultAzureCredential();
      this.client = new SecretClient(this.vaultUrl, credential);
      this.logger.log(`Key Vault: connected to ${this.vaultUrl}`);
    } catch (err) {
      this.logger.warn(`Key Vault init failed: ${(err as Error).message}. Using .env fallback.`);
    }
  }

  /**
   * Get a secret by name.
   * Checks cache first, then Key Vault, then falls back to ConfigService (.env).
   */
  async getSecret(name: string): Promise<string | undefined> {
    // Check cache
    if (this.secretCache.has(name)) {
      return this.secretCache.get(name);
    }

    // Try Key Vault
    if (this.client) {
      try {
        const secret = await this.client.getSecret(name);
        if (secret.value) {
          this.secretCache.set(name, secret.value);
          return secret.value;
        }
      } catch {
        this.logger.warn(`Secret "${name}" not found in Key Vault, falling back to .env`);
      }
    }

    // Fall back to .env via ConfigService
    // Key Vault uses kebab-case, env uses UPPER_SNAKE_CASE
    const envKey = name.replace(/-/g, '_').toUpperCase();
    const value = this.config.get<string>(envKey) ?? this.config.get<string>(name);
    if (value) {
      this.secretCache.set(name, value);
    }
    return value;
  }

  /** Invalidate the cache for a specific secret or all secrets. */
  clearCache(name?: string): void {
    if (name) {
      this.secretCache.delete(name);
    } else {
      this.secretCache.clear();
    }
  }
}
