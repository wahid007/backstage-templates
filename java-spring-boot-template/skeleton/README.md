# ${{ values.componentId }}

${{ values.description }}

Spring Boot 4 / Java 25 service (Maven) scaffolded with Backstage.

## Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/` | Greeting payload |
| `GET` | `/health` | Actuator health probe |

## Getting started

Requires JDK 25 and Maven 3.9+.

```bash
mvn clean verify          # build + run the tests
mvn spring-boot:run       # http://localhost:8080
```

Package only:

```bash
mvn -DskipTests clean package
java -jar target/${{ values.componentId }}.jar
```

## Docker

```bash
docker build -t ${{ values.componentId }} .
docker run --rm -p 8080:8080 ${{ values.componentId }}
```

The image is built in two stages: Maven compiles and packages the application,
and the runtime image only contains a JRE plus the fat jar (non-root user).

## CI/CD pipeline

`.github/workflows/ci-cd.yaml` runs on every push / pull request to `main`:

1. **build-and-test** – checks out the repo, installs Temurin JDK 25 with Maven
   caching, resolves dependencies (`dependency:go-offline`), runs
   `mvn clean verify` and uploads the resulting jar as a workflow artifact.
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
