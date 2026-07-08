import { StackProps } from 'aws-cdk-lib';

/**
 * CI/CD スタック共通の Props。
 * prefix と GitHub リポジトリ情報を全パイプラインスタックで共有する。
 */
export interface CicdBaseProps extends StackProps {
  /** スタック名・物理名の衝突を避けるためのプレフィックス。 */
  readonly prefix: string;
  /** GitHub リポジトリオーナー。 */
  readonly githubOwner: string;
  /** GitHub リポジトリ名。 */
  readonly githubRepo: string;
}

/**
 * CodePipeline V2 Only スタックの Props。
 * CodeStar Connection ARN に加え、ブランチ別の Express モード設定が必要。
 */
export interface CodePipelineStackProps extends CicdBaseProps {
  /** CodeStar Connections の ARN。 */
  readonly connectionArn: string;
  /** Express モードでデプロイするか。 */
  readonly express: boolean;
  /** デプロイ対象スタックに渡す prefix（例: 'cp-normal', 'cp-express'）。 */
  readonly deployPrefix: string;
  /** トリガー対象ブランチ。 */
  readonly branch: string;
}

/**
 * Hybrid（GitHub Actions + CodePipeline V2）スタックの Props。
 * Pipeline Variables で branch/prefix/express を動的に切り替えるため追加 props 不要。
 */
export interface HybridStackProps extends CicdBaseProps {
  // Pipeline Variables handle mode switching dynamically
}
