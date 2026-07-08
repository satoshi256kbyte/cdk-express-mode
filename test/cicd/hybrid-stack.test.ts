import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { HybridStack } from '../../lib/cicd/hybrid-stack';

describe('HybridStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new HybridStack(app, 'TestStack', {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      prefix: 'test',
      githubOwner: 'testOwner',
      githubRepo: 'testRepo',
    });
    template = Template.fromStack(stack);
  });

  test('Source Bucket が作成される', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'test-cicd-hybrid-source',
    });
  });

  test('CodePipeline が V2 タイプで作成される', () => {
    template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
      PipelineType: 'V2',
    });
  });

  test('S3 Source Action の polling が無効', () => {
    template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
      Stages: Match.arrayWith([
        Match.objectLike({
          Name: 'Source',
          Actions: Match.arrayWith([
            Match.objectLike({
              ActionTypeId: Match.objectLike({
                Category: 'Source',
                Provider: 'S3',
              }),
              Configuration: Match.objectLike({
                PollForSourceChanges: false,
              }),
            }),
          ]),
        }),
      ]),
    });
  });

  test('Pipeline Variables に branch, commitSHA, prefix, express が定義されている', () => {
    template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
      Variables: Match.arrayWith([
        Match.objectLike({ Name: 'branch' }),
        Match.objectLike({ Name: 'commitSHA' }),
        Match.objectLike({ Name: 'prefix' }),
        Match.objectLike({ Name: 'express' }),
      ]),
    });
  });

  test('buildspec に条件付き --express ロジックが含まれる', () => {
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Source: Match.objectLike({
        BuildSpec: Match.serializedJson(
          Match.objectLike({
            phases: Match.objectLike({
              build: Match.objectLike({
                commands: Match.arrayWith([
                  Match.stringLikeRegexp('if.*EXPRESS.*true.*--express'),
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
                  Match.stringLikeRegexp('--app.*npx ts-node bin/cicd-app\\.ts'),
                ]),
              }),
            }),
          }),
        ),
      }),
    });
  });
});
