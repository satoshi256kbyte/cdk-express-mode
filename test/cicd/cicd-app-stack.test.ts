import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';

// bin/cicd-app.ts の CicdSqsStack は export されていないため、テスト用に再現する
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

describe('CicdSqsStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new CicdSqsStack(app, 'test-cicd-sqs');
    template = Template.fromStack(stack);
  });

  test('SQS Queue が 2 つ作成される', () => {
    template.resourceCountIs('AWS::SQS::Queue', 2);
  });

  test('両方の Queue に enforceSSL ポリシーが設定される', () => {
    // enforceSSL は QueuePolicy に Deny + aws:SecureTransport=false を追加する
    template.resourceCountIs('AWS::SQS::QueuePolicy', 2);
    template.hasResourceProperties('AWS::SQS::QueuePolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      }),
    });
  });

  test('DLQ が Main Queue の DeadLetterQueue として設定される', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: Match.objectLike({
        maxReceiveCount: 3,
      }),
    });
  });

  test('スタック名が prefix-cicd-sqs パターンに従う', () => {
    const app = new cdk.App();
    const stack = new CicdSqsStack(app, 'myprefix-cicd-sqs');
    expect(stack.stackName).toBe('myprefix-cicd-sqs');
  });
});
