import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as rds from 'aws-cdk-lib/aws-rds';
import { NagSuppressions } from 'cdk-nag';

export interface HeavyStackProps extends StackProps {
  /** スタック名・物理名の衝突を避けるためのプレフィックス。 */
  readonly prefix: string;
}

/**
 * 重量セット（一般的な Web サービス構成・安定化が重い）。
 *
 * - ALB + ECS Fargate: タスクが steady state に達するまでの待ちが長く、
 *   Express モードの効果が最も出やすい本命候補。
 * - RDS: 作成・変更時の安定化が長い。
 *
 * 物理名は基本的に指定せず、CDK のスタック名込み自動命名に任せることで、
 * 通常モード/Express モードのスタックが共存してもリソース名が衝突しない。
 */
export class HeavyStack extends Stack {
  constructor(scope: Construct, id: string, props: HeavyStackProps) {
    super(scope, id, props);

    // 一般的な Web サービス構成として、Fargate タスクはプライベートサブネットに置き、
    // NAT ゲートウェイ経由で egress させる。RDS もプライベートに配置する。
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // このアカウントは VPC Block Public Access（VPC BPA）が block-bidirectional で
    // 有効になっており、IGW 経由の通信がアカウント全体でブロックされている。
    // NAT ゲートウェイの egress も最終的に IGW を通るためブロック対象となり、
    // 除外を入れないと Fargate タスクがイメージ取得や CloudWatch 到達に失敗する。
    // この VPC を除外（exclusion）に登録して IGW 通信を許可する。
    const bpaExclusion = new ec2.CfnVPCBlockPublicAccessExclusion(this, 'BpaExclusion', {
      internetGatewayExclusionMode: 'allow-bidirectional',
      vpcId: vpc.vpcId,
    });

    // ALB + ECS Fargate（一般的なコンテナ Web サービス構成）。
    // desiredCount を 2 にして、ヘルスチェック安定化の待ち時間を観測しやすくする。
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 2,
      publicLoadBalancer: true,
      // 失敗時に最大 3 時間ハングしないよう、デプロイのサーキットブレーカーを有効化する。
      circuitBreaker: { rollback: false },
      healthCheckGracePeriod: Duration.seconds(60),
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/nginx/nginx:latest'),
        containerPort: 80,
      },
    });

    // ECS タスクが起動する前に BPA 除外が有効になっているよう依存関係を明示する。
    service.node.addDependency(bpaExclusion);

    // RDS（MySQL）。検証用に最小構成、削除しやすい設定にする。
    new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      allocatedStorage: 20,
      multiAz: false,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
      backupRetention: Duration.days(1),
    });

    this.addNagSuppressions();
  }

  /** 検証用に意図的に緩めた設定を、理由を明記して抑制する。 */
  private addNagSuppressions(): void {
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-VPC7', reason: '検証用。VPC フローログは対象外。' },
      { id: 'AwsSolutions-ELB2', reason: '検証用。ALB アクセスログは対象外。' },
      { id: 'AwsSolutions-EC23', reason: '検証用。パブリック Web のため 0.0.0.0/0 からのインバウンドを許容。' },
      { id: 'AwsSolutions-ECS2', reason: '検証用。タスク定義の環境変数を許容。' },
      { id: 'AwsSolutions-ECS4', reason: '検証用。Container Insights は対象外。' },
      { id: 'AwsSolutions-IAM4', reason: '検証用。ECS のタスク/実行ロールの AWS 管理ポリシーを許容。' },
      { id: 'AwsSolutions-IAM5', reason: '検証用。CDK 生成ロールのワイルドカード権限を許容。' },
      { id: 'AwsSolutions-RDS2', reason: '検証用。RDS の保管時暗号化は対象外。' },
      { id: 'AwsSolutions-RDS3', reason: '検証用。RDS のマルチ AZ は行わない。' },
      { id: 'AwsSolutions-RDS6', reason: '検証用。RDS の IAM 認証は対象外。' },
      { id: 'AwsSolutions-RDS10', reason: '検証用。削除しやすさのため削除保護を無効化。' },
      { id: 'AwsSolutions-RDS11', reason: '検証用。デフォルトポートを許容。' },
      { id: 'AwsSolutions-RDS13', reason: '検証用。バックアップ保持期間は最小とする。' },
      { id: 'AwsSolutions-SMG4', reason: '検証用。RDS 認証情報シークレットの自動ローテーションは対象外。' },
    ]);
  }
}
