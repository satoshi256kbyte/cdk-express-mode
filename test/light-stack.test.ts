import { App, Aspects } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { LightStack } from '../lib/light-stack';

describe('LightStack: リソース構成', () => {
  const app = new App();
  const stack = new LightStack(app, 'test-light', { prefix: 'test' });
  const template = Template.fromStack(stack);

  test('SQS キューが 2 つ（メイン + DLQ）作成される', () => {
    template.resourceCountIs('AWS::SQS::Queue', 2);
  });

  test('Lambda が VPC 内に配置される', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      VpcConfig: Match.objectLike({
        SubnetIds: Match.anyValue(),
      }),
    });
  });

  test('SNS トピックが作成される', () => {
    template.resourceCountIs('AWS::SNS::Topic', 1);
  });

  test('SSM パラメータ名にプレフィックスが付与される', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/test/express-mode/demo',
    });
  });
});

describe('LightStack: cdk-nag', () => {
  const app = new App();
  const stack = new LightStack(app, 'nag-light', { prefix: 'nag' });
  Aspects.of(stack).add(new AwsSolutionsChecks());

  test('抑制後、cdk-nag のエラーが残らない', () => {
    const errors = Annotations.fromStack(stack).findError(
      '*',
      Match.stringLikeRegexp('AwsSolutions-.*'),
    );
    expect(errors).toHaveLength(0);
  });
});
