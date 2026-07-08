import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { CodePipelineStack } from '../../lib/cicd/codepipeline-stack';

describe('CodePipelineStack', () => {
  describe('Normal mode', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new CodePipelineStack(app, 'TestNormal', {
        env: { account: '123456789012', region: 'ap-northeast-1' },
        prefix: 'test',
        githubOwner: 'testOwner',
        githubRepo: 'testRepo',
        connectionArn:
          'arn:aws:codestar-connections:ap-northeast-1:123456789012:connection/test-id',
        express: false,
        deployPrefix: 'cp-normal',
        branch: 'normal',
      });
      template = Template.fromStack(stack);
    });

    test('CodePipeline が V2 タイプで作成される', () => {
      template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
        PipelineType: 'V2',
      });
    });

    test('Source Action が normal ブランチを監視する', () => {
      template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
        Stages: Match.arrayWith([
          Match.objectLike({
            Name: 'Source',
            Actions: Match.arrayWith([
              Match.objectLike({
                ActionTypeId: Match.objectLike({
                  Category: 'Source',
                  Provider: 'CodeStarSourceConnection',
                }),
                Configuration: Match.objectLike({
                  FullRepositoryId: 'testOwner/testRepo',
                  BranchName: 'normal',
                }),
              }),
            ]),
          }),
        ]),
      });
    });

    test('buildspec に --express が含まれない', () => {
      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Source: Match.objectLike({
          BuildSpec: Match.serializedJson(
            Match.objectLike({
              phases: Match.objectLike({
                build: Match.objectLike({
                  commands: Match.arrayWith([
                    Match.stringLikeRegexp('^(?!.*--express).*npx cdk synth'),
                    Match.stringLikeRegexp('^(?!.*--express).*npx cdk deploy'),
                  ]),
                }),
              }),
            }),
          ),
        }),
      });
    });

    test('buildspec に --app "npx ts-node bin/cicd-app.ts" が含まれる', () => {
      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Source: Match.objectLike({
          BuildSpec: Match.serializedJson(
            Match.objectLike({
              phases: Match.objectLike({
                build: Match.objectLike({
                  commands: Match.arrayWith([
                    Match.stringLikeRegexp(
                      '--app "npx ts-node bin/cicd-app.ts"',
                    ),
                  ]),
                }),
              }),
            }),
          ),
        }),
      });
    });

    test('buildspec に -c prefix=cp-normal が含まれる', () => {
      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Source: Match.objectLike({
          BuildSpec: Match.serializedJson(
            Match.objectLike({
              phases: Match.objectLike({
                build: Match.objectLike({
                  commands: Match.arrayWith([
                    Match.stringLikeRegexp('-c prefix=cp-normal'),
                  ]),
                }),
              }),
            }),
          ),
        }),
      });
    });

    test('パイプラインロールと CodeBuild ロールが分離', () => {
      const pipelineResources = template.findResources(
        'AWS::CodePipeline::Pipeline',
      );
      const codebuildResources = template.findResources(
        'AWS::CodeBuild::Project',
      );

      const pipelineLogicalIds = Object.keys(pipelineResources);
      const codebuildLogicalIds = Object.keys(codebuildResources);

      expect(pipelineLogicalIds).toHaveLength(1);
      expect(codebuildLogicalIds).toHaveLength(1);

      const pipelineRoleRef =
        pipelineResources[pipelineLogicalIds[0]].Properties.RoleArn;
      const codebuildRoleRef =
        codebuildResources[codebuildLogicalIds[0]].Properties.ServiceRole;

      expect(JSON.stringify(pipelineRoleRef)).not.toEqual(
        JSON.stringify(codebuildRoleRef),
      );
    });
  });

  describe('Express mode', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new CodePipelineStack(app, 'TestExpress', {
        env: { account: '123456789012', region: 'ap-northeast-1' },
        prefix: 'test',
        githubOwner: 'testOwner',
        githubRepo: 'testRepo',
        connectionArn:
          'arn:aws:codestar-connections:ap-northeast-1:123456789012:connection/test-id',
        express: true,
        deployPrefix: 'cp-express',
        branch: 'express',
      });
      template = Template.fromStack(stack);
    });

    test('Source Action が express ブランチを監視する', () => {
      template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
        Stages: Match.arrayWith([
          Match.objectLike({
            Name: 'Source',
            Actions: Match.arrayWith([
              Match.objectLike({
                ActionTypeId: Match.objectLike({
                  Category: 'Source',
                  Provider: 'CodeStarSourceConnection',
                }),
                Configuration: Match.objectLike({
                  BranchName: 'express',
                }),
              }),
            ]),
          }),
        ]),
      });
    });

    test('buildspec に --express が含まれる', () => {
      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Source: Match.objectLike({
          BuildSpec: Match.serializedJson(
            Match.objectLike({
              phases: Match.objectLike({
                build: Match.objectLike({
                  commands: Match.arrayWith([
                    Match.stringLikeRegexp('--express'),
                  ]),
                }),
              }),
            }),
          ),
        }),
      });
    });

    test('buildspec に -c prefix=cp-express が含まれる', () => {
      template.hasResourceProperties('AWS::CodeBuild::Project', {
        Source: Match.objectLike({
          BuildSpec: Match.serializedJson(
            Match.objectLike({
              phases: Match.objectLike({
                build: Match.objectLike({
                  commands: Match.arrayWith([
                    Match.stringLikeRegexp('-c prefix=cp-express'),
                  ]),
                }),
              }),
            }),
          ),
        }),
      });
    });
  });
});
