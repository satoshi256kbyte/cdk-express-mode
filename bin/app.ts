#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { LightStack } from '../lib/light-stack';
import { HeavyStack } from '../lib/heavy-stack';

const app = new cdk.App();

// 通常モード / Express モードのスタックを共存させても衝突しないよう、
// デプロイ時に -c prefix=xxx でプレフィックスを注入する（既定は dev）。
//   通常:    cdk deploy --all -c prefix=normal
//   Express: cdk deploy --all -c prefix=express --express
const prefix: string = app.node.tryGetContext('prefix') ?? 'dev';

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
};

new LightStack(app, `${prefix}-light`, { env, prefix });
new HeavyStack(app, `${prefix}-heavy`, { env, prefix });

// cdk-nag を全スタックに適用し、合成時にベストプラクティス違反を検出する。
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
