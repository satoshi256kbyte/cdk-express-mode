#!/usr/bin/env node
// 診断用: 1 サービスだけを含む単独スタックを生成する。
// サービスごとの Express 効果を、他リソースとの並行作成に埋もれさせずに計測するため。
//
//   npx cdk --app "npx ts-node diag/single.ts" deploy <prefix>-<service> \
//     -c service=<composite|sqs|lambda|sns|ssm|alb|ecs|rds> -c prefix=<prefix> [--express]
import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';

// このアカウントは VPC BPA が block-bidirectional のため、IGW 通信が要る VPC には除外が必要。
function addBpaExclusion(scope: Construct, vpc: ec2.Vpc): cdk.CfnResource {
  return new ec2.CfnVPCBlockPublicAccessExclusion(scope, 'Bpa', {
    internetGatewayExclusionMode: 'allow-bidirectional',
    vpcId: vpc.vpcId,
  });
}

// 個々のサービスを与えられた scope / VPC に組み立てる。
// single スタックでも composite スタックでも同じ組み立てを再利用する。
function buildSqs(scope: Construct, suffix = ''): void {
  const dlq = new sqs.Queue(scope, `Dlq${suffix}`, { enforceSSL: true });
  new sqs.Queue(scope, `Main${suffix}`, {
    enforceSSL: true,
    deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
  });
}
function buildSns(scope: Construct): void {
  new sns.Topic(scope, 'Topic');
}
function buildSsm(scope: Construct): void {
  // 物理名は指定しない（CDK がスタック名込みで一意化 → 通常/Express の共存でも衝突しない）。
  new ssm.StringParameter(scope, 'Param', { stringValue: 'express-mode-verification' });
}
function buildLambda(scope: Construct, vpc: ec2.Vpc): void {
  new lambda.Function(scope, 'Fn', {
    runtime: lambda.Runtime.NODEJS_LATEST,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
    vpc,
    timeout: Duration.seconds(30),
  });
}
function buildRds(scope: Construct, vpc: ec2.Vpc): void {
  new rds.DatabaseInstance(scope, 'Db', {
    engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0 }),
    vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
    allocatedStorage: 20,
    multiAz: false,
    deletionProtection: false,
    removalPolicy: RemovalPolicy.DESTROY,
    backupRetention: Duration.days(1),
  });
}
function buildAlb(scope: Construct, vpc: ec2.Vpc): void {
  const alb = new elbv2.ApplicationLoadBalancer(scope, 'Alb', { vpc, internetFacing: true });
  alb.addListener('L', {
    port: 80,
    defaultAction: elbv2.ListenerAction.fixedResponse(200, { messageBody: 'ok' }),
  });
}
function buildEcs(scope: Construct, vpc: ec2.Vpc, dependOn: cdk.CfnResource): void {
  const cluster = new ecs.Cluster(scope, 'Cluster', { vpc });
  const taskDef = new ecs.FargateTaskDefinition(scope, 'Task', { cpu: 256, memoryLimitMiB: 512 });
  taskDef.addContainer('web', {
    image: ecs.ContainerImage.fromRegistry('public.ecr.aws/nginx/nginx:latest'),
    portMappings: [{ containerPort: 80 }],
  });
  const svc = new ecs.FargateService(scope, 'Svc', {
    cluster,
    taskDefinition: taskDef,
    desiredCount: 2,
    assignPublicIp: true,
    vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    circuitBreaker: { rollback: false },
  });
  svc.node.addDependency(dependOn);
}

class SingleServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, service: string, props?: cdk.StackProps) {
    super(scope, id, props);

