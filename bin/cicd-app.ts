#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

class CicdSqsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const dlq = new sqs.Queue(this, 'Dlq', { enforceSSL: true });
    new sqs.Queue(this, 'Main', {
      enforceSSL: true,
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });

    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-SQS3', reason: 'DLQ 自体に DLQ は不要。' },
    ]);
  }
}

const app = new cdk.App();
const prefix: string = app.node.tryGetContext('prefix') ?? 'dev';
new CicdSqsStack(app, `${prefix}-cicd-sqs`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
  },
});

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
