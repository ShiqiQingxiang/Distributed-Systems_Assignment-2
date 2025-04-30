import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export class MessagingStack extends cdk.Stack {
  public readonly imageTopic: sns.Topic;
  public readonly imageQueue: sqs.Queue;
  public readonly dlq: sqs.Queue;
  public readonly statusTopic: sns.Topic;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 创建SNS主题
    this.imageTopic = new sns.Topic(this, 'ImageTopic');
    
    // 创建状态更新通知主题
    this.statusTopic = new sns.Topic(this, 'StatusTopic');

    // 创建死信队列
    this.dlq = new sqs.Queue(this, 'ImageDLQ');

    // 创建主队列
    this.imageQueue = new sqs.Queue(this, 'ImageQueue', {
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 3
      }
    });
  }
}