# actions-manual-approval

GitHub Action (Node.js) que substitui o **wait timer nativo** de repository environments por um
**timer cancelável por aprovação**.

O wait timer nativo do GitHub continua contando mesmo depois que um *required reviewer* aprova o
deployment. Esta action implementa um timer próprio que:

1. é **interrompido assim que um required reviewer aprova** (o job protegido segue imediatamente);
2. ao **expirar sem aprovação**, executa a `default-action`:
   - `approve` — aprova o deployment pendente via API (com `user-token` ou `app-token`);
   - `cancel` — cancela o workflow run e falha o job.

## Como funciona

Um job que referencia um environment com *Required reviewers* não inicia enquanto o deployment
está pendente — portanto a action **roda em um job paralelo** (sem `environment`) do mesmo workflow
run e observa o deployment pendente do job protegido:

```
workflow run
├── job "timer"   (sem environment) ── roda esta action, faz polling do run
└── job "deploy"  (environment: production, Required reviewers) ── aguarda revisão
```

1. O job `deploy` fica pendente aguardando revisão.
2. A action inicia o polling (`poll-interval`, padrão 30s) por até `wait-timer` minutos, consultando
   `GET /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments` e
   `GET /repos/{owner}/{repo}/actions/runs/{run_id}/approvals`.
3. Se um required reviewer aprovar antes do fim (diretamente ou como membro de um team revisor,
   verificado via `GET /orgs/{org}/teams/{team}/memberships/{user}`), a action termina com sucesso
   (`result=approved`) e o timer é ignorado. Com autenticação de GitHub App, ela também aprova a
   custom protection rule dos environments aprovados. Uma rejeição também encerra a action
   (`result=rejected`), sem executar a `default-action`.
4. Se o timer expirar sem aprovação, a `default-action` é executada:
   - `approve` + `user-token`: `POST /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments`
     com `state: approved` e os `environment_ids` pendentes;
   - `approve` + `app-token`: `POST /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule`
     com `state: approved` e `environment_name`;
   - `cancel`: `POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel` e `core.setFailed`.

> Remova o *Wait timer* nativo do environment: esta action o substitui.

## Inputs

