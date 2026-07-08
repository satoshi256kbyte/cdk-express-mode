# cdk-express-mode

AWS **CloudFormation and CDK Express Mode**（2026年6月末リリース）の効果を、
実際の CDK スタックのデプロイ時間で定量検証するための検証プロジェクト。

検証設計の詳細は [docs/product-overview.md](docs/product-overview.md) を参照。

## Express Mode とは

スタック操作の完了判定を「リソース設定の適用が確認できた時点」に前倒しするデプロイモード。

従来 CloudFormation が完了まで待っていた以下の安定化チェックをバックグラウンドに回すことで、
デプロイ時間を **最大 4 倍** 高速化する。

- トラフィック準備（traffic readiness）
- リージョン伝播（region propagation）
- リソースのクリーンアップ（resource cleanup）

有効化は CDK なら `cdk deploy --express`、CLI なら `--deployment-config '{"mode": "EXPRESS"}'`。
テンプレート変更は不要で、ロールバックはデフォルト無効。

## Express Mode の恩恵を受けやすいサービス

ここが検証とブログの主眼。**「公式が数値付きで明記した例」と「仕組みから推測されるカテゴリ」は分けて扱う**。

### 公式が具体的に挙げていた例

出典は AWS 公式ブログおよび What's New ページ。数値付きで示されていたのは次の 2 つ **のみ**。

| サービス / 操作 | 通常モード | Express モード |
|-----------------|-----------|----------------|
| SQS + DLQ の作成 | 64 秒 | 最大 10 秒 |
| VPC 内 Lambda（ENI 付き）の削除 | 20〜30 分 | 最大 10 秒 |

### 仕組みから推測される「効果が大きいカテゴリ」

Express Mode が短縮するのは安定化・伝播・クリーンアップの待ち時間。
したがって、これらの処理が重いリソースほど恩恵が大きいと推測できる。
以下は公式には明記されていない、本プロジェクトで検証したい仮説対象。

- **VPC 内 Lambda / ENI**: ENI の作成・削除が遅く、削除は特に長い（公式例で実証済み）
- **ALB + ECS Fargate（一般的な Web サービス構成）**: ALB のヘルスチェックと ECS タスクの
  steady state 待ちが長く、Express Mode の効果が最も出やすい本命候補
- **RDS インスタンス**: 作成・変更時の安定化が長い
- **CloudFront ディストリビューション**: エッジへの伝播が長い（任意で追加）

> 注意: RDS・CloudFront・ELB・ECS は公式記事に明記されていない。
> 本プロジェクトの実測で、実際にどれだけ短縮されるかを検証する。

## 押さえておきたいポイント

### 「テンプレート変更は不要」とは

Express モードは **デプロイ時の指定** であって、テンプレート（CDK コード）側には一切書かない。

CloudFormation のデプロイは「テンプレート（何を作るか）」と「デプロイの指定（どう流すか）」に分かれる。
モードは後者に属し、`cdk deploy --express`（CLI なら `--deployment-config '{"mode":"EXPRESS"}'`）という
コマンドのフラグで指定する。

- テンプレートに Express 用のプロパティやリソースを追加しない
- 既存テンプレートを書き換えたり移行したりする必要がない
- **まったく同じテンプレート** を、通常モードでも Express モードでも流せる

このため本検証では CDK コードを 1 セットだけ用意し、フラグ違いで 2 回デプロイする。
変数がモードだけになるので、デプロイ時間の差を純粋に Express モードの効果として比較できる。

```bash
# 同じコード・同じ構成。違うのは prefix と --express だけ
cdk deploy -c prefix=normal
cdk deploy -c prefix=express --express
```

### ロールバック無効とは

通常の CloudFormation は、デプロイ途中でリソースが 1 つでも失敗すると
**スタック全体を直前の正常な状態に自動で巻き戻す**（新規作成なら作りかけを削除、更新なら元の設定へ戻す）。
失敗しても常に一貫した既知の正常状態が保たれる。

Express モードはこのロールバックがデフォルト無効。失敗しても **巻き戻さず、失敗した地点で止まったまま残る**。

- 作成/更新が済んだリソースは新しい設定のまま
- 失敗したリソースとそれ以降は古いまま、または未作成
- つまりスタックが「新旧が混ざった中途半端な状態」で残る

そのうえでコードを直して再デプロイすると、巻き戻しを待たずに続きから進む（fix-and-retry の高速化）。
ロールバック自体の待ち時間すら省く、という開発イテレーション向けの思想。
本番向けには `disableRollback: false` で再有効化できる。

### 本番で Express モードを避けるべき理由（警戒点は 2 つ）

この 2 つは独立しており、両方が本番リスクになる。

