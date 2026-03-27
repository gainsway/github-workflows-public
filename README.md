# github-workflows-public

Reusable public GitHub Actions workflows for Gainsway repositories.

## Available Workflows

| Workflow | File | Purpose |
|---|---|---|
| Bruno Collection Sync | `.github/workflows/bruno-sync.yml` | Generate/sync Bruno collection files from an OpenAPI spec into a target repo |
| Validate Tag | `.github/workflows/job.validate-tag.yml` | Validate that a git tag matches semantic versioning (`vX.Y.Z[-pre][+meta]`) |
| NuGet CI | `.github/workflows/nuget.ci.yml` | Restore, build, and test .NET projects |
| NuGet Publish (GitHub Packages) | `.github/workflows/nuget.publish.yml` | Pack and publish NuGet packages to GitHub Packages |
| NuGet Publish (NuGet.org) | `.github/workflows/nuget.publish.nuget.org.yml` | Pack and publish NuGet packages to NuGet.org |

---

## Bruno Collection Sync

Reusable workflow: `gainsway/github-workflows-public/.github/workflows/bruno-sync.yml@main`

This workflow:
- checks out the calling service repository,
- checks out the target Bruno collection repository,
- checks out this workflow repository to run the local sync script,
- generates/updates `.bru` files from an OpenAPI JSON spec,
- commits and pushes changes to the target repository when changes are detected.

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `spec-path` | Yes | `openapi.json` | Path to OpenAPI spec file in the calling repository |
| `target-collection` | Yes | `bruno-collection/liquid/fund-management-service` | Target collection directory in the target repository |
| `local-dev-repo` | No | `gainsway/local-dev` | Repository to update with generated Bruno files |
| `scripts-path` | No | `scripts/bruno-sync` | Path to sync scripts inside this workflow repository |
| `node-version` | No | `20` | Node.js version for the sync script |
| `branches` | No | `main,master` | Reserved input for caller-side branch configuration |

### Secrets

| Secret | Required | Description |
|---|---|---|
| `GH_PAT` | Yes | Personal Access Token with `repo` scope to checkout/push target repo |

### Example

```yaml
name: Sync Bruno Collection

on:
  push:
    branches: [main, master]
    paths: [openapi.json]
  workflow_dispatch:

jobs:
  sync-bruno:
    uses: gainsway/github-workflows-public/.github/workflows/bruno-sync.yml@main
    with:
      spec-path: openapi.json
      target-collection: bruno-collection/liquid/your-service-name
    secrets:
      GH_PAT: ${{ secrets.GH_PAT }}
```

---

## Validate Tag

Reusable workflow: `gainsway/github-workflows-public/.github/workflows/job.validate-tag.yml@main`

Validates `github.ref_name` against a semantic version pattern (`v1.2.3`, with optional prerelease/build metadata).

### Inputs / Secrets

None.

### Example

```yaml
jobs:
  validate-tag:
    uses: gainsway/github-workflows-public/.github/workflows/job.validate-tag.yml@main
```

---

## NuGet CI

Reusable workflow: `gainsway/github-workflows-public/.github/workflows/nuget.ci.yml@main`

Runs .NET restore/build/test and configures GitHub Packages as a NuGet source.

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `dotnet-version` | Yes | `9.0.x` | .NET SDK version |

### Secrets

| Secret | Required | Description |
|---|---|---|
| `NUGET_TOKEN` | Yes | Token used to authenticate to GitHub Packages |

### Example

```yaml
jobs:
  ci:
    uses: gainsway/github-workflows-public/.github/workflows/nuget.ci.yml@main
    with:
      dotnet-version: 9.0.x
    secrets:
      NUGET_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## NuGet Publish (GitHub Packages)

Reusable workflow: `gainsway/github-workflows-public/.github/workflows/nuget.publish.yml@main`

Builds package versions with GitVersion, validates tags when running on tag refs, and pushes `.nupkg` files to GitHub Packages.

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `dotnet-version` | Yes | `9.0.x` | .NET SDK version |

### Secrets

| Secret | Required | Description |
|---|---|---|
| `NUGET_TOKEN` | Yes | Token used for pushing packages to GitHub Packages |

### Outputs

| Output | Description |
|---|---|
| `version` | `SemVer` from GitVersion |
| `commitsSinceVersionSource` | Commits since version source from GitVersion |

### Example

```yaml
on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    uses: gainsway/github-workflows-public/.github/workflows/nuget.publish.yml@main
    with:
      dotnet-version: 9.0.x
    secrets:
      NUGET_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## NuGet Publish (NuGet.org)

Reusable workflow: `gainsway/github-workflows-public/.github/workflows/nuget.publish.nuget.org.yml@main`

Builds package versions with GitVersion, validates tags when running on tag refs, and pushes `.nupkg` files to NuGet.org.

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `dotnet-version` | Yes | `9.0.x` | .NET SDK version |

### Secrets

| Secret | Required | Description |
|---|---|---|
| `NUGET_ORG_API_KEY` | Yes | API key used for publishing to NuGet.org |

### Outputs

| Output | Description |
|---|---|
| `version` | `SemVer` from GitVersion |
| `commitsSinceVersionSource` | Commits since version source from GitVersion |

### Example

```yaml
on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    uses: gainsway/github-workflows-public/.github/workflows/nuget.publish.nuget.org.yml@main
    with:
      dotnet-version: 9.0.x
    secrets:
      NUGET_ORG_API_KEY: ${{ secrets.NUGET_ORG_API_KEY }}
```
