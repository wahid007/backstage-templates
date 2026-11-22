# Next.js + Argo CD GitOps Template

Backstage golden-path template that scaffolds a Next.js (App Router,
TypeScript) service with:

- **Kubernetes manifests** – a `Deployment` (probes, resource limits, non-root,
  read-only root filesystem), a `Service` of type `LoadBalancer` and a
  restrictive `NetworkPolicy`.
- **Hardened CI/CD pipeline** – lint, type-check, unit tests, build, Snyk,
  OWASP Dependency-Check, Trivy, Checkov, GitGuardian and Slack notifications.
- **Automated GitOps** – the generated repository is registered with the Argo CD
  app-of-apps repository (`gitops-infra`) through an automatically opened pull
  request, and the pipeline commits the immutable image SHA into the Kubernetes
  manifest after every successful build.

## Repository layout

```text
nextjs-argocd-template/
├── template.yaml                    # Backstage Template (parameters + steps)
├── README.md
├── gitops-infra/
│   ├── README.md
│   └── bootstrap/
│       └── app-of-apps.yaml          # root Argo CD Application (apply once)
├── gitops-skeleton/
│   └── apps/
│       └── ${{ values.componentId }}.yaml   # rendered into the app-of-apps PR
└── skeleton/
    ├── .github/workflows/ci-cd.yaml # CI/CD + security + GitOps pipeline
    ├── app/                         # Next.js App Router + /api/health
    ├── lib/                         # testable helpers
    ├── k8s/
    │   ├── deployment.yaml
    │   ├── service.yaml
    │   ├── networkpolicy.yaml
    │   └── kustomization.yaml
    ├── argocd/application.yaml      # standalone Argo CD Application
    ├── Dockerfile, .dockerignore
    ├── package.json, tsconfig.json, next.config.js
    ├── vitest.config.ts, .eslintrc.json
    ├── catalog-info.yaml
    └── README.md
```

## Parameters

| Parameter | Default | Description |
| --------- | ------- | ----------- |
| `name` | – | Component/repository name (EntityNamePicker) |
| `owner` | – | Backstage owner (OwnerPicker) |
| `description` | Next.js application… | Component description |
| `namespace` | `default` | Kubernetes namespace for the Deployment/Service |
| `replicas` | `1` | Deployment replica count (1–10) |
| `imagePullSecret` | – | Optional docker-registry secret in the target namespace for the private GHCR image |
| `repoUrl` | – | GitHub repository to create (RepoUrlPicker) |
| `gitopsRepoUrl` | `github.com?repo=gitops-infra&owner=wahid007` | Existing app-of-apps repository (RepoUrlPicker format) |
| `gitopsRepoBranch` | `main` | Branch of `gitops-infra` that Argo CD watches |
| `argocdNamespace` | `argocd` | Namespace of the Argo CD `Application` resources |
| `argocdProject` | `default` | Argo CD `AppProject` |
| `targetRevision` | `main` | Branch of the generated repository tracked by Argo CD |

## What the scaffolder does

1. `fetch:template` renders the Next.js skeleton (`./skeleton`) with all
   parameters.
2. `publish:github` creates the repository and pushes the skeleton.
3. `fetch:template` renders the app-of-apps fragment (`./gitops-skeleton`) to
   `./gitops/apps/<component>.yaml` (after publish, so it is not committed to
   the application repository).
4. `catalog:register` registers the new component in the Backstage catalog.
5. `publish:github:pull-request` opens/updates a PR against `gitopsRepoUrl`
   adding `apps/<component>.yaml` (branch
   `backstage/argocd-<component>`, `update: true` on re-runs).

The generated repository contains `argocd/application.yaml` as a standalone
copy of the `Application`, which is useful when the app-of-apps repository is
not used.

## GitOps flow

```text
Backstage template
      │
      ├─ creates app repo ───────────────► GitHub Actions
      │                                      │ lint / test / scan / build
      │                                      │ push image :<sha>
      │                                      └ commit k8s/deployment.yaml image tag
      │
      └─ PR to gitops-infra/apps/<name>.yaml
                    │
                    ▼
        Argo CD root Application (app-of-apps)
                    │ watches gitops-infra/apps/
                    ▼
        Argo CD Application <name>
                    │ watches app repo k8s/ @ targetRevision
                    ▼
        Deployment + Service in namespace <namespace>
```

