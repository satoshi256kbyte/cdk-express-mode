#!/usr/bin/env node
// 診断用: 公式例（SQS + DLQ のみ）の最小スタック。
// Express モードで「64秒 → 10秒」が再現するかを、他リソースの影響なしに検証する。
import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

class MinimalSqsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const dlq = new sqs.Queue(this, 'Dlq', { enforceSSL: true });
    new sqs.Queue(this, 'Main', {
      enforceSSL: true,
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });
  }
}

const app = new cdk.App();
const prefix: string = app.node.tryGetContext('prefix') ?? 'diag';
new MinimalSqsStack(app, `${prefix}-minimal-sqs`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
  },
});
