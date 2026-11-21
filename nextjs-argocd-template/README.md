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

Security scans are report-only by default:

- Snyk and GitGuardian are skipped when their tokens are absent.
- OWASP, Trivy and Checkov use `continue-on-error` / `soft_fail`.
- Trivy uses `exit-code: '0'`; remove it to fail on `HIGH`/`CRITICAL`.
- Checkov uses `soft_fail: true`; set it to `false` to enforce policies.

## Secrets to prepare

### In the generated application repository

| Secret | Required | Purpose |
| ------ | -------- | ------- |
| `GITHUB_TOKEN` | automatic | GHCR push + GitOps manifest commit |
| `SNYK_TOKEN` | optional | Snyk scan |
| `NVD_API_KEY` | optional (recommended) | OWASP Dependency-Check NVD updates |
| `GITGUARDIAN_API_KEY` | optional | GitGuardian secret scan |
| `SLACK_WEBHOOK_URL` | optional | Slack notifications |

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
