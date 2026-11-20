# Java Spring Boot Template (CI/CD + Docker)

Backstage software template that scaffolds a Spring Boot 4 / Java 25 (Maven)
service including:

- `src/main/java/com/example/demo` with a `@RestController` (`/`, `/health`) and
  Spring Boot Actuator
- `src/test/java` with `@SpringBootTest` tests
- `Dockerfile` (Maven build stage + JRE runtime, non-root user)
- `catalog-info.yaml` (registers the new component in the Backstage catalog)
- `.github/workflows/ci-cd.yaml` – resolves dependencies → builds and tests →
  builds a Docker image → pushes it to GHCR

## Pipeline

| Job | Runs on | What it does |
| --- | ------- | ------------ |
| `build-and-test` | every push/PR to `main` | `actions/setup-java@v4` (Temurin 25, Maven cache), `mvn dependency:go-offline`, `mvn clean verify`, uploads `target/*.jar` |
| `build-and-push-docker` | after `build-and-test`, pushes only (not on PRs) | logs in to `ghcr.io`, `docker/build-push-action@v6`, tags `latest` + commit SHA, GHCR layer cache |

The Docker job rebuilds the jar inside the image, so it does not depend on the
uploaded artifact. That keeps `docker build .` working standalone as well.

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
- **Private Maven repository**: add the credentials as secrets and pass them to
  Maven via `settings.xml` / `MAVEN_*` environment variables.

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

## Notes

- The Java package is `com.example.demo` and the group id is `com.example`.
  Rename them (and the folder structure) to match your organisation after the
  repository is created.
- GitHub Actions expressions (`${{ ... }}`) collide with Backstage's Nunjucks
  `${{ ... }}` syntax, so the workflow file is wrapped in
  `{% raw %}…{% endraw %}`. Keep those markers if you edit the pipeline inside
  `skeleton/`.

## Usage

Register `java-spring-boot-template/template.yaml` (or the repository
`catalog-info.yaml`) as a Location in Backstage, then run **Create** →
*Java Spring Boot Service with CI/CD and Docker*.
