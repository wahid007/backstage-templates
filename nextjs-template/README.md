# Next.js Template (CI/CD + Docker)

Backstage software template that scaffolds a Next.js (App Router, TypeScript)
service including:

- `app/` (App Router), `public/`, TypeScript + Next.js configuration
- `Dockerfile` (multi-stage, Next.js `standalone` output, non-root user)
- `catalog-info.yaml` (registers the new component in the Backstage catalog)
- `.github/workflows/ci-cd.yaml` – installs dependencies → builds the app →
  builds a Docker image → pushes it to GHCR

## Pipeline

| Job | Runs on | What it does |
| --- | ------- | ------------ |
| `build-and-test` | every push/PR to `main` | `actions/checkout`, `actions/setup-node@v4` (Node 24), install dependencies (`npm ci`, with an `npm install` fallback until a lockfile exists), `npm run build` |
| `build-and-push-docker` | after `build-and-test`, pushes only (not on PRs) | logs in to `ghcr.io`, `docker/build-push-action@v6`, tags `latest` + commit SHA, GHCR layer cache |

## Required secrets / tokens on GitHub

The generated repository **needs no manually created secret** for the default
setup:

| Name | Required | Notes |
| ---- | -------- | ----- |
| `GITHUB_TOKEN` | Yes – automatic | Injected by GitHub Actions. The workflow grants `packages: write` so it can push to GHCR. |

Optional / alternative setups:

- **Docker Hub**: add repository secrets `DOCKERHUB_USERNAME` and
  `DOCKERHUB_TOKEN` (an access token, not the account password) and replace the
  GHCR login + tag prefix.
- **Custom registry** (Harbor, ECR, Artifactory, ...): add the registry
  credentials as secrets and change `REGISTRY` / the login action.

Also make sure **Settings → Actions → General → Workflow permissions** is set to
*Read and write permissions* if GitHub blocks the default token, and set the
visibility of the resulting GHCR package after the first push.

## Backstage prerequisites

`publish:github` is executed by Backstage using the GitHub integration configured
in `app-config.yaml`:

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}   # a GitHub PAT with "repo" scope, provided to Backstage
```

## Notes about templating

GitHub Actions expressions (`${{ ... }}`) collide with Backstage's Nunjucks
`${{ ... }}` syntax, so the workflow file is wrapped in `{% raw %}…{% endraw %}`.
Keep those markers if you edit the pipeline inside `skeleton/`.

## Usage

Register `templates/nextjs-template/template.yaml` (or the repository
`catalog-info.yaml`) as a Location in Backstage, then run **Create** →
*Next.js App with CI/CD and Docker*.
