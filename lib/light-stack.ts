import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';

export interface LightStackProps extends StackProps {
  /** スタック名・物理名の衝突を避けるためのプレフィックス。 */
  readonly prefix: string;
}

/**
 * 軽量セット（低コスト・差分が明確）。
 *
 * - SQS + DLQ: 公式が効果を明示した構成（通常 64 秒 → Express 最大 10 秒）
 * - VPC 内 Lambda: ENI の作成・削除が遅い代表例（削除で特に差が出る）
 * - SNS / SSM: 補助リソース
 */
export class LightStack extends Stack {
  constructor(scope: Construct, id: string, props: LightStackProps) {
    super(scope, id, props);
    const { prefix } = props;

    // SQS + DLQ
    const dlq = new sqs.Queue(this, 'Dlq', {
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    new sqs.Queue(this, 'MainQueue', {
      enforceSSL: true,
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });

    // VPC 内 Lambda。ENI の作成・削除が遅いため Express モードの効果が出やすい。
    // NAT ゲートウェイはコスト削減のため作らない（ENI の遅さ検証には不要）。
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    new lambda.Function(this, 'VpcFunction', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromInline(
        'exports.handler = async () => ({ statusCode: 200, body: "ok" });',
      ),
      vpc,
      timeout: Duration.seconds(30),
    });

    // SNS トピック
    new sns.Topic(this, 'Topic');

    // SSM パラメータ名はアカウント/リージョンで一意なため、プレフィックスを付与して衝突を回避する。
    new ssm.StringParameter(this, 'Parameter', {
      parameterName: `/${prefix}/express-mode/demo`,
      stringValue: 'express-mode-verification',
    });

    this.addNagSuppressions();
  }

  /** 検証用に意図的に緩めた設定を、理由を明記して抑制する。 */
  private addNagSuppressions(): void {
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-SQS3', reason: '検証用。DLQ 自体に更なる DLQ は不要。' },
      { id: 'AwsSolutions-IAM4', reason: '検証用。Lambda の基本実行/VPC アクセス管理ポリシーを許容。' },
      { id: 'AwsSolutions-IAM5', reason: '検証用。CDK 生成ロールのワイルドカード権限を許容。' },
      { id: 'AwsSolutions-L1', reason: '検証用。ランタイムは NODEJS_LATEST を使用。' },
      { id: 'AwsSolutions-VPC7', reason: '検証用。VPC フローログは対象外。' },
      { id: 'AwsSolutions-SNS2', reason: '検証用。SNS の保管時暗号化は対象外。' },
      { id: 'AwsSolutions-SNS3', reason: '検証用。SNS の SSL 強制は対象外。' },
    ]);
  }
}
