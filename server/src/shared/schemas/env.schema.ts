import * as Joi from 'joi';

const envSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  NODE_ENV: Joi.string().optional(),
  SEED_ENABLED: Joi.boolean().default(true),
  PORT: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  MAILER_USER: Joi.string().allow('').optional(),
  MAILER_PASS: Joi.string().allow('').optional(),
  MAILER_MODE: Joi.string().valid('smtp', 'log').default('log'),
  FRONTEND_URL: Joi.string().required(),
  SCHOOL_MANAGERS_PASSWORD: Joi.string().required(),
  STORAGE_DRIVER: Joi.string().valid('local', 'cloudinary').default('local'),
  LOCAL_STORAGE_DIR: Joi.string().default('./storage'),
  PUBLIC_API_URL: Joi.string().uri().default('http://localhost:4000'),
  ML_SERVICE_URL: Joi.string().uri().default('http://127.0.0.1:8001'),
  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').optional(),
  CLOUDINARY_API_SECRET: Joi.string().allow('').optional(),
  CLOUDINARY_API_KEY: Joi.string().allow('').optional(),
});

export default envSchema;
