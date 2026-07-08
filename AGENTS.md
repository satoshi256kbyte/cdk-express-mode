# AGENTS.md

このファイルは AI コーディングエージェントがプロジェクトを理解するための手引きです。

## プロジェクト概要

CDK Express Mode の効果を実測検証するプロジェクト。
通常モード（`-c prefix=normal`）と Express モード（`-c prefix=express --express`）で
同じスタックをデプロイし、所要時間を比較する。

## 前提条件

- Node.js 20+
- AWS CLI v2 + 認証情報設定済み
- 対象リージョン（`ap-northeast-1`）が CDK bootstrap 済み
- VPC Block Public Access がアカウントレベルで有効
  （インターネット通信が必要な VPC には BPA 除外設定が必須）

## ビルド・テスト

```bash
npm ci
npm run build    # tsc
npm run lint     # eslint
npm test         # jest (全テスト)
```

## デプロイ手順

### App_Stacks（検証用スタック: LightStack + HeavyStack）

`bin/app.ts` で定義。計測対象のリソース群（SQS, Lambda, SNS, SSM, ALB, ECS, RDS）。

```bash
# 通常モード
npx cdk deploy --all -c prefix=normal

# Express モード
npx cdk deploy --all -c prefix=express --express

# 削除
npx cdk destroy --all -c prefix=normal
npx cdk destroy --all -c prefix=express
```

プロジェクトルートの `cdk.json` が使われる。
`--app` 指定なしで `bin/app.ts` → `LightStack` + `HeavyStack` がデプロイされる。

### CICD_Stacks（CI/CD パイプラインインフラ）

`bin/cicd.ts` で定義。CodePipeline V2（normal/express の 2 本）+ Hybrid（1 本）。

```bash
# cicd/ ディレクトリから実行
cd cicd
npx cdk deploy --all

# または、プロジェクトルートから --app 指定
npx cdk deploy --all --app "npx ts-node bin/cicd.ts"

# 削除
cd cicd && npx cdk destroy --all
```

`cicd/cdk.json` の context で以下を設定:

| キー | 説明 | デフォルト |
|------|------|-----------|
| `githubOwner` | GitHub リポジトリオーナー | `OWNER` |
| `githubRepo` | GitHub リポジトリ名 | `cdk-express-mode` |
| `normalBranch` | 通常モード用ブランチ | `normal` |
| `expressBranch` | Express モード用ブランチ | `express` |
| `connectionArn` | CodeStar Connection ARN | `""` |

デプロイされるスタック（prefix=`dev` の場合）:

- `dev-cicd-codepipeline-normal` — normal ブランチを監視する CodePipeline V2
- `dev-cicd-codepipeline-express` — express ブランチを監視する CodePipeline V2
- `dev-cicd-hybrid` — Hybrid パイプライン（Pipeline Variables で動的切替）

### CICD_App_Stack（パイプラインのデプロイ対象: SQS + DLQ のみ）

`bin/cicd-app.ts` で定義。CI/CD パイプラインが実際にデプロイする最小スタック。

```bash
# 手動テスト用（通常は CI/CD パイプラインが自動で実行）
npx cdk deploy --all --app "npx ts-node bin/cicd-app.ts" -c prefix=test

# Express モード
npx cdk deploy --all --app "npx ts-node bin/cicd-app.ts" -c prefix=test --express

# 削除
npx cdk destroy --all --app "npx ts-node bin/cicd-app.ts" -c prefix=test
```

各パイプラインが使用する prefix:

| パイプラインパターン | ブランチ | Prefix | Express |
|---|---|---|---|
| GitHub Actions | normal | `ga-normal` | なし |
| GitHub Actions | express | `ga-express` | あり |
| CodePipeline V2 | normal | `cp-normal` | なし |
| CodePipeline V2 | express | `cp-express` | あり |
| Hybrid | normal | `hy-normal` | なし |
| Hybrid | express | `hy-express` | あり |

## CI/CD パイプラインの構成

3 パターン × 2 モード（normal/express）= 6 デプロイで Express Mode の効果を自動比較。

### Pattern 1: GitHub Actions Only

- Reusable workflow: `.github/workflows/_deploy.yml`
- Caller: `deploy-normal.yml`（normal ブランチ push）、`deploy-express.yml`（express ブランチ push）
- AWS 側に追加リソースなし（OIDC ロールは手動事前設定）

### Pattern 2: CodePipeline V2 Only

- ブランチごとにパイプラインを分離（ベストプラクティス）
- `dev-cicd-codepipeline-normal`: normal ブランチ → `cdk deploy -c prefix=cp-normal`
- `dev-cicd-codepipeline-express`: express ブランチ → `cdk deploy -c prefix=cp-express --express`

### Pattern 3: Hybrid（GitHub Actions + CodePipeline V2）

- パイプラインは 1 本（`dev-cicd-hybrid`）
- GitHub Actions が S3 アップロード + `StartPipelineExecution` でトリガー
- Pipeline Variables（`branch`, `commitSHA`, `prefix`, `express`）で動的切替
- CodeBuild 内で `if [ "$EXPRESS" = "true" ]` により `--express` を条件付与
- Reusable workflow: `.github/workflows/_trigger-pipeline.yml`
- Caller: `hybrid-normal.yml`、`hybrid-express.yml`

## 手動事前設定（CDK 管理外）

以下は CDK スタックに含まれず、手動で事前作成が必要:

- OIDC プロバイダー: `token.actions.githubusercontent.com`
- IAM ロール（GitHub Actions デプロイ用）→ GitHub Secret `AWS_ROLE_ARN`
- IAM ロール（Hybrid トリガー用: S3 PutObject + StartPipelineExecution）
  → GitHub Secret `AWS_ROLE_ARN_HYBRID`
- CodeStar Connection（CodePipeline 用）→ `cicd/cdk.json` の `connectionArn`

## ディレクトリ構成

```text
bin/
├── app.ts          # App_Stacks（Light + Heavy）
├── cicd.ts         # CICD_Stacks（パイプラインインフラ）
└── cicd-app.ts     # CICD_App_Stack（最小デプロイ対象: SQS + DLQ）

lib/
├── naming.ts       # withPrefix ヘルパー
├── light-stack.ts  # 軽量セット（SQS, Lambda, SNS, SSM）
├── heavy-stack.ts  # 重量セット（ALB, ECS, RDS）
└── cicd/
    ├── types.ts              # Props 型定義
    ├── codepipeline-stack.ts # CodePipeline V2（1インスタンス=1パイプライン）
    └── hybrid-stack.ts       # Hybrid パイプライン

.github/workflows/
├── _deploy.yml           # Reusable: CDK デプロイ
├── _trigger-pipeline.yml # Reusable: Hybrid トリガー
├── deploy-normal.yml     # Caller: normal → _deploy.yml
├── deploy-express.yml    # Caller: express → _deploy.yml
├── hybrid-normal.yml     # Caller: normal → _trigger-pipeline.yml
└── hybrid-express.yml    # Caller: express → _trigger-pipeline.yml

cicd/
└── cdk.json              # CICD 専用 CDK 設定

diag/
├── measure.sh            # 計測スクリプト
└── single.ts             # 単独スタック計測エントリ
```

## 計測

```bash
./diag/measure.sh normal    # 通常モード計測
./diag/measure.sh express   # Express モード計測
```

結果は `measurements/results.{normal,express}.tsv` に出力される。