    if (service === 'composite') {
      // 全サービスを 1 スタックに載せた複合スタック。単独スタックの合計と比較する。
      const vpc = new ec2.Vpc(this, 'Vpc', {
        maxAzs: 2,
        natGateways: 0,
        subnetConfiguration: [
          { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
          { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        ],
      });
      const bpa = addBpaExclusion(this, vpc);
      buildSqs(this);
      buildLambda(this, vpc);
      buildSns(this);
      buildSsm(this);
      buildRds(this, vpc);
      buildAlb(this, vpc);
      buildEcs(this, vpc, bpa);
      // 更新シナリオ用: -c extraSqs=true で SQS + DLQ をもう 1 セット追加する。
      // 既存の composite スタックへの「小さなリソース追加更新」を再現するため。
      if (this.node.tryGetContext('extraSqs')) {
        buildSqs(this, 'Extra');
      }
      return;
    }

    if (service === 'sqs') {
      // VPC 不要。SQS + DLQ のみ。
      buildSqs(this);
      return;
    }

    if (service === 'sns') {
      buildSns(this);
      return;
    }

    if (service === 'ssm') {
      buildSsm(this);
      return;
    }

    if (service === 'lambda') {
      // VPC 内 Lambda（ENI）。egress 不要なので NAT なし・isolated サブネット。
      const vpc = new ec2.Vpc(this, 'Vpc', {
        maxAzs: 2,
        natGateways: 0,
        subnetConfiguration: [
          { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        ],
      });
      new lambda.Function(this, 'Fn', {
        runtime: lambda.Runtime.NODEJS_LATEST,
        handler: 'index.handler',
        code: lambda.Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
        vpc,
        timeout: Duration.seconds(30),
      });
      return;
    }

    if (service === 'rds') {
      // RDS。egress 不要なので NAT なし・isolated サブネット。
      const vpc = new ec2.Vpc(this, 'Vpc', {
        maxAzs: 2,
        natGateways: 0,
        subnetConfiguration: [
          { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        ],
      });
      new rds.DatabaseInstance(this, 'Db', {
        engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0 }),
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
        allocatedStorage: 20,
        multiAz: false,
        deletionProtection: false,
        removalPolicy: RemovalPolicy.DESTROY,
        backupRetention: Duration.days(1),
      });
      return;
    }

    if (service === 'alb') {
      // ALB のみ（ターゲットなし・固定レスポンス）。public サブネット + IGW + BPA 除外。
      const vpc = new ec2.Vpc(this, 'Vpc', {
        maxAzs: 2,
        natGateways: 0,
        subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
      });
      addBpaExclusion(this, vpc);
      const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', { vpc, internetFacing: true });
      alb.addListener('L', {
        port: 80,
        defaultAction: elbv2.ListenerAction.fixedResponse(200, { messageBody: 'ok' }),
      });
      return;
    }

    if (service === 'ecs') {
      // ECS Fargate サービス（ALB なし）。public サブネット + パブリック IP + BPA 除外で egress。
      const vpc = new ec2.Vpc(this, 'Vpc', {
        maxAzs: 2,
        natGateways: 0,
        subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
      });
      const bpa = addBpaExclusion(this, vpc);
      const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
      const taskDef = new ecs.FargateTaskDefinition(this, 'Task', { cpu: 256, memoryLimitMiB: 512 });
      taskDef.addContainer('web', {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/nginx/nginx:latest'),
        portMappings: [{ containerPort: 80 }],
      });
      const svc = new ecs.FargateService(this, 'Svc', {
        cluster,
        taskDefinition: taskDef,
        desiredCount: 2,
        assignPublicIp: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        circuitBreaker: { rollback: false },
      });
      svc.node.addDependency(bpa);
      return;
    }

    throw new Error(`unknown service: ${service}`);
  }
}

const app = new cdk.App();
const service: string | undefined = app.node.tryGetContext('service');
const prefix: string = app.node.tryGetContext('prefix') ?? 'single';
if (!service) {
  throw new Error('context "service" is required (-c service=sqs|lambda|alb|ecs|rds)');
}
new SingleServiceStack(app, `${prefix}-${service}`, service, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
  },
});
