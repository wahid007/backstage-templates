# ${{ values.componentId }}

${{ values.description }}

Next.js (App Router, TypeScript) service scaffolded with Backstage.

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build
npm start          # run the production build
```

## Docker

The application is containerized with a multi-stage build that uses the Next.js
`standalone` output (see `next.config.js`):

```bash
docker build -t ${{ values.componentId }} .
docker run --rm -p 3000:3000 ${{ values.componentId }}
```

## CI/CD pipeline

`.github/workflows/ci-cd.yaml` runs on every push / pull request to `main`:

1. **build-and-test** – checks out the repo, installs Node.js 24, installs
   dependencies and runs `npm run build`.
2. **build-and-push-docker** – after a successful build (and only outside pull
   requests), builds the Docker image and pushes it to GitHub Container Registry:

   - `ghcr.io/<owner>/<repo>:latest`
   - `ghcr.io/<owner>/<repo>:<git-sha>`

### Required secrets / tokens on GitHub

| Name | Required | Where it comes from |
| ---- | -------- | ------------------- |
| `GITHUB_TOKEN` | Yes (no action needed) | Provided automatically by GitHub Actions. The workflow already requests `permissions: packages: write` so it can push to GHCR. |

Nothing has to be created manually for the default GHCR setup. Two things to
check once on the repository:

1. **Settings → Actions → General → Workflow permissions**: allow *Read and
   write permissions* (or rely on the `permissions:` block in the workflow).
2. After the first push, the package appears under **your profile / org →
   Packages**. Open it and set the visibility (private/public) and, if the
   repository is private, link the package to the repository.

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
