# Implementation Plan: CI/CD Pipelines

## Overview

CDK Express Mode 検証プロジェクトに 3 パターンの CI/CD パイプラインを実装する。
既存の実装をリファクタリングし、設計書に基づく新しい構造へ移行する。

主な変更点:

- `bin/cicd.ts`: CodePipelineStack × 2（normal / express）+ HybridStack × 1
- `bin/cicd-app.ts`: パイプラインのデプロイ対象（SQS + DLQ 最小スタック）を新規作成
- `lib/cicd/types.ts`: Props に `express`, `deployPrefix`, `branch` を追加、
  `githubBranch` をベースから除去
- `lib/cicd/codepipeline-stack.ts`: express/deployPrefix 対応、
  `--app "npx ts-node bin/cicd-app.ts"` 使用
- `lib/cicd/hybrid-stack.ts`: Pipeline Variables に `prefix`/`express` 追加、
  条件付き buildspec
- `cicd/cdk.json`: `normalBranch`, `expressBranch` に変更
- GitHub Actions: reusable + caller パターンへ移行（6 ワークフローファイル）

## Tasks

- [ ] 1. 古いファイルの削除と基盤整備
  - [ ] 1.1 不要な GitHub Actions ワークフローを削除する
    - `.github/workflows/deploy-actions.yml` を削除
    - `.github/workflows/deploy-hybrid.yml` を削除
    - 新しい reusable + caller パターンに置き換えるため
    - _Requirements: 4.1, 5.1, 5.2_
  - [ ] 1.2 既存テストのスナップショットを削除する
    - `test/cicd/__snapshots__/` 配下を全て削除
    - 新しい構造に合わせて再生成するため
    - _Requirements: N/A（準備作業）_

- [ ] 2. Props とエントリポイントの更新
  - [ ] 2.1 `lib/cicd/types.ts` を更新する
    - `CicdBaseProps` から `githubBranch` を削除
    - `CodePipelineStackProps` に `express: boolean`,
      `deployPrefix: string`, `branch: string` を追加
    - `HybridStackProps` は追加プロパティなし（Pipeline Variables で動的切替）
    - _Requirements: 6.1, 6.2, 6.3, 7.1_
  - [ ] 2.2 `bin/cicd-app.ts` を新規作成する
    - `CicdSqsStack` クラスを定義（SQS + DLQ、`enforceSSL: true`）
    - `prefix` context を取得し `${prefix}-cicd-sqs` でスタック名生成
    - デフォルト prefix は `'dev'`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [ ] 2.3 `bin/cicd.ts` を更新する
    - `normalBranch`, `expressBranch` を context から取得
    - `CodePipelineStack` を 2 回インスタンス化:
      - `${prefix}-cicd-codepipeline-normal`（express=false, deployPrefix='cp-normal',
        branch=normalBranch）
      - `${prefix}-cicd-codepipeline-express`（express=true, deployPrefix='cp-express',
        branch=expressBranch）
    - `HybridStack` を 1 回インスタンス化: `${prefix}-cicd-hybrid`
    - _Requirements: 1.1, 1.2, 1.3, 6.1, 6.2, 9.2, 9.4_
  - [ ] 2.4 `cicd/cdk.json` を更新する
    - `githubBranch` を削除し `normalBranch`, `expressBranch` を追加
    - デフォルト値: `normalBranch: "normal"`, `expressBranch: "express"`
    - _Requirements: 3.1, 3.2, 9.4_

- [ ] 3. CodePipelineStack のリファクタリング
  - [ ] 3.1 `lib/cicd/codepipeline-stack.ts` をリファクタリングする
    - Props から `express`, `deployPrefix`, `branch` を利用
    - Artifact Bucket 名を
      `withPrefix(prefix, 'cicd-codepipeline-${mode}-artifacts')` に変更
      （mode は deployPrefix の末尾部分: normal or express）
    - CodeBuild buildspec を更新:
      - `--app "npx ts-node bin/cicd-app.ts"` を synth/deploy に追加
      - `-c prefix=${deployPrefix}` を使用
      - `express: true` なら `--express` フラグを追加
    - パイプライン名を
      `withPrefix(prefix, 'cicd-codepipeline-${normal|express}')` に変更
    - CodeBuild プロジェクト名も同様にモード別に分離
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9,
      8.1, 8.2, 9.1, 9.2, 9.3, 10.3_