1. **ロールバック無効**: 失敗時に本番スタックが壊れた混在状態で残り、自動復旧しない
2. **安定化を待たずに完了判定**: トラフィック準備などが終わる前に「完了」と返る。
   CloudFormation が成功と言っても、実際にはまだトラフィックを捌けない瞬間があり得る

`disableRollback: false` にすれば 1 は回避できるが、2（安定化スキップ）は Express モードの本質なので残る。
本番では「完了＝トラフィック準備完了」であってほしい場面が多く、開発・検証環境向けの機能と割り切るのが素直。

## 出典

- [AWS CloudFormation and CDK express mode speeds up infrastructure deployments by up to 4x（What's New）](https://aws.amazon.com/about-aws/whats-new/2026/06/aws-cloudformation-cdk/)
- [Accelerate your infrastructure deployments by up to 4x with AWS CloudFormation Express mode（AWS Blog）](https://aws.amazon.com/blogs/aws/accelerate-your-infrastructure-deployments-by-up-to-4x-with-aws-cloudformation-express-mode/)

## セットアップ

```bash
npm install
```

前提:

- AWS 認証情報が設定済みで、対象リージョン（既定 `ap-northeast-1`）が CDK bootstrap 済みであること。
- このアカウントは **VPC Block Public Access がデフォルト有効**なため、インターネット通信が必要な
  VPC には除外設定が必要（詳細は [AGENTS.md](AGENTS.md)）。本リポジトリのスタックは対応済み。

## ビルド・テスト（デプロイ不要・課金なし）

```bash
npm run build   # tsc
npm run lint    # ESLint
npm test        # Jest + cdk-nag（合成テンプレートの検証）
```

## デプロイ時間の計測

計測は `diag/measure.sh` で行う。次の順番で `cdk deploy` の開始・終了時刻と所要秒（wall-clock）を記録する。

1. **各サービスを単独スタックで新規作成**（deploy → destroy）
   - 公式ブログで効果が高いとされるリソース群: `sqs`（SQS + DLQ）/ `lambda`（VPC 内 Lambda）/ `sns` / `ssm`
   - 一般的なコンテナ Web サービス構成: `alb` / `ecs`（Fargate）/ `rds`
2. **全サービスを 1 スタックで新規作成**（`composite`）
3. **その `composite` に SQS + DLQ をもう 1 セット追加する更新**（既存スタックへの小さな追加）

狙いは「新規の大きな複合スタックでは効果が薄いが、既存スタックへの小さな追加更新では効く」という
仮説を、Express なし・ありの所要時間で比較して確かめること。3 の更新は手作業ではなく CDK 更新で行う。

```bash
# 通常モード
./diag/measure.sh normal

# Express モード
./diag/measure.sh express
```

- 2 つのターミナルで **同時実行してよい**。モードごとに synth 出力（`cdk.out.n` / `cdk.out.e`）、
  結果ファイル、スタック名（`n-*` / `e-*`）を分離しているため衝突しない。
- 結果は `measurements/results.normal.tsv` / `measurements/results.express.tsv` に出力される
  （列: `service, mode, deploy_start, deploy_end, wall_seconds, status`）。
- 各デプロイの詳細ログは `measurements/logs/<stack>.log`。
- 各スタックは計測後に自動で `destroy` される。RDS・ECS・VPC 内 Lambda の削除待ちで、
  1 モードあたり 20〜40 分ほどかかる。

計測後、2 つの結果ファイルを突き合わせて通常モードと Express モードを比較する。

詳細な検証シナリオ・計測方法・ディレクトリ構成は [docs/product-overview.md](docs/product-overview.md) にまとめている。

## CI/CD パイプライン

Express Mode の効果を自動で継続的に比較するため、3 パターンの CI/CD パイプラインを用意。
各パターンで `normal`/`express` ブランチを監視し、合計 6 デプロイが独立して動作する。

デプロイ対象は SQS + DLQ のみの最小スタック（`bin/cicd-app.ts`）。

| パターン | 方式 | スタック |
|---|---|---|
| GitHub Actions Only | Reusable workflow で CDK deploy 直接実行 | なし（YAML のみ） |
| CodePipeline V2 Only | ブランチ別に 2 本のパイプライン | `dev-cicd-codepipeline-{normal,express}` |
| Hybrid | GitHub Actions → S3 → CodePipeline V2（1本） | `dev-cicd-hybrid` |

### CI/CD スタックのデプロイ

```bash
cd cicd
npx cdk deploy --all
```

`cicd/cdk.json` の context を事前に設定する（`connectionArn` 等）。
詳細は [AGENTS.md](AGENTS.md) を参照。

### 前提条件（手動事前設定）

- GitHub OIDC プロバイダー + IAM ロール → GitHub Secret `AWS_ROLE_ARN`
- Hybrid 用 IAM ロール → GitHub Secret `AWS_ROLE_ARN_HYBRID`
- CodeStar Connection → `cicd/cdk.json` の `connectionArn`