### Bootstrap the app-of-apps repository once

The expected `gitops-infra` layout:

```text
gitops-infra/
├── bootstrap/app-of-apps.yaml   # root Application, applied once
└── apps/
    └── <component>.yaml          # added by the Backstage template PR
```

Apply the root Application:

```bash
kubectl apply -f gitops-infra/bootstrap/app-of-apps.yaml
```

The root Application uses `path: apps` with `directory.recurse: true`, so every
`Application` manifest committed under `apps/` is created and kept in sync.

> The URL in `gitops-infra/bootstrap/app-of-apps.yaml` is
> `https://github.com/wahid007/gitops-infra.git`. Change it if you use a fork.

### Argo CD access to private application repositories

`publish:github` creates **private** repositories by default. Configure
credentials in Argo CD for each generated repository (GitHub App, deploy key or
PAT) under **Settings → Repositories**. Without this, the `Application` stays in
`Unknown`/`ComparisonError`.

## Pipeline details

| Job | Trigger | Steps |
| --- | ------- | ----- |
| `lint-test` | push/PR to `main` | Node 24 + npm cache → install (lockfile-tolerant) → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build` |
| `security-scan` | after `lint-test` | Snyk (deps), OWASP Dependency-Check (HTML artifact), Trivy fs (SARIF), Checkov (k8s + Dockerfile, SARIF), GitGuardian (secrets); SARIF uploaded to the Security tab |
| `docker-build-push` | push to `main` only | GHCR login → build/push `latest` + `<sha>` → Trivy image scan → `sed` the SHA tag into `k8s/deployment.yaml` → commit `chore(gitops): deploy <sha> [skip ci]` |
| `notify` | always | Slack notification with each job result (no-op without `SLACK_WEBHOOK_URL`) |

### Report-only vs blocking

By default the scans are report-only:

| Scanner | Default | Missing token |
| ------- | ------- | ------------- |
| Snyk | `continue-on-error: true` | step is skipped |
| GitGuardian | `continue-on-error: true` | step is skipped |
| OWASP Dependency-Check | `continue-on-error: true`, no `--failOnCVSS` | still runs |
| Trivy | `continue-on-error: true`, `exit-code: '0'` | no token needed |
| Checkov | `continue-on-error: true`, `soft_fail: true` | no token needed |

To make one scanner blocking, remove its `continue-on-error` and set its fail
threshold. Keep the SARIF/artifact upload steps non-blocking.

#### Snyk

```yaml
      - name: Snyk Open Source Scan
        if: env.SNYK_TOKEN != ''
        uses: snyk/actions/node@master
        # remove: continue-on-error: true
        env:
          SNYK_TOKEN: ${{ env.SNYK_TOKEN }}
        with:
          args: --all-projects --severity-threshold=high
```

`snyk test` exits non-zero when vulnerabilities are found.
`--severity-threshold=high` limits failures to high/critical issues. The step is
still skipped when `SNYK_TOKEN` is absent; see “Require tokens when blocking”
below.

#### GitGuardian

```yaml
      - name: GitGuardian Secret Scan
        if: env.GITGUARDIAN_API_KEY != ''
        uses: GitGuardian/ggshield-action@v1
        # remove: continue-on-error: true
```

The action fails when a secret is detected. It is still skipped when
`GITGUARDIAN_API_KEY` is absent.

#### OWASP Dependency-Check

```yaml
      - name: OWASP Dependency-Check
        uses: dependency-check/Dependency-Check_Action@main
        # remove: continue-on-error: true
        with:
          args: '--enableRetired --failOnCVSS 7 --exclude node_modules/** --exclude .git/** --exclude reports/**'
```

`--failOnCVSS 7` fails on CVSS >= 7. Use `9` for critical-only. Without
`--failOnCVSS`, Dependency-Check never fails the build.

#### Trivy

Filesystem scan:

```yaml
      - name: Trivy Filesystem Scan
        uses: aquasecurity/trivy-action@0.28.0
        # remove: continue-on-error: true
        with:
          severity: 'CRITICAL,HIGH'
          ignore-unfixed: true
          exit-code: '1'
