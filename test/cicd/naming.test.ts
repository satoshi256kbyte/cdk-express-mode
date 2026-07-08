import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import { CodePipelineStack } from '../../lib/cicd/codepipeline-stack';
import { HybridStack } from '../../lib/cicd/hybrid-stack';
import { withPrefix } from '../../lib/naming';

describe('Naming conventions', () => {
  const prefix = 'dev';

  test('CodePipelineStack (normal) name follows ${prefix}-cicd-codepipeline-normal pattern', () => {
    const app = new cdk.App();
    const stack = new CodePipelineStack(app, withPrefix(prefix, 'cicd-codepipeline-normal'), {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      prefix,
      githubOwner: 'owner',
      githubRepo: 'repo',
      connectionArn: 'arn:aws:codestar-connections:ap-northeast-1:123456789012:connection/test',
      express: false,
      deployPrefix: 'cp-normal',
      branch: 'normal',
    });
    expect(stack.stackName).toBe('dev-cicd-codepipeline-normal');
  });

  test('CodePipelineStack (express) name follows ${prefix}-cicd-codepipeline-express pattern', () => {
    const app = new cdk.App();
    const stack = new CodePipelineStack(app, withPrefix(prefix, 'cicd-codepipeline-express'), {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      prefix,
      githubOwner: 'owner',
      githubRepo: 'repo',
      connectionArn: 'arn:aws:codestar-connections:ap-northeast-1:123456789012:connection/test',
      express: true,
      deployPrefix: 'cp-express',
      branch: 'express',
    });
    expect(stack.stackName).toBe('dev-cicd-codepipeline-express');
  });

  test('HybridStack name follows ${prefix}-cicd-hybrid pattern', () => {
    const app = new cdk.App();
    const stack = new HybridStack(app, withPrefix(prefix, 'cicd-hybrid'), {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      prefix,
      githubOwner: 'owner',
      githubRepo: 'repo',
    });
    expect(stack.stackName).toBe('dev-cicd-hybrid');
  });

  test('withPrefix generates correct patterns', () => {
    expect(withPrefix('prod', 'cicd-codepipeline-normal')).toBe('prod-cicd-codepipeline-normal');
    expect(withPrefix('prod', 'cicd-codepipeline-express')).toBe('prod-cicd-codepipeline-express');
    expect(withPrefix('dev', 'cicd-hybrid')).toBe('dev-cicd-hybrid');
  });
});

describe('CICD stack isolation from App stacks', () => {
  const cicdFiles = [
    path.resolve(__dirname, '../../lib/cicd/codepipeline-stack.ts'),
    path.resolve(__dirname, '../../lib/cicd/hybrid-stack.ts'),
    path.resolve(__dirname, '../../lib/cicd/types.ts'),
    path.resolve(__dirname, '../../bin/cicd.ts'),
    path.resolve(__dirname, '../../bin/cicd-app.ts'),
  ];

  const appModules = ['light-stack', 'heavy-stack'];

  test.each(cicdFiles)('%s does not import App_Stacks modules', (filePath) => {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const module of appModules) {
      expect(content).not.toMatch(new RegExp(`from\\s+['"].*${module}['"]`));
      expect(content).not.toMatch(new RegExp(`require\\s*\\(\\s*['"].*${module}['"]`));
    }
  });
});
