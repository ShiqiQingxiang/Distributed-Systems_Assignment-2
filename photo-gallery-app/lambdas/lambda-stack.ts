import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as snsSubs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export class LambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: {
    imageBucket: s3.Bucket,
    imageTable: dynamodb.Table,
    imageTopic: sns.Topic,
    imageQueue: sqs.Queue,
    dlq: sqs.Queue,
    statusTopic: sns.Topic
  } & cdk.StackProps) {
    super(scope, id, props);

    // Log Image Lambda
    const logImageLambda = new lambda.Function(this, 'LogImageLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/log-image'),
      environment: {
        TABLE_NAME: props.imageTable.tableName
      }
    });
    
    // Add Metadata Lambda
    const addMetadataLambda = new lambda.Function(this, 'AddMetadataLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/add-metadata'),
      environment: {
        TABLE_NAME: props.imageTable.tableName
      }
    });
    
    // Grant Lambda access to DynamoDB
    props.imageTable.grantWriteData(logImageLambda);
    props.imageTable.grantWriteData(addMetadataLambda);
    
    // 为了处理无效文件，我们添加一个SNS-SQS-DLQ链
    // 用于元数据和状态更新消息
    const fileValidationQueue = new sqs.Queue(this, 'FileValidationQueue', {
      deadLetterQueue: {
        queue: props.dlq,
        maxReceiveCount: 3
      }
    });

    // 配置另一个Lambda函数以专门处理文件验证
    const fileValidationLambda = new lambda.Function(this, 'FileValidationLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/log-image'), // 重用相同的代码
      environment: {
        TABLE_NAME: props.imageTable.tableName
      }
    });

    props.imageTable.grantWriteData(fileValidationLambda);

    // 添加SQS触发器
    fileValidationLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(fileValidationQueue)
    );

    // 创建从S3到SNS的事件通知，用于更灵活的事件处理
    const notificationTopic = new sns.Topic(this, 'S3NotificationTopic');
    props.imageBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(notificationTopic)
    );

    // 将SNS消息路由到SQS以便文件验证
    notificationTopic.addSubscription(
      new snsSubs.SqsSubscription(fileValidationQueue)
    );

    // 配置SNS订阅用于元数据更新
    props.imageTopic.addSubscription(new snsSubs.LambdaSubscription(addMetadataLambda, {
      filterPolicy: {
        metadata_type: sns.SubscriptionFilter.stringFilter({
          allowlist: ['Caption', 'Date', 'name']
        })
      }
    }));

    // Remove Image Lambda
    const removeImageLambda = new lambda.Function(this, 'RemoveImageLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/remove-image')
    });

    // Grant Lambda access to S3
    props.imageBucket.grantDelete(removeImageLambda);

    // Configure RemoveImage Lambda to process messages from DLQ
    removeImageLambda.addEventSource(new lambdaEventSources.SqsEventSource(props.dlq));

    // Update Status Lambda
    const updateStatusLambda = new lambda.Function(this, 'UpdateStatusLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/update-status'),
      environment: {
        TABLE_NAME: props.imageTable.tableName,
        NOTIFICATION_TOPIC_ARN: props.statusTopic.topicArn
      }
    });

    // Grant Lambda access to DynamoDB and SNS
    props.imageTable.grantWriteData(updateStatusLambda);
    props.statusTopic.grantPublish(updateStatusLambda);

    // Configure SNS subscription with filter
    props.imageTopic.addSubscription(new snsSubs.LambdaSubscription(updateStatusLambda, {
      filterPolicy: {
        messageType: sns.SubscriptionFilter.stringFilter({
          allowlist: ['StatusUpdate']
        })
      }
    }));

    // Status Update Mailer Lambda
    const statusMailerLambda = new lambda.Function(this, 'StatusMailerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/status-mailer'),
      environment: {
        TABLE_NAME: props.imageTable.tableName,
        PHOTOGRAPHER_EMAIL: 'test@example.com',  // 测试用
        FROM_EMAIL: 'no-reply@example.com'       // 测试用
      }
    });

    // Grant Lambda access to DynamoDB
    props.imageTable.grantReadData(statusMailerLambda);

    // Create SES send email permission
    const sesPolicy = new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'], // 实际应用中应限制资源范围
    });
    statusMailerLambda.addToRolePolicy(sesPolicy);

    // Add SNS subscription for status updates
    props.statusTopic.addSubscription(
      new snsSubs.LambdaSubscription(statusMailerLambda)
    );
  }
}
