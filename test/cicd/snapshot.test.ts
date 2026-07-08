import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import { CodePipelineStack } from '../../lib/cicd/codepipeline-stack';
import { HybridStack } from '../../lib/cicd/hybrid-stack';

// bin/cicd-app.ts の CicdSqsStack を再現（export されていないため）
class CicdSqsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const dlq = new sqs.Queue(this, 'Dlq', { enforceSSL: true });
    new sqs.Queue(this, 'Main', {
      enforceSSL: true,
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });
  }
}

describe('Snapshot tests', () => {
  test('CodePipelineStack (normal) matches snapshot', () => {
    const app = new cdk.App();
    const stack = new CodePipelineStack(app, 'SnapshotCPNormal', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      prefix: 'test',
      githubOwner: 'testOwner',
      githubRepo: 'testRepo',
      connectionArn: 'arn:aws:codestar-connections:ap-northeast-1:123456789012:connection/test-id',
      express: false,
      deployPrefix: 'cp-normal',
      branch: 'normal',
    });
    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });

  test('CodePipelineStack (express) matches snapshot', () => {
    const app = new cdk.App();
    const stack = new CodePipelineStack(app, 'SnapshotCPExpress', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      prefix: 'test',
      githubOwner: 'testOwner',
      githubRepo: 'testRepo',
      connectionArn: 'arn:aws:codestar-connections:ap-northeast-1:123456789012:connection/test-id',
      express: true,
      deployPrefix: 'cp-express',
      branch: 'express',
    });
    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });

  test('HybridStack matches snapshot', () => {
    const app = new cdk.App();
    const stack = new HybridStack(app, 'SnapshotHybrid', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      prefix: 'test',
      githubOwner: 'testOwner',
      githubRepo: 'testRepo',
    });
    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });

  test('CicdSqsStack matches snapshot', () => {
    const app = new cdk.App();
    const stack = new CicdSqsStack(app, 'SnapshotSqs');
    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });
});
