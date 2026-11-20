# Backstage Software Templates

Golden-path templates for Backstage. Each template scaffolds a repository,
generates a GitHub Actions CI/CD pipeline, containerizes the application and
registers the new component in the Backstage catalog.

```
backstage-templates/
├── catalog-info.yaml                 # Location -> registers all templates
├── nextjs-template/
│   ├── template.yaml
│   ├── README.md
│   └── skeleton/
│       ├── .github/workflows/ci-cd.yaml
│       ├── app/, public/
│       ├── package.json, tsconfig.json, next.config.js
│       ├── Dockerfile, .dockerignore
│       └── catalog-info.yaml
├── fastapi-template/
│   ├── template.yaml
│   ├── README.md
│   └── skeleton/
│       ├── .github/workflows/ci-cd.yaml
│       ├── app/, tests/
│       ├── requirements.txt, requirements-dev.txt
│       ├── Dockerfile, .dockerignore
│       └── catalog-info.yaml
└── java-spring-boot-template/
    ├── template.yaml
    ├── README.md
    └── skeleton/
        ├── .github/workflows/ci-cd.yaml
        ├── src/main/java/..., src/test/java/...
        ├── pom.xml
        ├── Dockerfile, .dockerignore
        └── catalog-info.yaml
```

## Templates

| Template | Stack | Pipeline |
| -------- | ----- | -------- |
| **Next.js App with CI/CD and Docker** (`nextjs-template`) | Next.js 15 (App Router), TypeScript, Node 24 | `npm ci` → `npm run build` → Docker build → push `ghcr.io/<owner>/<repo>:{latest,<sha>}` |
| **Python FastAPI Service with CI/CD and Docker** (`fastapi-template`) | Python 3.14, FastAPI, pytest | `pip install -r requirements-dev.txt` → `pytest` → Docker build → push GHCR |
| **Java Spring Boot Service with CI/CD and Docker** (`java-spring-boot-template`) | Java 25, Spring Boot 4, Maven | `mvn dependency:go-offline` → `mvn clean verify` → Docker build → push GHCR |

## Toolchain and base images

All Dockerfiles use the current upstream LTS/stable base images:

| Template | Docker base image(s) | Pipeline toolchain | Application stack |
| -------- | -------------------- | ------------------ | ----------------- |
| `nextjs-template` | `node:24-alpine` (Node 24 LTS) | Node 24 | Next.js 15 (App Router), React 19, TypeScript |
| `fastapi-template` | `python:3.14-slim` | Python 3.14 | FastAPI 0.165.0, Uvicorn 0.54.0 |
| `java-spring-boot-template` | build `maven:3.10-eclipse-temurin-25`, runtime `eclipse-temurin:25-jre-alpine` | Temurin JDK 25, Maven 3.10 | Spring Boot 4.2.0 (Java 25, `spring-boot-starter-webmvc`) |

Bump these tags when a new LTS/stable image is published (`node:<lts>-alpine`,
`python:<x.y>-slim`, `maven:<ver>-eclipse-temurin-<jdk>`,
`eclipse-temurin:<jdk>-jre-alpine`) and keep the `setup-*` versions in the
workflows in sync with the Docker base image.

All three pipelines share the same shape:

1. **build-and-test** – checkout → install toolchain → install dependencies →
   build/test the application.
2. **build-and-push-docker** – `needs: build-and-test`, runs on pushes to
   `main` only (skipped for pull requests), logs in to `ghcr.io` with
   `GITHUB_TOKEN`, builds the Docker image and pushes `latest` + `<git-sha>`
   tags with GitHub Actions layer caching.

## Register the templates in Backstage

1. Commit this repository to GitHub.
2. In Backstage choose **Create → Register Existing Component** and point it at
   `catalog-info.yaml` (a `Location` entity listing all three templates), or add
   it to `app-config.yaml`:

   ```yaml
   catalog:
     locations:
       - type: url
         target: https://github.com/<org>/backstage-templates/blob/main/catalog-info.yaml
   ```

3. The templates appear under **Create** with the titles listed above.

## Secrets and tokens to prepare

### On GitHub (for the generated repositories)

The scaffolding creates the pipeline, but GitHub needs to be allowed to push the
resulting container image. **No secret has to be created manually for the
default setup:**

| Secret / setting | Required | Action |
| ---------------- | -------- | ------ |
| `GITHUB_TOKEN` | Yes | Nothing – GitHub injects it automatically. The workflow declares `permissions: packages: write` so it can push to GHCR. |
| **Settings → Actions → General → Workflow permissions** | Recommended | Set to *Read and write permissions* if your organisation restricts the default token. |
| GHCR package visibility | Recommended | After the first successful push, open **Packages** and set visibility / link the package to the repository. |

Only needed for optional variants:

| Secret | When | How to create |
| ------ | ---- | ------------- |
| `DOCKERHUB_USERNAME` | Push to Docker Hub instead of GHCR | Repository → *Settings → Secrets and variables → Actions → New repository secret* |
| `DOCKERHUB_TOKEN` | Push to Docker Hub | Docker Hub → *Account settings → Security → New access token* (never the password) |
| `PIP_INDEX_URL` / `PIP_EXTRA_INDEX_URL` | Private Python package index | Repository *Variables* (or secret if it contains a token) |
| Maven `settings.xml` credentials | Private Maven repository | Repository secrets, injected into the Maven build |

### On Backstage (for publishing the new repositories)

`publish:github` needs a **GitHub Personal Access Token** (classic `repo` scope,
or a fine-grained token with *Administration: read & write* + *Contents: read &
write*) configured in `app-config.yaml`:

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}
```

Provide it to the Backstage backend via environment variable:

```bash
export GITHUB_TOKEN=ghp_xxx   # PAT of a technical user that can create repositories
```

## Template authoring notes

- Skeleton files use Nunjucks placeholders: `${{ values.componentId }}`,
  `${{ values.owner }}`, `${{ values.description }}` and
  `${{ values.destination }}` – the latter is the parsed repository URL, so use
  `${{ values.destination.host }}`, `${{ values.destination.owner }}` and
  `${{ values.destination.repo }}`.
- GitHub Actions expressions (`${{ github.sha }}`, `${{ secrets.GITHUB_TOKEN }}`)
  use the same syntax, so every workflow file is wrapped in
  `{% raw %}…{% endraw %}` to keep it literal. Keep the markers when editing
  files under `skeleton/.github/`.
- Dependency installation in the workflows is lockfile-tolerant
  (`npm ci` with an `npm install` fallback) so the pipeline is green on the very
  first run of a freshly scaffolded repository, before a lockfile is committed.
