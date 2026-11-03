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
2. A action inicia o polling (`poll-interval`, padrão 15s) por até `wait-timer` minutos, consultando
   `GET /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments` e
   `GET /repos/{owner}/{repo}/actions/runs/{run_id}/approvals`.
3. Se um required reviewer aprovar antes do fim (diretamente ou como membro de um team revisor,
   verificado via `GET /orgs/{org}/teams/{team}/memberships/{user}`), a action termina com sucesso
   (`result=approved`) e o timer é ignorado. Uma rejeição também encerra a action
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
| `app-token` | não* | — | Installation token do GitHub App configurado como custom deployment protection rule. |
| `app-id` | não | — | Alternativa ao `app-token`: ID do GitHub App (gera o installation token com `@octokit/auth-app`). |
| `app-private-key` | não | — | Alternativa ao `app-token`: chave privada (PEM) do GitHub App. Requer `app-id`. |
| `environment` | não | `${{ github.event.deployment.environment }}` | Environment observado. Vazio = todos os deployments pendentes do run. Obrigatório para `approve` via GitHub App. |
| `poll-interval` | não | `15` | Intervalo de polling em segundos (5–300). |

\* `user-token` e `app-token` (ou `app-id`/`app-private-key`) são **mutuamente exclusivos**: exatamente
um deles deve ser informado. Inputs inválidos falham o job com mensagens que listam todos os erros.

## Outputs

| Output | Valores |
| --- | --- |
| `result` | `approved`, `rejected`, `auto-approved` ou `cancelled` |

## Uso

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
      - uses: validation-projects/actions-manual-approval@v1
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
      - uses: validation-projects/actions-manual-approval@v1
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
3. Forneça o token ao workflow:
   - gerando o installation token antes, ex. com
     [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token), e passando-o em `app-token`; ou
   - passando `app-id` e `app-private-key` diretamente para a action.

```yaml
jobs:
  approval-timer:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v1
        id: app
        with:
          app-id: ${{ vars.APPROVER_APP_ID }}
          private-key: ${{ secrets.APPROVER_APP_PRIVATE_KEY }}

      - uses: validation-projects/actions-manual-approval@v1
        with:
          wait-timer: 30
          default-action: approve
          environment: production
          app-token: ${{ steps.app.outputs.token }}
```

Ao expirar, a action aprova a protection rule do App para o environment. O GitHub só libera o job
quando **todas** as protection rules do environment estiverem satisfeitas.

## Desenvolvimento

```bash
npm ci
npm run lint
npm test
npm run build   # gera dist/index.js com @vercel/ncc — commite o resultado
```

O CI (`.github/workflows/ci.yml`) roda lint, testes e verifica se `dist/` está atualizado.

### Estrutura

| Arquivo | Responsabilidade |
| --- | --- |
| `src/index.js` | Orquestrador: inputs → polling → aprovação ou cancelamento. |
| `src/main.js` | Entry point do bundle (`ncc build src/main.js`). |
| `src/inputs.js` | Parsing e validação dos inputs (inclui regra XOR `user-token`/`app-token`). |
| `src/auth.js` | Resolução do token (installation token via `@octokit/auth-app`). |
| `src/approval-check.js` | Detecta aprovação/rejeição por required reviewers (incluindo teams). |
| `src/wait.js` | Loop de polling com `setTimeout`, abortável via `AbortController`. |
| `src/approve.js` | Aprovação via pending deployments (PAT) ou protection rule (App). |
| `src/cancel.js` | Cancelamento do run e falha do job. |
