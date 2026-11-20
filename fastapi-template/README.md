# FastAPI Template (CI/CD + Docker)

Backstage software template that scaffolds a FastAPI service on Python 3.14
including:

- `app/main.py` with `/`, `/health` and Swagger docs
- `tests/` with pytest + `fastapi.testclient`
- `Dockerfile` (slim image, non-root user, healthcheck)
- `catalog-info.yaml` (registers the new component in the Backstage catalog)
- `.github/workflows/ci-cd.yaml` – installs dependencies → tests → builds a
  Docker image → pushes it to GHCR

## Pipeline

| Job | Runs on | What it does |
| --- | ------- | ------------ |
| `build-and-test` | every push/PR to `main` | `actions/setup-python@v5` (3.14, pip cache), `pip install -r requirements-dev.txt`, `compileall`, `pytest -q` |
| `build-and-push-docker` | after `build-and-test`, pushes only (not on PRs) | logs in to `ghcr.io`, `docker/build-push-action@v6`, tags `latest` + commit SHA, GHCR layer cache |

## Required secrets / tokens on GitHub

The generated repository **needs no manually created secret** for the default
setup:

| Name | Required | Notes |
| ---- | -------- | ----- |
| `GITHUB_TOKEN` | Yes – automatic | Injected by GitHub Actions. The workflow grants `packages: write` so it can push to GHCR. |

Optional / alternative setups:

- **Docker Hub**: repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`
  (access token, not the account password).
- **Custom registry** (Harbor, ECR, Artifactory, ...): add its credentials as
  secrets and change `REGISTRY` / the login action.
- **Private dependencies**: add a `PIP_INDEX_URL` / `PIP_EXTRA_INDEX_URL`
  variable or a token secret if a private package index is required.

Also verify **Settings → Actions → General → Workflow permissions** and set the
visibility of the resulting GHCR package after the first push.

## Backstage prerequisites

`publish:github` runs with the GitHub integration configured in
`app-config.yaml`:

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}   # GitHub PAT with "repo" scope, provided to Backstage
```

## Notes about templating

GitHub Actions expressions (`${{ ... }}`) collide with Backstage's Nunjucks
`${{ ... }}` syntax, so the workflow file is wrapped in `{% raw %}…{% endraw %}`.
Keep those markers if you edit the pipeline inside `skeleton/`.

## Usage

Register `fastapi-template/template.yaml` (or the repository
`catalog-info.yaml`) as a Location in Backstage, then run **Create** →
*Python FastAPI Service with CI/CD and Docker*.
