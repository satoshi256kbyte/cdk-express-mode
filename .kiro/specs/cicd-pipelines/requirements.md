# Requirements Document

## Introduction

CDK Express Mode 検証プロジェクトに対して、開発環境へのデプロイを自動化する CI/CD パイプラインを
3 パターン用意する。GitHub Actions のみ、AWS CodePipeline V2 のみ、
および GitHub Actions + CodePipeline V2 ハイブリッドの 3 種類を、
アプリケーションスタックとは完全に分離された独立スタックとして実装する。

各パターンで「通常モード」と「Express モード」の 2 ブランチを監視し、
合計 6 デプロイ（3 パターン × 2 モード）が名前衝突なく共存できるようにする。
デプロイ対象は SQS + DLQ のみの最小スタックとし、
Express モードの有無による効果検証に集中する。

## Glossary

- **App_Stacks**: 既存の CDK Express Mode 検証用スタック
  （`${prefix}-light`, `${prefix}-heavy`）。`bin/app.ts` で定義される。
- **CICD_Stacks**: CI/CD パイプライン用に新規作成する CDK スタック群。
  App_Stacks とは別の CDK アプリエントリポイントから合成・デプロイされる。
- **CICD_App_Stack**: CI/CD パイプラインがデプロイする最小スタック。
  SQS + DLQ のみで構成され、Express モードの効果検証に使用する。
  `bin/cicd-app.ts`（または同等のエントリポイント）で定義される。
- **GitHub_Actions_Pipeline**: GitHub Actions ワークフローのみで
  CDK デプロイを実行するパイプライン。
- **CodePipeline_V2_Pipeline**: AWS CodePipeline V2 のみで
  CDK デプロイを実行するパイプライン。CodePipeline のリソース自体は CDK で作成する。
- **Hybrid_Pipeline**: GitHub Actions がトリガーとなり、
  ソースを S3 経由で CodePipeline V2 に渡すハイブリッドパイプライン。
- **Source_Bucket**: Hybrid_Pipeline でソースコードを受け渡すための S3 バケット。
- **CDK_App_Entry**: CDK アプリケーションのエントリポイントファイル
  （`bin/app.ts` や `bin/cicd.ts` など）。
- **Pipeline_Arguments**: Hybrid_Pipeline で GitHub Actions から CodePipeline V2 へ
  渡されるパラメータ（ブランチ名、S3 ソースパスなど）。
- **Reusable_Workflow**: GitHub Actions の `workflow_call` を使った
  再利用可能なワークフロー（`_deploy.yml`, `_trigger-pipeline.yml`）。
- **Normal_Branch**: 通常モード（Express なし）でデプロイするブランチ（`normal`）。
- **Express_Branch**: Express モードでデプロイするブランチ（`express`）。

## Requirements

### Requirement 1: アプリケーションスタックとの完全分離

**User Story:** As a 開発者, I want CI/CD スタックがアプリケーションスタックから
完全に分離されている, so that `cdk deploy --all` でアプリスタックをデプロイしても
CI/CD リソースが一緒にデプロイされない。

#### Acceptance Criteria

1. THE CICD_Stacks SHALL be defined in a separate CDK App entry-point file
   from App_Stacks, where App_Stacks are all stacks instantiated in
   `bin/app.ts` and CICD_Stacks are all stacks that provision
   CI/CD pipeline resources (CodePipeline, CodeBuild, etc.)
2. WHEN a developer runs `cdk deploy --all` without an explicit `--app`
   argument in the project root directory, THE CDK CLI SHALL synthesize and
   deploy only App_Stacks, producing zero CloudFormation templates for
   CICD_Stacks in the `cdk.out` directory
3. THE CICD_Stacks SHALL use a dedicated `--app` argument pointing to
   a different entry-point file (`bin/cicd.ts`), so that CICD_Stacks are
   never co-synthesized with App_Stacks under the project-root `cdk.json`
4. THE CICD_Stacks SHALL not import any TypeScript module that is exported
   by App_Stacks source files (`lib/light-stack.ts`, `lib/heavy-stack.ts`),
   and SHALL not create CDK cross-stack references (Fn::ImportValue) to
   App_Stacks
5. WHEN a developer runs `cdk list` without an explicit `--app` argument
   in the project root directory, THE CDK CLI SHALL output only App_Stack
   names and SHALL not include any CICD_Stack names

### Requirement 2: CI/CD 専用の最小デプロイ対象スタック

**User Story:** As a 開発者, I want CI/CD パイプラインのデプロイ対象が
SQS + DLQ のみの最小スタックである, so that Express モードの有無による
デプロイ時間の差を最小構成で検証できる。

