import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { Annotations, Match } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { CodePipelineStack } from '../../lib/cicd/codepipeline-stack';
import { HybridStack } from '../../lib/cicd/hybrid-stack';

describe('cdk-nag AwsSolutions compliance', () => {
  test('CodePipelineStack (normal) has no unsuppressed cdk-nag errors', () => {
    const app = new cdk.App();
    const stack = new CodePipelineStack(app, 'NagNormal', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      prefix: 'test',
      githubOwner: 'testOwner',
      githubRepo: 'testRepo',
      connectionArn: 'arn:aws:codestar-connections:ap-northeast-1:123456789012:connection/test-id',
      express: false,
      deployPrefix: 'cp-normal',
      branch: 'normal',
    });
    Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
    const errors = Annotations.fromStack(stack).findError('*', Match.stringLikeRegexp('AwsSolutions-.*'));
    expect(errors).toHaveLength(0);
  });

  test('CodePipelineStack (express) has no unsuppressed cdk-nag errors', () => {
    const app = new cdk.App();
    const stack = new CodePipelineStack(app, 'NagExpress', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      prefix: 'test',
      githubOwner: 'testOwner',
      githubRepo: 'testRepo',
      connectionArn: 'arn:aws:codestar-connections:ap-northeast-1:123456789012:connection/test-id',
      express: true,
      deployPrefix: 'cp-express',
      branch: 'express',
    });
    Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
    const errors = Annotations.fromStack(stack).findError('*', Match.stringLikeRegexp('AwsSolutions-.*'));
    expect(errors).toHaveLength(0);
  });

  test('HybridStack has no unsuppressed cdk-nag errors', () => {
    const app = new cdk.App();
    const stack = new HybridStack(app, 'NagHybrid', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      prefix: 'test',
      githubOwner: 'testOwner',
      githubRepo: 'testRepo',
    });
    Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
    const errors = Annotations.fromStack(stack).findError('*', Match.stringLikeRegexp('AwsSolutions-.*'));
    expect(errors).toHaveLength(0);
  });

  test('CodePipelineStack (normal) has no unsuppressed cdk-nag warnings', () => {
    const app = new cdk.App();
    const stack = new CodePipelineStack(app, 'NagWarnNormal', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      prefix: 'test',
      githubOwner: 'testOwner',
      githubRepo: 'testRepo',
      connectionArn: 'arn:aws:codestar-connections:ap-northeast-1:123456789012:connection/test-id',
      express: false,
      deployPrefix: 'cp-normal',
      branch: 'normal',
    });
    Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
    const warnings = Annotations.fromStack(stack).findWarning('*', Match.stringLikeRegexp('AwsSolutions-.*'));
    expect(warnings).toHaveLength(0);
  });

  test('HybridStack has no unsuppressed cdk-nag warnings', () => {
    const app = new cdk.App();
    const stack = new HybridStack(app, 'NagWarnHybrid', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      prefix: 'test',
      githubOwner: 'testOwner',
      githubRepo: 'testRepo',
    });
    Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
    const warnings = Annotations.fromStack(stack).findWarning('*', Match.stringLikeRegexp('AwsSolutions-.*'));
    expect(warnings).toHaveLength(0);
  });
});