```

Image scan:

```yaml
      - name: Trivy Image Scan
        uses: aquasecurity/trivy-action@0.28.0
        # remove: continue-on-error: true
        with:
          severity: 'CRITICAL,HIGH'
          ignore-unfixed: true
          exit-code: '1'
```

Adjust `severity` to `CRITICAL` for critical-only enforcement.

#### Checkov

```yaml
      - name: Checkov IaC Scan
        uses: bridgecrewio/checkov-action@master
        # remove: continue-on-error: true
        with:
          soft_fail: false
          # optional accepted risks:
          skip_check: CKV_K8S_21,CKV_K8S_43
```

`soft_fail: false` fails on any policy violation. Use `skip_check` for accepted
risks such as the `default` namespace or an image tag that is not a digest.

#### Require tokens when blocking

A skipped step is not a failure. If Snyk/GitGuardian must never be skipped, add
a preflight step to `security-scan`:

```yaml
      - name: Require scanner credentials
        run: |
          test -n "$SNYK_TOKEN" || { echo "SNYK_TOKEN is missing"; exit 1; }
          test -n "$GITGUARDIAN_API_KEY" || { echo "GITGUARDIAN_API_KEY is missing"; exit 1; }
```

`NVD_API_KEY` is optional; without it OWASP Dependency-Check still runs, just
slower and rate-limited.

#### Effect on deployment

`docker-build-push` declares `needs: [lint-test, security-scan]`. A blocking
scan failure therefore stops the image push and the GitOps manifest commit. If
you want deployments to continue despite findings, remove `security-scan` from
the `needs` list or make the job non-blocking with `continue-on-error: true` at
job level.

## Secrets to prepare

### In the generated application repository

| Secret | Required | Purpose |
| ------ | -------- | ------- |
| `GITHUB_TOKEN` | automatic | GHCR push + GitOps manifest commit |
| `SNYK_TOKEN` | optional | Snyk scan |
| `NVD_API_KEY` | optional (recommended) | OWASP Dependency-Check NVD updates |
| `GITGUARDIAN_API_KEY` | optional | GitGuardian secret scan |
| `SLACK_WEBHOOK_URL` | optional | Slack notifications |

For `GITGUARDIAN_API_KEY`, create a GitGuardian API token with the **`scan`**
scope. That is the only scope required by the `ggshield-action` used in this
pipeline. Add `incidents:read` only if you enable `--with-incident-details`, and
`scan:create-incidents` only if you configure a source UUID so scans create
dashboard incidents.

### In Backstage (`app-config.yaml`)

`publish:github` and `publish:github:pull-request` use the GitHub integration:

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}   # PAT or GitHub App with repo + pull-request access
```

The token must be able to:

- create the generated repository,
- push to it (including `.github/workflows/`, which requires the `workflow`
  scope on a classic PAT or *Workflows: write* on a fine-grained token),
- create/update pull requests in `gitops-infra` (and read its contents).

## Register the template in Backstage

Register this template directly:

```text
https://github.com/<org>/backstage-templates/blob/main/nextjs-argocd-template/template.yaml
```

Or add it to the root `catalog-info.yaml` `spec.targets`:

```yaml
    - ./nextjs-argocd-template/template.yaml
```

Then choose **Create → Next.js App with CI/CD, Security Scans and Argo CD
GitOps**.

## Notes about templating

The skeleton files are rendered with Backstage's Nunjucks engine. GitHub Actions
expressions use the same `${{ ... }}` shape, so `skeleton/.github/workflows/ci-cd.yaml`
is wrapped in `{% raw %}…{% endraw %}`. Keep those markers when editing the
workflow inside `skeleton/`.

## Local validation

The skeleton is rendered by the Backstage scaffolder, so validate the generated
repository instead of the raw Nunjucks files. The generated app can be built
locally with:

```bash
cd <generated-repo>
npm install
npm run lint && npm run typecheck && npm test && npm run build
docker build -t nextjs-argocd-demo .
kubectl kustomize k8s
```