- [ ] 4. HybridStack のリファクタリング
  - [ ] 4.1 `lib/cicd/hybrid-stack.ts` をリファクタリングする
    - Pipeline Variables に `prefix` と `express` を追加
      （既存の `branch`, `commitSHA` に加えて）
    - CodeBuild 環境変数に `PREFIX`, `EXPRESS` を Pipeline Variables から注入
    - buildspec を条件付きに変更:
      - `if [ "$EXPRESS" = "true" ]; then EXPRESS_FLAG="--express"; fi`
      - `npx cdk deploy --all --app "npx ts-node bin/cicd-app.ts"
        -c prefix=$PREFIX --require-approval never $EXPRESS_FLAG`
    - `--app "npx ts-node bin/cicd-app.ts"` を使用
    - _Requirements: 7.1, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 8.1, 9.2_

- [ ] 5. Checkpoint - CDK スタックの合成確認
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. GitHub Actions Reusable Workflow の実装
  - [ ] 6.1 `.github/workflows/_deploy.yml` を更新する
    - `--app "npx ts-node bin/cicd-app.ts"` を synth/deploy コマンドに追加
    - 既存の `prefix`, `express` inputs と `AWS_ROLE_ARN` secret はそのまま活用
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7_
  - [ ] 6.2 `.github/workflows/_trigger-pipeline.yml` を新規作成する
    - `workflow_call` inputs: `prefix`, `express`, `source-bucket`,
      `pipeline-name`
    - secrets: `AWS_ROLE_ARN`
    - ステップ: checkout → configure-aws-credentials → zip → S3 upload →
      `start-pipeline-execution` with variables
    - `timeout-minutes: 30`
    - _Requirements: 4.2, 7.2, 7.3, 7.4, 7.5, 7.11_

- [ ] 7. GitHub Actions Caller Workflow の実装
  - [ ] 7.1 `.github/workflows/deploy-normal.yml` を新規作成する
    - `push` to `normal` branch でトリガー
    - `_deploy.yml` を呼び出し: `prefix=ga-normal`, `express=false`
    - _Requirements: 3.1, 3.3, 3.4, 5.1, 5.3, 5.4_
  - [ ] 7.2 `.github/workflows/deploy-express.yml` を新規作成する
    - `push` to `express` branch でトリガー
    - `_deploy.yml` を呼び出し: `prefix=ga-express`, `express=true`
    - _Requirements: 3.2, 3.3, 3.4, 5.2, 5.3, 5.5_
  - [ ] 7.3 `.github/workflows/hybrid-normal.yml` を新規作成する
    - `push` to `normal` branch でトリガー
    - `_trigger-pipeline.yml` を呼び出し: `prefix=hy-normal`, `express=false`,
      `source-bucket` と `pipeline-name` を指定
    - _Requirements: 3.1, 3.3, 3.4, 7.2, 7.4_
  - [ ] 7.4 `.github/workflows/hybrid-express.yml` を新規作成する
    - `push` to `express` branch でトリガー
    - `_trigger-pipeline.yml` を呼び出し: `prefix=hy-express`, `express=true`,
      `source-bucket` と `pipeline-name` を指定
    - _Requirements: 3.2, 3.3, 3.4, 7.3, 7.4_