#### Acceptance Criteria

1. THE CICD_App_Stack SHALL contain exactly one SQS queue with a
   dead-letter queue (DLQ) and no other AWS resources beyond those
   two queues
2. THE CICD_App_Stack SHALL be defined in a dedicated entry-point file
   (e.g., `bin/cicd-app.ts`) separate from both `bin/app.ts` and
   `bin/cicd.ts`
3. THE CICD_App_Stack SHALL accept a `prefix` context value to generate
   a unique stack name following the pattern `${prefix}-cicd-sqs`,
   falling back to `dev` when no prefix is provided
4. THE CICD_App_Stack SHALL set `enforceSSL: true` on both
   the main queue and the DLQ
5. WHEN a CI/CD pipeline deploys CICD_App_Stack, THE pipeline SHALL
   use the CICD_App_Stack entry-point file via `--app` argument
   (e.g., `--app 'npx ts-node bin/cicd-app.ts'`) to deploy only
   the minimal SQS stack

### Requirement 3: ブランチベースの Express モード切り替え

**User Story:** As a 開発者, I want ブランチごとに Express モードの有無を
切り替えてデプロイできる, so that 同一コードベースで通常モードと Express モードの
デプロイ時間を比較検証できる。

#### Acceptance Criteria

1. WHEN code is pushed to Normal_Branch, THE CI/CD pipeline SHALL execute
   `cdk deploy --all -c prefix=<prefix>` without the `--express` flag
2. WHEN code is pushed to Express_Branch, THE CI/CD pipeline SHALL execute
   `cdk deploy --all -c prefix=<prefix> --express` with the `--express` flag
3. THE CI/CD pipeline SHALL use a distinct prefix value per
   pipeline-pattern and mode combination to prevent CloudFormation
   stack name collisions across all 6 deployments
   (3 patterns × 2 modes)
4. THE prefix naming SHALL follow the pattern
   `${pattern-abbreviation}-${mode}` where pattern-abbreviation is one of
   `ga` (GitHub Actions), `cp` (CodePipeline), `hy` (Hybrid)
   and mode is one of `normal`, `express`
   (e.g., `ga-normal`, `ga-express`, `cp-normal`, `cp-express`,
   `hy-normal`, `hy-express`)

### Requirement 4: GitHub Actions Reusable Workflow

**User Story:** As a 開発者, I want GitHub Actions のデプロイロジックが
reusable workflow として共通化されている, so that
ブランチ別ワークフロー間でロジックの重複を排除できる。

#### Acceptance Criteria

1. THE GitHub_Actions_Pipeline SHALL provide a reusable deploy workflow
   (`_deploy.yml`) that accepts inputs for `prefix` (string),
   `express` (boolean), and a secret for `AWS_ROLE_ARN`
2. THE GitHub_Actions_Pipeline SHALL provide a reusable
   trigger-pipeline workflow (`_trigger-pipeline.yml`) that accepts
   inputs for the pipeline name, source bucket, prefix, and express flag,
   and a secret for `AWS_ROLE_ARN`
3. WHEN the `express` input is `true`, THE `_deploy.yml` workflow SHALL
   append `--express` to both `cdk synth` and `cdk deploy` commands
4. WHEN the `express` input is `false` or omitted, THE `_deploy.yml`
   workflow SHALL execute `cdk synth` and `cdk deploy` without the
   `--express` flag
5. THE `_deploy.yml` workflow SHALL use the CICD_App_Stack entry-point
   via `--app` argument so that only the minimal SQS stack is deployed
6. THE `_deploy.yml` workflow SHALL authenticate to AWS using OIDC
   federation (GitHub Actions identity provider)
7. THE `_deploy.yml` workflow SHALL define a `timeout-minutes` value of
   no more than 30 minutes per job to prevent runaway executions

### Requirement 5: GitHub Actions のみのパイプライン

**User Story:** As a 開発者, I want GitHub Actions だけで CDK デプロイを実行する
パイプラインを持つ, so that AWS 側に追加のパイプラインリソースを作らずに
開発環境へデプロイできる。

#### Acceptance Criteria

1. WHEN a push event occurs on Normal_Branch, THE GitHub_Actions_Pipeline
   SHALL trigger a workflow that calls `_deploy.yml` with
   `prefix=ga-normal` and `express=false`
2. WHEN a push event occurs on Express_Branch, THE GitHub_Actions_Pipeline
   SHALL trigger a workflow that calls `_deploy.yml` with
   `prefix=ga-express` and `express=true`
3. THE GitHub_Actions_Pipeline SHALL authenticate to AWS
   using OIDC federation (GitHub Actions identity provider)
