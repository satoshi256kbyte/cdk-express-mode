import * as cdk from 'aws-cdk-lib';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import { CodePipelineStackProps } from './types';
import { withPrefix } from '../naming';

/**
 * CodePipeline V2 Only パイプラインスタック。
 *
 * CodeStar Connections を使用して GitHub リポジトリをソースとし、
 * CodeBuild で npm ci → cdk synth → cdk deploy を実行する。
 * パイプライン実行ロールと CodeBuild ロールは分離する。
 *
 * 1 インスタンスで 1 パイプラインを作成し、normal / express で 2 回インスタンス化する。
 */
export class CodePipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CodePipelineStackProps) {
    super(scope, id, props);

    const { prefix, githubOwner, githubRepo, connectionArn, express, deployPrefix, branch } = props;

    const mode = express ? 'express' : 'normal';
    const expressFlag = express ? ' --express' : '';
    const synthCmd = `npx cdk synth --app "npx ts-node bin/cicd-app.ts" -c prefix=${deployPrefix}${expressFlag}`;
    const deployCmd = `npx cdk deploy --all --app "npx ts-node bin/cicd-app.ts" -c prefix=${deployPrefix} --require-approval never${expressFlag}`;

    // --- Artifact Bucket ---
    const artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      bucketName: withPrefix(prefix, `cicd-codepipeline-${mode}-artifacts`),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    NagSuppressions.addResourceSuppressions(artifactBucket, [
      {
        id: 'AwsSolutions-S1',
        reason: 'Artifact bucket for dev CI/CD pipeline does not require access logging.',
      },
    ]);

    // --- Pipeline Execution Role ---
    const pipelineRole = new iam.Role(this, 'PipelineRole', {
      roleName: withPrefix(prefix, `cicd-codepipeline-${mode}-role`),
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
    });

    // Pipeline role needs access to artifact bucket
    artifactBucket.grantReadWrite(pipelineRole);

    // Pipeline role needs to use CodeStar Connection
    pipelineRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['codestar-connections:UseConnection'],
        resources: [connectionArn],
      }),
    );

    // Pipeline role needs to start CodeBuild builds
    pipelineRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
        resources: [`arn:aws:codebuild:${this.region}:${this.account}:project/${withPrefix(prefix, `cicd-codepipeline-${mode}-build`)}`],
      }),
    );

    // --- CodeBuild Role ---
    const codeBuildRole = new iam.Role(this, 'CodeBuildRole', {
      roleName: withPrefix(prefix, `cicd-codepipeline-${mode}-build-role`),
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    });

    // CodeBuild role needs access to artifact bucket
    artifactBucket.grantReadWrite(codeBuildRole);

    // CDK deploy permissions: assume CDK bootstrap roles (scoped pattern)
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );

    // CloudFormation permissions for CDK deploy
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplate',
          'cloudformation:CreateChangeSet',
          'cloudformation:DescribeChangeSet',
          'cloudformation:ExecuteChangeSet',
          'cloudformation:DeleteChangeSet',
          'cloudformation:CreateStack',
          'cloudformation:UpdateStack',
          'cloudformation:DeleteStack',
          'cloudformation:GetTemplateSummary',
        ],
        resources: ['*'],
      }),
    );

    // S3 access for CDK asset staging
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:GetBucketLocation'],
        resources: [
          `arn:aws:s3:::cdk-*-assets-${this.account}-${this.region}`,
          `arn:aws:s3:::cdk-*-assets-${this.account}-${this.region}/*`,
        ],
      }),
    );

    // SSM parameter access for CDK context lookups
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/*`],
      }),
    );

    // CloudWatch Logs permissions for CodeBuild
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/${withPrefix(prefix, `cicd-codepipeline-${mode}-build`)}`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/${withPrefix(prefix, `cicd-codepipeline-${mode}-build`)}:*`,
        ],
      }),
    );

    NagSuppressions.addResourceSuppressions(
      codeBuildRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'CloudFormation Resource:* is required for CDK deploy which manages arbitrary stacks. ' +
            'CDK asset bucket uses wildcard for objects within the scoped bucket ARN. ' +
            'Log group ARN uses :* suffix as required by CloudWatch Logs.',
          appliesTo: [
            'Resource::*',
            `Resource::arn:aws:s3:::cdk-*-assets-${this.account}-${this.region}/*`,
            `Resource::arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/${withPrefix(prefix, `cicd-codepipeline-${mode}-build`)}:*`,
          ],
        },
      ],
      true,
    );

    NagSuppressions.addResourceSuppressions(
      pipelineRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Pipeline role needs read/write on all objects in the artifact bucket. ' +
            'The resource is scoped to the specific artifact bucket ARN with /* suffix.',
          appliesTo: [
            `Resource::<ArtifactBucket*.Arn>/*`,
            'Action::s3:Abort*',
            'Action::s3:DeleteObject*',
            'Action::s3:GetBucket*',
            'Action::s3:GetObject*',
            'Action::s3:List*',
          ],
        },
      ],
      true,
    );

    // --- CodeBuild Project ---
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      projectName: withPrefix(prefix, `cicd-codepipeline-${mode}-build`),
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '20',
            },
            commands: ['npm ci'],
          },
          build: {
            commands: [synthCmd, deployCmd],
          },
        },
      }),
      timeout: cdk.Duration.minutes(30),
    });

    // --- Source Output ---
    const sourceOutput = new codepipeline.Artifact('SourceOutput');

    // --- Pipeline ---
    new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: withPrefix(prefix, `cicd-codepipeline-${mode}`),
      pipelineType: codepipeline.PipelineType.V2,
      role: pipelineRole,
      artifactBucket,
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.CodeStarConnectionsSourceAction({
              actionName: 'GitHub_Source',
              connectionArn,
              owner: githubOwner,
              repo: githubRepo,
              branch,
              output: sourceOutput,
              triggerOnPush: true,
            }),
          ],
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'CDK_Deploy',
              project: buildProject,
              input: sourceOutput,
            }),
          ],
        },
      ],
    });

    NagSuppressions.addResourceSuppressions(
      buildProject,
      [
        {
          id: 'AwsSolutions-CB4',
          reason: 'CodeBuild encryption is not required for dev pipeline build project.',
        },
      ],
      true,
    );

    // Suppress the auto-generated policy for the custom resource Lambda
    // that handles auto-delete objects for the artifact bucket
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason:
          'Auto-delete objects custom resource Lambda uses AWS managed policy ' +
          'AWSLambdaBasicExecutionRole. This is CDK-generated and acceptable for dev.',
        appliesTo: [
          'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        ],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Auto-delete objects custom resource requires s3:* on the artifact bucket ' +
          'to clean up objects on stack deletion. This is CDK-generated and acceptable for dev.',
      },
      {
        id: 'AwsSolutions-L1',
        reason:
          'Auto-delete objects custom resource Lambda runtime is managed by CDK ' +
          'and may not always use the latest runtime version.',
      },
    ]);
  }
}
