import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { HybridStackProps } from './types';
import { withPrefix } from '../naming';

/**
 * Hybrid（GitHub Actions + CodePipeline V2）パイプラインスタック。
 *
 * GitHub Actions がソースを S3 にアップロードし StartPipelineExecution を呼び出す。
 * CodePipeline V2 が S3 からソースを取得し CodeBuild で cdk deploy を実行する。
 * Pipeline Variables (branch, commitSHA, prefix, express) で動的にモードを切り替える。
 */
export class HybridStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: HybridStackProps) {
    super(scope, id, props);

    const { prefix } = props;

    // ─── Source Bucket ───
    const sourceBucket = new s3.Bucket(this, 'SourceBucket', {
      bucketName: withPrefix(prefix, 'cicd-hybrid-source'),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    // ─── Artifact Bucket（パイプライン内部用） ───
    const artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    // ─── Pipeline Variables ───
    const branchVar = new codepipeline.Variable({
      variableName: 'branch',
      defaultValue: 'main',
      description: 'トリガー元のブランチ名',
    });
    const commitShaVar = new codepipeline.Variable({
      variableName: 'commitSHA',
      defaultValue: 'unknown',
      description: 'トリガー元のコミット SHA',
    });
    const prefixVar = new codepipeline.Variable({
      variableName: 'prefix',
      defaultValue: 'dev',
      description: 'デプロイ対象の CDK context prefix',
    });
    const expressVar = new codepipeline.Variable({
      variableName: 'express',
      defaultValue: 'false',
      description: 'Express モードの有無 (true/false)',
    });

    // ─── Pipeline Execution Role ───
    const pipelineRole = new iam.Role(this, 'PipelineRole', {
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
      description: 'Hybrid pipeline execution role',
    });

    // ─── CodeBuild Role ───
    const codeBuildRole = new iam.Role(this, 'CodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: 'Hybrid pipeline CodeBuild role for CDK deploy',
    });

    // CodeBuild に CDK デプロイ権限を付与（CDK bootstrap ロールを AssumeRole）
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkRoles',
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:aws:iam::${this.account}:role/cdk-*`,
        ],
      }),
    );

    // ─── CodeBuild Project ───
    const buildProject = new codebuild.PipelineProject(this, 'DeployProject', {
      projectName: withPrefix(prefix, 'cicd-hybrid-deploy'),
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': { nodejs: '20' },
            commands: ['npm ci'],
          },
          build: {
            commands: [
              'if [ "$EXPRESS" = "true" ]; then EXPRESS_FLAG="--express"; else EXPRESS_FLAG=""; fi',
              'npx cdk deploy --all --app "npx ts-node bin/cicd-app.ts" -c prefix=$PREFIX --require-approval never $EXPRESS_FLAG',
            ],
          },
        },
      }),
      timeout: cdk.Duration.minutes(30),
    });

    // ─── Source Output ───
    const sourceOutput = new codepipeline.Artifact('SourceOutput');

    // ─── Pipeline ───
    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: withPrefix(prefix, 'cicd-hybrid'),
      pipelineType: codepipeline.PipelineType.V2,
      role: pipelineRole,
      artifactBucket,
      variables: [branchVar, commitShaVar, prefixVar, expressVar],
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.S3SourceAction({
              actionName: 'S3Source',
              bucket: sourceBucket,
              bucketKey: 'source/latest.zip',
              output: sourceOutput,
              trigger: codepipeline_actions.S3Trigger.NONE,
            }),
          ],
        },
        {
          stageName: 'Deploy',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'CDKDeploy',
              project: buildProject,
              input: sourceOutput,
              environmentVariables: {
                BRANCH: {
                  type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                  value: branchVar.reference(),
                },
                COMMIT_SHA: {
                  type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                  value: commitShaVar.reference(),
                },
                PREFIX: {
                  type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                  value: prefixVar.reference(),
                },
                EXPRESS: {
                  type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                  value: expressVar.reference(),
                },
              },
            }),
          ],
        },
      ],
    });

    // Pipeline Role にアーティファクトバケットとソースバケットへのアクセスを付与
    sourceBucket.grantRead(pipelineRole);
    artifactBucket.grantReadWrite(pipelineRole);

    // Pipeline Role に CodeBuild 起動権限を付与
    pipelineRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'StartCodeBuild',
        effect: iam.Effect.ALLOW,
        actions: ['codebuild:BatchGetBuilds', 'codebuild:StartBuild'],
        resources: [buildProject.projectArn],
      }),
    );

    // CodeBuild Role にソースバケットからの読み取り権限を付与
    sourceBucket.grantRead(codeBuildRole);

    // ─── cdk-nag Suppressions ───
    NagSuppressions.addResourceSuppressions(
      pipelineRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Pipeline role needs wildcard for S3 object access within specific buckets',
        },
      ],
      true,
    );

    NagSuppressions.addResourceSuppressions(
      codeBuildRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'CodeBuild role needs wildcard for cdk-* role assumption and CloudWatch Logs',
        },
      ],
      true,
    );

    NagSuppressions.addResourceSuppressions(
      buildProject,
      [
        {
          id: 'AwsSolutions-CB4',
          reason:
            'KMS encryption not required for dev pipeline build project; S3_MANAGED encryption is used for artifacts',
        },
      ],
      true,
    );

    NagSuppressions.addResourceSuppressions(
      pipeline,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Pipeline-generated policies require wildcard for artifact access',
        },
      ],
      true,
    );

    NagSuppressions.addResourceSuppressions(
      artifactBucket,
      [
        {
          id: 'AwsSolutions-S1',
          reason:
            'Access logging not required for dev pipeline artifact bucket',
        },
      ],
      true,
    );

    NagSuppressions.addResourceSuppressions(
      sourceBucket,
      [
        {
          id: 'AwsSolutions-S1',
          reason:
            'Access logging not required for dev pipeline source bucket',
        },
      ],
      true,
    );

    // ─── Outputs ───
    new cdk.CfnOutput(this, 'SourceBucketName', {
      value: sourceBucket.bucketName,
      description: 'Source bucket name for hybrid pipeline',
    });

    new cdk.CfnOutput(this, 'PipelineName', {
      value: pipeline.pipelineName,
      description: 'Hybrid pipeline name',
    });
  }
}