- [ ] 8. Checkpoint - ワークフロー YAML の整合性確認
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. ユニットテストの書き直し
  - [ ] 9.1 `test/cicd/cicd-app-stack.test.ts` を新規作成する
    - SQS Queue が 2 つ（Main + DLQ）作成されることを検証
    - 両方の Queue に `enforceSSL: true` が設定されることを検証
    - DLQ が Main Queue の DeadLetterQueue として設定されることを検証
    - スタック名が `${prefix}-cicd-sqs` パターンに従うことを検証
    - _Requirements: 2.1, 2.3, 2.4_
  - [ ] 9.2 `test/cicd/codepipeline-stack.test.ts` を書き直す
    - Normal / Express 両方のインスタンスをテスト
    - CodePipeline が V2 タイプで作成されることを検証
    - Source Action が正しいブランチを監視することを検証
    - Normal buildspec に `--express` が含まれないことを検証
    - Express buildspec に `--express` が含まれることを検証
    - `--app "npx ts-node bin/cicd-app.ts"` が buildspec に含まれることを検証
    - `deployPrefix` が正しく使用されることを検証
    - _Requirements: 6.1, 6.2, 6.3, 6.7, 6.9_
  - [ ] 9.3 `test/cicd/hybrid-stack.test.ts` を書き直す
    - Source Bucket が作成されることを検証
    - S3 Source Action の polling 無効を検証
    - Pipeline Variables（branch, commitSHA, prefix, express）が定義されていることを検証
    - CodeBuild buildspec に条件付き `--express` ロジックが含まれることを検証
    - `--app "npx ts-node bin/cicd-app.ts"` が buildspec に含まれることを検証
    - _Requirements: 7.1, 7.6, 7.7, 7.8_
  - [ ] 9.4 `test/cicd/naming.test.ts` を更新する
    - 新しいスタック名パターンを検証:
      `${prefix}-cicd-codepipeline-normal`,
      `${prefix}-cicd-codepipeline-express`, `${prefix}-cicd-hybrid`
    - `withPrefix` の適用を確認
    - CICD_Stacks が App_Stacks のモジュールを import していないことを確認
    - _Requirements: 1.4, 9.1, 9.2, 9.3_

- [ ] 10. cdk-nag とスナップショットテストの更新
  - [ ] 10.1 `test/cicd/nag.test.ts` を更新する
    - CodePipelineStack × 2（normal, express）+ HybridStack に対して
      `AwsSolutionsChecks` を適用
    - cdk-nag エラーがゼロであることを検証
    - 必要な NagSuppressions が適用されていることを確認
    - _Requirements: 10.3, 10.5_
  - [ ] 10.2 `test/cicd/snapshot.test.ts` を更新する
    - 新しい 3 スタック構造（CodePipeline-normal, CodePipeline-express, Hybrid）に合わせて
      スナップショットテストを更新
    - `bin/cicd-app.ts` の CicdSqsStack もスナップショット対象に追加
    - _Requirements: 8.1_

- [ ] 11. Final checkpoint - 全テスト通過確認
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- OIDC プロバイダーと IAM ロールは手動事前設定のため、CDK スタックには含めない
- GitHub Actions Only パターンは CDK スタック不要（ワークフロー YAML のみ）
- `withPrefix` は既存の `lib/naming.ts` からインポートして使用する
- テストは CDK assertions + スナップショット + cdk-nag で構成（PBT なし）
- `cicd/` ディレクトリから `cdk deploy --all` するか、
  ルートから `cdk --app "npx ts-node bin/cicd.ts" deploy --all` で実行
- パイプラインがデプロイする対象は `bin/cicd-app.ts`（SQS + DLQ のみ）
- `bin/cicd.ts` はパイプラインインフラ自体を作成する
- 既存の `_deploy.yml` は更新して再利用する（削除不要）

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.4"] },
    { "id": 2, "tasks": ["2.3", "3.1", "4.1"] },
    { "id": 3, "tasks": ["6.1", "6.2", "7.1", "7.2", "7.3", "7.4"] },
    { "id": 4, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "id": 5, "tasks": ["10.1", "10.2"] }
  ]
}
```