4. THE GitHub_Actions_Pipeline SHALL install dependencies
   and run `cdk synth` before deploying; IF `cdk synth` fails,
   THEN the workflow SHALL fail before reaching the deploy step
5. IF the `cdk deploy` command fails,
   THEN THE GitHub_Actions_Pipeline SHALL report the failure
   as a non-zero exit code and fail the workflow run

### Requirement 6: CodePipeline V2 のみのパイプライン（ブランチ別分離）

**User Story:** As a 開発者, I want AWS CodePipeline V2 のみで CDK デプロイを
実行するパイプラインを持つ, so that AWS ネイティブなパイプラインで
開発環境へデプロイできる。

#### Acceptance Criteria

1. THE CodePipeline_V2_Pipeline SHALL provision two separate V2 type
   pipelines using CDK constructs within CICD_Stacks:
   `${prefix}-cicd-codepipeline-normal` watching Normal_Branch, and
   `${prefix}-cicd-codepipeline-express` watching Express_Branch
2. THE `${prefix}-cicd-codepipeline-normal` pipeline SHALL execute
   `cdk deploy --all -c prefix=cp-normal --require-approval never`
   without the `--express` flag
3. THE `${prefix}-cicd-codepipeline-express` pipeline SHALL execute
   `cdk deploy --all -c prefix=cp-express --require-approval never --express`
   with the `--express` flag
4. WHEN a code change is pushed to Normal_Branch, THE normal pipeline
   SHALL trigger a pipeline execution via CodeStar Connections
   source action configured for that branch
5. WHEN a code change is pushed to Express_Branch, THE express pipeline
   SHALL trigger a pipeline execution via CodeStar Connections
   source action configured for that branch
6. THE CodePipeline_V2_Pipeline SHALL include a source stage that
   retrieves code from the GitHub repository using
   AWS CodeStar Connections
7. THE CodePipeline_V2_Pipeline SHALL include a build/deploy stage
   that installs dependencies, runs `cdk synth`, and then executes
   `cdk deploy` with the appropriate prefix and express flag
8. IF the deploy stage fails,
   THEN THE CodePipeline_V2_Pipeline SHALL mark the pipeline execution
   as failed
9. THE CodePipeline_V2_Pipeline build stage SHALL use the CICD_App_Stack
   entry-point via `--app` argument so that only the minimal SQS stack
   is deployed

### Requirement 7: GitHub Actions + CodePipeline V2 ハイブリッドパイプライン

**User Story:** As a 開発者, I want GitHub Actions がトリガーとなり
CodePipeline V2 にソースを渡してデプロイを実行するハイブリッドパイプラインを持つ,
so that GitHub 側でトリガー制御を行いつつ AWS 側でデプロイを実行できる。

#### Acceptance Criteria

1. THE Hybrid_Pipeline SHALL provision a single V2 type pipeline using CDK
   constructs within CICD_Stacks, using Pipeline Variables to receive
   the `branch` value from GitHub Actions
2. WHEN a push event occurs on Normal_Branch, THE Hybrid_Pipeline SHALL
   trigger a GitHub Actions workflow that calls `_trigger-pipeline.yml`
   with `prefix=hy-normal` and `express=false`
3. WHEN a push event occurs on Express_Branch, THE Hybrid_Pipeline SHALL
   trigger a GitHub Actions workflow that calls `_trigger-pipeline.yml`
   with `prefix=hy-express` and `express=true`
4. THE GitHub Actions workflow in the Hybrid_Pipeline SHALL package
   the source code as a zip archive and upload it to a fixed S3 key
   (`source/latest.zip`) in Source_Bucket, overwriting the previous
   archive, using OIDC-federated AWS credentials
5. THE GitHub Actions workflow in the Hybrid_Pipeline SHALL invoke
   `codepipeline:StartPipelineExecution` API to trigger CodePipeline V2,
   passing Pipeline_Arguments (branch name, commit SHA, prefix,
   and express flag) as pipeline variables
6. THE CodePipeline V2 in the Hybrid_Pipeline SHALL use an S3 source
   action configured with Source_Bucket and the fixed key
   `source/latest.zip` to retrieve the source archive;
   the S3 source action's polling/event trigger SHALL be disabled
   so that only `StartPipelineExecution` initiates a run
7. THE CodePipeline V2 build stage SHALL receive the pipeline variables
   (branch name, commit SHA, prefix, express flag) as environment
   variables in CodeBuild, and SHALL conditionally append `--express`
   to the `cdk deploy` command when the express variable is `true`