| Input | Obrigatório | Padrão | Descrição |
| --- | --- | --- | --- |
| `wait-timer` | sim | — | Tempo de espera em minutos (inteiro positivo). |
| `default-action` | sim | — | Ação ao expirar sem aprovação: `approve` ou `cancel`. |
| `user-token` | não* | — | PAT de um required reviewer. Aprova via API de pending deployments. |
| `app-token` | não* | — | Installation token do GitHub App configurado como custom deployment protection rule, gerado antes com [`actions/create-github-app-token@v3`](https://github.com/actions/create-github-app-token). |
| `environment` | não | `${{ github.event.deployment.environment }}` | Environment observado. Vazio = todos os deployments pendentes do run. Obrigatório para `approve` via GitHub App. |
| `poll-interval` | não | `30` | Intervalo de polling em segundos (5–300). |

\* `user-token` e `app-token` são **mutuamente exclusivos**: exatamente um deles deve ser informado.
Inputs inválidos falham o job com mensagens que listam todos os erros.

> Os inputs `app-id` e `app-private-key` foram removidos na `v3`: gere o token com
> `actions/create-github-app-token@v3` e passe-o em `app-token` (veja
> [Configuração com GitHub App](#configuração-com-github-app-custom-deployment-protection-rule)).

## Outputs

| Output | Valores |
| --- | --- |
| `result` | `approved`, `rejected`, `auto-approved` ou `cancelled` |

## Job summary e logs

A action escreve automaticamente no [job summary](https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions#adding-a-job-summary)
(`core.summary`), sem configuração adicional:

- **Configuração** (ao iniciar, após validar os inputs): wait timer (min), poll interval (s),
  environment alvo, `default-action`, modo de autenticação (`user`/`app`) e run ID.
- **Resultado** (em toda saída — `approved`, `rejected`, `auto-approved`, `cancelled`, `aborted` ou
  `error`): resultado, tempo decorrido, `default-action` executada (ou `none`) e motivo.

Nos logs:

| Evento | Tipo | Título |
| --- | --- | --- |
| Início do watch | notice | `Wait timer started` |
| Aprovação por required reviewer | notice | `Approved by reviewer` / `Result: approved` |
| Rejeição por required reviewer | warning | `Rejected by reviewer` / `Result: rejected` |
| Timer expirado | notice | `Wait timer expired` |
| Aprovação automática | notice | `Result: auto-approved` |
| Falha em um poll (tentado novamente no próximo) | warning | `Approval check` |
| Falha ao cancelar o run via API | warning | `Cancel workflow run` |
| Cancelamento / erro / inputs inválidos | error (`core.setFailed`) | — |

Os inputs validados ficam no grupo colapsável **Configuration**; a contagem regressiva
(`Waiting for a required reviewer... Xm left.`) é logada fora de grupo, uma linha por poll.

## Uso

### Versões

| Referência | Comportamento |
| --- | --- |
| `@v3` | Major tag flutuante: recebe automaticamente correções e features compatíveis (`3.x.y`). Recomendado. |
| `@v3.0.0` | Versão exata e imutável. |
| `@<sha>` | Commit específico, para máxima segurança contra alterações de tags. |

Breaking changes geram uma nova major e não afetam quem referencia a major anterior.

| Major | Runtime (`runs.using`) | Runner mínimo |
| --- | --- | --- |
| `v3` | `node24` (remove `app-id`/`app-private-key`; padrão de `poll-interval` 30s) | [v2.327.1](https://github.com/actions/runner/releases/tag/v2.327.1) |
| `v2` | `node24` | [v2.327.1](https://github.com/actions/runner/releases/tag/v2.327.1) |
| `v1` | `node20` (descontinuado pelo GitHub; não recebe mais atualizações) | — |

Runners hospedados pelo GitHub já atendem ao requisito. Em **runners self-hosted**, atualize o runner
para v2.327.1 ou superior antes de migrar de `@v1` para `@v2`/`@v3`; até lá, continue usando `@v1`.

Migração `@v2` → `@v3`: substitua `app-id`/`app-private-key` por um step
`actions/create-github-app-token@v3` cujo token é passado em `app-token`. Se você dependia do
intervalo de polling de 15s, defina `poll-interval: 15` explicitamente.

### Environment com Required reviewers

Em **Settings → Environments → `production`**:

- marque **Required reviewers** e adicione os usuários/teams revisores;
- **desmarque** o *Wait timer* nativo;
- (opcional) desmarque *Prevent self-review* conforme sua política.

### Diretamente em um workflow

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  approval-timer:
    runs-on: ubuntu-latest
    steps:
      - uses: validation-projects/actions-manual-approval@v3
        with:
          wait-timer: 30
          default-action: approve
          environment: production
          user-token: ${{ secrets.APPROVER_PAT }}

  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: echo "deploying..."
```

### Como reusable workflow (`workflow_call`)

`.github/workflows/approval-timer.yml`:

```yaml
name: Approval timer

on:
  workflow_call:
    inputs:
      environment:
        type: string
        required: true
      wait-timer:
        type: number
        required: true
      default-action:
        type: string
        default: cancel
    secrets:
      user-token:
        required: false
      app-token:
        required: false

jobs:
  timer:
    runs-on: ubuntu-latest
    permissions:
      actions: read
    steps:
      - uses: validation-projects/actions-manual-approval@v3
        with:
          environment: ${{ inputs.environment }}
          wait-timer: ${{ inputs.wait-timer }}
          default-action: ${{ inputs.default-action }}
          user-token: ${{ secrets.user-token }}
          app-token: ${{ secrets.app-token }}
```

Caller:

```yaml
jobs:
  approval-timer:
    uses: ./.github/workflows/approval-timer.yml
    with:
      environment: production
      wait-timer: 30
      default-action: approve
    secrets:
      user-token: ${{ secrets.APPROVER_PAT }}

  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: echo "deploying..."
```

O job do reusable workflow roda no mesmo workflow run do caller (`github.run_id` é o mesmo), então a
action enxerga o deployment pendente do job `deploy`. Não declare `needs` entre os dois jobs: eles
precisam rodar em paralelo.

### Configuração com PAT (`user-token`)

- O PAT deve pertencer a um usuário que seja **required reviewer** do environment (direto ou via
  team), caso contrário a aprovação automática é recusada (`current_user_can_approve: false`).
- Escopos: PAT classic com `repo`; ou fine-grained com **Actions: Read and write**,
  **Deployments: Read and write** e **Environments: Read** no repositório, mais
  **Organization → Members: Read** se houver teams revisores.
- `default-action: cancel` usa o mesmo token para cancelar o run (**Actions: write**).
- Salve como secret (ex.: `APPROVER_PAT`).

### Configuração com GitHub App (custom deployment protection rule)

1. Crie um GitHub App com permissões **Actions: Read and write**, **Deployments: Read and write**,
   **Environments: Read** (e **Members: Read** se houver teams revisores) e instale-o no repositório.
2. Em **Settings → Environments → `production`**, habilite o App em
   **Deployment protection rules** (custom protection rule).
3. Gere o installation token em um step anterior com
   [`actions/create-github-app-token@v3`](https://github.com/actions/create-github-app-token) e
   passe-o em `app-token`. A action não gera nem renova tokens.

```yaml
jobs:
  approval-timer:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v3
        id: app
        with:
          client-id: ${{ vars.APPROVER_APP_CLIENT_ID }}
          private-key: ${{ secrets.APPROVER_APP_PRIVATE_KEY }}

      - uses: validation-projects/actions-manual-approval@v3
        with:
          wait-timer: 30
          default-action: approve
          environment: production
          app-token: ${{ steps.app.outputs.token }}
```

Ao expirar sem aprovação, a action aprova a protection rule do App para o environment. Quando um
required reviewer aprova antes, a action também responde à protection rule do App. O GitHub só
libera o job quando **todas** as protection rules do environment estiverem satisfeitas.

> **Limitação conhecida:** installation tokens expiram **1 hora** após serem gerados e a action não
> os renova. O token precisa continuar válido durante toda a espera **e** na ação final (aprovar ou
> cancelar). Gere-o imediatamente antes do step da action (sem steps demorados entre os dois) e
> mantenha `wait-timer` com folga abaixo de 60 minutos. Para esperas mais longas, use `user-token`.

## Desenvolvimento

```bash
npm ci
npm run lint
npm test
npm run build   # gera dist/index.js com @vercel/ncc — commite o resultado
```

O CI (`.github/workflows/ci.yml`) roda em `push` e `pull_request` para `main`: lint, testes, build e
`git diff --exit-code dist/`, que falha se o `dist/` commitado estiver desatualizado em relação ao
build. A versão do Node vem de `engines.node` no `package.json` (alinhada ao `node24` do `action.yml`).

## Convenção de commits

As versões são calculadas pelo [semantic-release](https://semantic-release.gitbook.io/) a partir de
[Conventional Commits](https://www.conventionalcommits.org/) (preset `conventionalcommits`):

| Commit | Exemplo | Release |
| --- | --- | --- |
| `fix:` | `fix: ignora aprovações de reviewers fora do environment` | patch (`1.0.0` → `1.0.1`) |
| `feat:` | `feat: adiciona input poll-timeout` | minor (`1.0.0` → `1.1.0`) |
| `!` após o tipo ou footer `BREAKING CHANGE:` | `feat!: remove input user-token` | major (`1.0.0` → `2.0.0`) |
| `chore:`, `docs:`, `test:`, `ci:`, `refactor:`, `style:`, `build:` | `docs: corrige exemplo` | sem release |

Exemplo de breaking change com footer:

```
feat: renomeia input default-action para on-timeout

BREAKING CHANGE: o input default-action foi removido; use on-timeout.
```

Com *squash merge*, o **título do PR** vira a mensagem do commit em `main` e, portanto, precisa
seguir a convenção.

## Fluxo de release

1. O PR é mergeado em `main` (o CI garante que `dist/` está atualizado).
2. O workflow `.github/workflows/release.yml` roda em `push` para `main`: `npm ci`, lint, testes e
   `npm run build` (antes do semantic-release), depois `npx semantic-release` com `.releaserc.json`:
   - `@semantic-release/commit-analyzer` determina o tipo de release a partir dos commits desde a última tag;
   - `@semantic-release/release-notes-generator` gera as notas;
   - `@semantic-release/changelog` atualiza o `CHANGELOG.md`;
   - `@semantic-release/npm` (com `npmPublish: false`, nada é publicado) atualiza `version` no `package.json`/`package-lock.json`;
   - `@semantic-release/git` commita `CHANGELOG.md`, `package.json`, `package-lock.json` e `dist/` como
     `chore(release): X.Y.Z [skip ci]`;
   - `@semantic-release/github` cria a tag `vX.Y.Z` e o GitHub Release, e comenta nos issues/PRs incluídos.
3. A major tag flutuante (`v1`, `v2`, …) é movida para o commit da nova release, então
   `uses: validation-projects/actions-manual-approval@v3` sempre aponta para a última `v3.x.y`.

O campo `version` do `package.json` é atualizado pelo semantic-release em cada release; a fonte da
verdade são as tags `vX.Y.Z`.

> O workflow usa o `GITHUB_TOKEN` (permissões `contents`, `issues` e `pull-requests: write`) para
> commitar em `main` e criar tags. Se `main` tiver branch protection que bloqueie pushes diretos, permita
> o bypass para o GitHub Actions ou troque o token por um de GitHub App/PAT com essa permissão.

### Estrutura

| Arquivo | Responsabilidade |
| --- | --- |
| `src/index.js` | Orquestrador: inputs → cliente Octokit (`github.getOctokit(token)`) → polling → aprovação ou cancelamento; logs e summaries. |
| `src/main.js` | Entry point do bundle (`ncc build src/main.js`). |
| `src/inputs.js` | Parsing e validação dos inputs (inclui regra XOR `user-token`/`app-token`). |
| `src/approval-check.js` | Detecta aprovação/rejeição por required reviewers (incluindo teams). |
| `src/wait.js` | Loop de polling com `setTimeout`, abortável via `AbortController`. |
| `src/approve.js` | Aprovação via pending deployments (PAT) ou protection rule (App). |
| `src/cancel.js` | Cancelamento do run e falha do job. |
| `src/summary.js` | Job summaries (configuração e resultado) via `core.summary`. |
| `.releaserc.json` | Configuração do semantic-release. |
