# ${{ values.componentId }}

${{ values.description }}

FastAPI service (Python 3.14) scaffolded with Backstage.

## Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/` | Greeting payload |
| `GET` | `/health` | Health probe (`{"status": "ok"}`) |
| `GET` | `/docs` | Swagger UI |

## Getting started

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

uvicorn app.main:app --reload   # http://localhost:8000
```

Run the tests:

```bash
pytest -q
```

## Docker

```bash
docker build -t ${{ values.componentId }} .
docker run --rm -p 8000:8000 ${{ values.componentId }}
```

## CI/CD pipeline

`.github/workflows/ci-cd.yaml` runs on every push / pull request to `main`:

1. **build-and-test** – checks out the repo, installs Python 3.14 with pip
   caching, installs `requirements-dev.txt`, compiles the package and runs
   `pytest`.
2. **build-and-push-docker** – after a successful build (and only outside pull
   requests), builds the Docker image and pushes it to GitHub Container Registry:

   - `ghcr.io/<owner>/<repo>:latest`
   - `ghcr.io/<owner>/<repo>:<git-sha>`

### Required secrets / tokens on GitHub

| Name | Required | Where it comes from |
| ---- | -------- | ------------------- |
| `GITHUB_TOKEN` | Yes (no action needed) | Provided automatically by GitHub Actions. The workflow already requests `permissions: packages: write` so it can push to GHCR. |

No manual secret is needed for the default GHCR setup. Check once on the
repository:

1. **Settings → Actions → General → Workflow permissions**: allow *Read and
   write permissions* (or rely on the `permissions:` block in the workflow).
2. After the first push, open the package under **your profile / org →
   Packages** and set its visibility; link it to the repository if private.

#### Optional: push to Docker Hub instead of GHCR

Create these repository secrets (**Settings → Secrets and variables → Actions →
New repository secret**) and adjust the docker login/build-push steps:

| Secret | Example |
| ------ | ------- |
| `DOCKERHUB_USERNAME` | `my-dockerhub-user` |
| `DOCKERHUB_TOKEN` | A Docker Hub *access token* (not your password) |

```yaml
{% raw %}
      - name: Log in to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
{% endraw %}
```

## Backstage

`catalog-info.yaml` registers this component in the Backstage catalog.
