import { App, Aspects } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { HeavyStack } from '../lib/heavy-stack';

describe('HeavyStack: リソース構成', () => {
  const app = new App();
  const stack = new HeavyStack(app, 'test-heavy', { prefix: 'test' });
  const template = Template.fromStack(stack);

  test('ALB（application ロードバランサー）が作成される', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Type: 'application',
    });
  });

  test('ECS Fargate サービスが desiredCount=2 で作成される', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      LaunchType: 'FARGATE',
      DesiredCount: 2,
    });
  });

  test('RDS インスタンスが作成される', () => {
    template.resourceCountIs('AWS::RDS::DBInstance', 1);
  });
});

describe('HeavyStack: cdk-nag', () => {
  const app = new App();
  const stack = new HeavyStack(app, 'nag-heavy', { prefix: 'nag' });
  Aspects.of(stack).add(new AwsSolutionsChecks());

  test('抑制後、cdk-nag のエラーが残らない', () => {
    const errors = Annotations.fromStack(stack).findError(
      '*',
      Match.stringLikeRegexp('AwsSolutions-.*'),
    );
    expect(errors).toHaveLength(0);
  });
});