8. THE CodePipeline V2 build stage SHALL use the CICD_App_Stack
   entry-point via `--app` argument so that only the minimal SQS stack
   is deployed
9. THE CodePipeline V2 in the Hybrid_Pipeline SHALL be a V2 type pipeline
   created with CDK constructs within CICD_Stacks
10. THE Source_Bucket SHALL be created as part of CICD_Stacks
11. IF the S3 upload or StartPipelineExecution call fails,
    THEN THE GitHub Actions workflow SHALL fail the workflow run
    with a non-zero exit code
12. IF the deploy stage in CodePipeline V2 fails,
    THEN THE pipeline execution SHALL be marked as failed

### Requirement 8: CodePipeline リソースの CDK による管理

**User Story:** As a 開発者, I want すべての CodePipeline 関連リソースが CDK で
定義される, so that パイプラインインフラもコードとして管理・再現できる。

#### Acceptance Criteria

1. THE CICD_Stacks SHALL define CodePipeline V2 パイプライン、
   パイプライン実行用 IAM ロール、ソースアクション、ビルドアクション、
   および Artifact 用 S3 バケットを CDK コンストラクトで定義する
2. THE CICD_Stacks SHALL スタック名および物理名を明示するリソースに対して
   `withPrefix` ヘルパーを使用し、既存の App_Stacks と同じプレフィックスベースの
   命名規則に従う
3. WHEN 開発者が CICD_Stacks のみをデプロイするとき、
   THE CICD_Stacks SHALL App_Stacks への Cross-Stack 参照を持たず、
   App_Stacks を合成・デプロイせずに単独で `cdk deploy` できる

### Requirement 9: プロジェクト命名規約との整合

**User Story:** As a 開発者, I want CI/CD スタックが既存の命名規約に従う,
so that プロジェクト内で一貫した命名体系を維持できる。

#### Acceptance Criteria

1. THE CICD_Stacks SHALL use the `withPrefix` helper function
   (or the equivalent `${prefix}-${name}` concatenation pattern)
   to generate stack names and physical resource names
2. THE CICD_Stacks stack names SHALL follow the pattern
   `${prefix}-cicd-${pipeline-type}` where pipeline-type identifies
   the pipeline variant
   (e.g., `dev-cicd-codepipeline-normal`, `dev-cicd-codepipeline-express`,
   `dev-cicd-hybrid`);
   the GitHub Actions Only pattern does not require a CDK stack
3. WHEN physical resource names are required
   (S3 bucket names, explicitly named IAM roles, or log groups),
   THE CICD_Stacks SHALL apply `withPrefix` and include the
   pipeline-type suffix to ensure uniqueness across all CI/CD patterns
   deployed simultaneously
4. THE CICD_Stacks SHALL obtain the prefix value from CDK context
   (`app.node.tryGetContext('prefix')`) and fall back to `dev`
   when no prefix is provided, consistent with the App_Stacks behavior
   in `bin/app.ts`
5. THE deploy-target prefix values SHALL be distinct per pipeline-pattern
   and mode combination: `ga-normal`, `ga-express`, `cp-normal`,
   `cp-express`, `hy-normal`, `hy-express`

### Requirement 10: セキュリティとアクセス制御

**User Story:** As a 開発者, I want CI/CD パイプラインが最小権限の原則に従う,
so that パイプラインが必要以上の AWS リソースにアクセスしない。

#### Acceptance Criteria

1. THE GitHub_Actions_Pipeline and Hybrid_Pipeline SHALL authenticate to
   AWS using OIDC IAM roles that are pre-provisioned manually outside of
   CICD_Stacks; the role ARN SHALL be referenced via the GitHub repository
   secret `AWS_ROLE_ARN`
2. THE CICD_Stacks SHALL NOT create OIDC providers or IAM roles for
   GitHub Actions OIDC federation; these are assumed to exist as a
   manual prerequisite
3. THE CodePipeline_V2_Pipeline SHALL use separate IAM roles for each
   pipeline stage (source, build, deploy), where each role grants
   only the permissions required for that stage's operations and does not
   include `"Resource":"*"` for IAM, STS, or Organizations actions
4. THE Hybrid_Pipeline's OIDC role (pre-provisioned) SHALL be scoped to
   `s3:PutObject` on the Source_Bucket
   and `codepipeline:StartPipelineExecution` on the target pipeline only;
   a separate CodeBuild role within CICD_Stacks handles CDK deployment
5. THE CICD_Stacks SHALL NOT grant any IAM role used by the pipelines
   the ability to create, update, or delete IAM policies or roles
   other than those managed by CDK bootstrap (the CDK execution role)
