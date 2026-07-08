#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { withPrefix } from '../lib/naming';
import { CodePipelineStack } from '../lib/cicd/codepipeline-stack';
import { HybridStack } from '../lib/cicd/hybrid-stack';

const app = new cdk.App();

const prefix: string = app.node.tryGetContext('prefix') ?? 'dev';
const githubOwner: string = app.node.tryGetContext('githubOwner');
const githubRepo: string = app.node.tryGetContext('githubRepo');
const normalBranch: string = app.node.tryGetContext('normalBranch') ?? 'normal';
const expressBranch: string = app.node.tryGetContext('expressBranch') ?? 'express';
const connectionArn: string = app.node.tryGetContext('connectionArn') ?? '';

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
};

// CodePipeline V2 Only — Normal mode
new CodePipelineStack(app, withPrefix(prefix, 'cicd-codepipeline-normal'), {
  env,
  prefix,
  githubOwner,
  githubRepo,
  connectionArn,
  express: false,
  deployPrefix: 'cp-normal',
  branch: normalBranch,
});

// CodePipeline V2 Only — Express mode
new CodePipelineStack(app, withPrefix(prefix, 'cicd-codepipeline-express'), {
  env,
  prefix,
  githubOwner,
  githubRepo,
  connectionArn,
  express: true,
  deployPrefix: 'cp-express',
  branch: expressBranch,
});

// Hybrid（GitHub Actions + CodePipeline V2）— 1 pipeline with variable-based dispatch
new HybridStack(app, withPrefix(prefix, 'cicd-hybrid'), {
  env,
  prefix,
  githubOwner,
  githubRepo,
});

// cdk-nag を全スタックに適用し、合成時にベストプラクティス違反を検出する。
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
