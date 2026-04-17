# Secrets Management — cartool

## Overview

cartool uses environment variables for all configuration and secrets.
No secrets are stored in source code or config files committed to the repository.

## Environment Tiers

| Tier | Secret Source | Notes |
|---|---|---|
| **development** | `.env.local` loaded by `docker-compose env_file` | Copy `.env.example` → `.env.local` and fill in values |
| **staging** | AWS Secrets Manager → ECS task definition `secrets` block | Secrets injected as env vars at container start |
| **production** | AWS Secrets Manager → ECS task definition `secrets` block | Same mechanism, separate secret ARNs |

## Local Development

1. Copy the root `.env.example` to `.env.local`:
   ```
   cp .env.example .env.local
   ```
2. Fill in real values (passwords, API keys).
3. Run `docker-compose up` — all services receive variables via `env_file: .env.local`.

`.env.local` is git-ignored and must never be committed.

## Staging & Production (ECS Fargate)

AWS ECS natively injects secrets as environment variables. No SDK wrapper is needed in application code.

### How It Works

1. Store each secret in **AWS Secrets Manager** under the `cartool` profile (account `173813370404`, region `us-east-1`).
2. Reference the secret ARN in the ECS task definition `secrets` block.
3. ECS resolves the ARN at container launch and injects the value as a plain environment variable.

### Example ECS Task Definition Snippet

```json
{
  "containerDefinitions": [
    {
      "name": "api",
      "image": "173813370404.dkr.ecr.us-east-1.amazonaws.com/cartool-api:latest",
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:173813370404:secret:cartool/staging/DATABASE_URL"
        },
        {
          "name": "REDIS_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:173813370404:secret:cartool/staging/REDIS_URL"
        },
        {
          "name": "JWT_SECRET",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:173813370404:secret:cartool/staging/JWT_SECRET"
        }
      ],
      "environment": [
        { "name": "NODE_ENV", "value": "staging" },
        { "name": "PORT", "value": "3000" }
      ]
    }
  ]
}
```

Non-sensitive values (like `PORT` and `NODE_ENV`) go in the `environment` block.
Sensitive values go in the `secrets` block referencing Secrets Manager ARNs.

### Creating a Secret (CLI)

```powershell
aws secretsmanager create-secret `
  --name "cartool/staging/DATABASE_URL" `
  --secret-string "postgresql://cartool_user:REAL_PASSWORD@staging-db:5432/cartool_staging" `
  --profile cartool
```

### ECS Task Execution Role

The ECS task execution role must have permission to read the secrets:

```json
{
  "Effect": "Allow",
  "Action": ["secretsmanager:GetSecretValue"],
  "Resource": "arn:aws:secretsmanager:us-east-1:173813370404:secret:cartool/*"
}
```

## AWS Profile

All AWS CLI commands for this project use the `cartool` named profile:

```powershell
aws <command> --profile cartool
```

Or scope the entire shell session:

```powershell
$env:AWS_PROFILE = "cartool"
```

## Fail-Fast Validation

Every service validates required environment variables at startup.
If any are missing, the service throws immediately with a clear error listing the absent variables.

- **Node.js services**: Import `validateEnv` from `@cartool/shared` and call it with the service's required var list.
- **Python financial-engine**: `app/config.py` validates `DATABASE_URL` at import time.
