import * as Joi from 'joi';

/**
 * Joi validation schema for all environment variables used by the application.
 *
 * Required vars will cause the app to fail fast on startup if missing.
 * Optional vars have safe defaults.
 */
export const envValidationSchema = Joi.object({
  // ── Azure Cosmos DB ───────────────────────────────────────────────────────

  COSMOS_ENDPOINT: Joi.string().uri().optional().allow('').messages({
    'string.uri': 'COSMOS_ENDPOINT must be a valid URI',
  }),
  COSMOS_KEY: Joi.string().optional().allow(''),
  COSMOS_DATABASE: Joi.string().default('senappen'),

  // ── JWT ───────────────────────────────────────────────────────────────────

  /** Secret key for signing JWT tokens. Required. */
  JWT_SECRET: Joi.string().min(16).required().messages({
    'any.required': 'JWT_SECRET is required (min 16 characters)',
    'string.min': 'JWT_SECRET must be at least 16 characters for security',
  }),

  // ── Server ────────────────────────────────────────────────────────────────

  PORT: Joi.number().port().default(3000),

  // ── Feature flags ─────────────────────────────────────────────────────────

  USE_MOCK_DATA: Joi.string().valid('true', 'false').default('false'),
  USE_MOCK_AI: Joi.string().valid('true', 'false').default('false'),

  // ── OpenAI ────────────────────────────────────────────────────────────────

  OPENAI_API_KEY: Joi.string().optional().allow(''),

  // ── Azure Blob Storage (optional — falls back to local storage) ───────────

  AZURE_STORAGE_CONNECTION_STRING: Joi.string().optional().allow(''),
  AZURE_STORAGE_CONTAINER: Joi.string().optional().allow('').default('videos'),

  // ── Azure Service Bus (optional — falls back to mock in dev) ──────────────

  SERVICE_BUS_CONNECTION_STRING: Joi.string().optional().allow(''),

  // ── Azure Key Vault (optional — falls back to .env) ──────────────────────

  KEY_VAULT_URL: Joi.string().uri().optional().allow(''),

  // ── Worker ────────────────────────────────────────────────────────────────

  WORKER_CONCURRENCY: Joi.number().integer().min(1).max(50).default(5),
}).options({ allowUnknown: true }); // allow other env vars (PATH, HOME, etc.)
