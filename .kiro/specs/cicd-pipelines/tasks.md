# Implementation Plan: CI/CD Pipelines

## Overview

CDK Express Mode 検証プロジェクトに 3 パターンの CI/CD パイプラインを実装する。
既存の `bin/app.ts` とは分離された `bin/cicd.ts` エントリポイントと
`cicd/cdk.json` を作成し、CodePipelineStack と HybridStack の 2 つの CDK スタック、
および GitHub Actions ワークフロー 2 ファイルを実装する。

## Tasks

- [ ] 1. プロジェクト構造とエントリポイントのセットアップ
  - [ ] 1.1 `cicd/cdk.json` を作成する
    - `app` を `npx ts-node --prefer-ts-exts ../bin/cicd.ts` に設定
    - context に `githubOwner`, `githubRepo`, `githubBranch`, `connectionArn` を定義
    - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - [ ] 1.2 `bin/cicd.ts` エントリポイントを作成する
    - CDK App を作成し、context から `prefix`, `githubOwner`, `githubRepo`,
      `githubBranch`, `connectionArn` を取得
    - `prefix` のデフォルトを `'dev'` にする
    - `CodePipelineStack` と `HybridStack` をインスタンス化
    - `withPrefix` を使い `${prefix}-cicd-codepipeline`, `${prefix}-cicd-hybrid` の命名
    - `AwsSolutionsChecks` を Aspects で適用
    - _Requirements: 1.1, 5.2, 6.1, 6.2, 6.4_
  - [ ] 1.3 `lib/cicd/` ディレクトリを作成し、スタックの Props インターフェースを定義する
    - `CicdBaseProps` と `CodePipelineStackProps`, `HybridStackProps` を定義
    - _Requirements: 5.1_

- [ ] 2. CodePipelineStack の実装
  - [ ] 2.1 `lib/cicd/codepipeline-stack.ts` を作成する
    - CodePipeline V2 タイプのパイプラインを作成
    - CodeStar Connections によるソースアクション
    - CodeBuild プロジェクト（npm ci + cdk synth + cdk deploy）
    - パイプライン実行ロールと CodeBuild ロールを分離
    - Artifact 用 S3 バケット
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.1, 7.3_
  - [ ]* 2.2 CodePipelineStack のユニットテストを作成する
    - `test/cicd/codepipeline-stack.test.ts` を作成
    - CodePipeline が V2 タイプで作成されることを検証
    - Source Action が CodeStarSourceConnection を使用することを検証
    - CodeBuild プロジェクトが存在し適切な buildspec を持つことを検証
    - 各ステージに別々の IAM Role が割り当てられていることを検証
    - _Requirements: 3.1, 3.3, 7.3_

- [ ] 3. HybridStack の実装
  - [ ] 3.1 `lib/cicd/hybrid-stack.ts` を作成する
    - Source Bucket を作成（固定キー `source/latest.zip`）
    - CodePipeline V2 タイプ、S3 Source Action（polling/event trigger 無効）
    - Pipeline Variables として `branch`, `commitSHA` を定義
    - CodeBuild プロジェクト（pipeline variables を環境変数として受け取り、
      npm ci + cdk deploy を実行）
    - パイプライン実行ロールと CodeBuild ロールを分離
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 5.1, 6.3, 7.4_
  - [ ]* 3.2 HybridStack のユニットテストを作成する
    - `test/cicd/hybrid-stack.test.ts` を作成
    - Source Bucket が作成されることを検証
    - CodePipeline が V2 タイプで S3 Source Action を使用することを検証
    - S3 Source Action の polling/event trigger が無効であることを検証
    - Pipeline Variables（branch, commitSHA）が定義されていることを検証
    - _Requirements: 4.4, 4.6, 4.7_

- [ ] 4. Checkpoint - CDK スタックの合成確認
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. GitHub Actions ワークフローの実装
  - [ ] 5.1 `.github/workflows/deploy-actions.yml` を作成する
    - push イベントで指定ブランチにトリガー
    - OIDC 認証（`aws-actions/configure-aws-credentials`）
    - `npm ci` → `cdk synth` → `cdk deploy --all -c prefix=<value>`
    - `timeout-minutes: 30` を設定
    - cdk synth 失敗時に deploy に進まない構成
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 7.1_
  - [ ] 5.2 `.github/workflows/deploy-hybrid.yml` を作成する
    - push イベントで指定ブランチにトリガー
    - OIDC 認証（`AWS_ROLE_ARN_HYBRID` シークレット使用）
    - ソースコードを zip 化し S3 にアップロード（`source/latest.zip`）
    - `codepipeline:StartPipelineExecution` API を呼び出し、
      pipeline variables（branch, commitSHA）を渡す
    - S3 アップロードまたは StartPipelineExecution 失敗時にワークフロー失敗
    - `timeout-minutes: 30` を設定
    - _Requirements: 4.1, 4.2, 4.3, 4.8, 7.1, 7.4_

- [ ] 6. cdk-nag 検証とスナップショットテスト
  - [ ]* 6.1 cdk-nag 検証テストを作成する
    - `test/cicd/nag.test.ts` を作成
    - CodePipelineStack と HybridStack に `AwsSolutionsChecks` を適用
    - cdk-nag の警告・エラーがゼロ（または明示的な NagSuppressions あり）を検証
    - _Requirements: 7.3, 7.5_
  - [ ]* 6.2 スナップショットテストを作成する
    - `test/cicd/snapshot.test.ts` を作成
    - CodePipelineStack と HybridStack の合成テンプレートの
      スナップショットを保持し、意図しない変更を検出する
    - _Requirements: 5.1_

- [ ] 7. 分離の検証と命名規約テスト
  - [ ]* 7.1 分離と命名規約のテストを作成する
    - `test/cicd/naming.test.ts` を作成
    - 全スタック名が `${prefix}-cicd-${type}` パターンに従うことを検証
    - `withPrefix` が正しく適用されていることを検証
    - CICD_Stacks が App_Stacks のモジュールを import していないことを
      ファイル依存関係レベルで確認（静的解析または import チェック）
    - _Requirements: 1.4, 6.1, 6.2_

- [ ] 8. Final checkpoint - 全テスト通過確認
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- OIDC プロバイダーと IAM ロールは手動事前設定のため、CDK スタックには含めない
- GitHub Actions Only パターンは CDK スタック不要（ワークフロー YAML のみ）
- `withPrefix` は既存の `lib/naming.ts` からインポートして使用する
- テストは CDK assertions + スナップショット + cdk-nag で構成（PBT なし）
- `cicd/` ディレクトリから `cdk deploy` するか、
  ルートから `cdk --app "npx ts-node bin/cicd.ts" deploy --all` で実行

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "5.1", "5.2"] },
    { "id": 3, "tasks": ["2.2", "3.2", "6.1", "6.2", "7.1"] }
  ]
}
```
