import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as snsSubs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';

export class CombinedStack extends cdk.Stack {
  public readonly imageBucket: s3.Bucket;
  public readonly imageTable: dynamodb.Table;
  public readonly imageTopic: sns.Topic;
  public readonly imageQueue: sqs.Queue;
  public readonly dlq: sqs.Queue;
  public readonly statusTopic: sns.Topic;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3和DynamoDB资源
    this.imageBucket = new s3.Bucket(this, 'ImageBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.imageTable = new dynamodb.Table(this, 'ImageTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 消息资源
    this.imageTopic = new sns.Topic(this, 'ImageTopic');
    this.statusTopic = new sns.Topic(this, 'StatusTopic');
    this.dlq = new sqs.Queue(this, 'ImageDLQ');
    this.imageQueue = new sqs.Queue(this, 'ImageQueue', {
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 3
      }
    });

    // Lambda函数
    // 1. Log Image Lambda
    const logImageLambda = new lambda.Function(this, 'LogImageLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/log-image'),
      environment: {
        TABLE_NAME: this.imageTable.tableName
      }
    });
    
    // 2. Add Metadata Lambda
    const addMetadataLambda = new lambda.Function(this, 'AddMetadataLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/add-metadata'),
      environment: {
        TABLE_NAME: this.imageTable.tableName
      }
    });
    
    // 3. Remove Image Lambda
    const removeImageLambda = new lambda.Function(this, 'RemoveImageLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/remove-image'),
      environment: {
        BUCKET_NAME: this.imageBucket.bucketName
      }
    });

    // 4. Update Status Lambda
    const updateStatusLambda = new lambda.Function(this, 'UpdateStatusLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/update-status'),
      environment: {
        TABLE_NAME: this.imageTable.tableName,
        NOTIFICATION_TOPIC_ARN: this.statusTopic.topicArn
      }
    });

    // 5. Status Update Mailer Lambda
    const statusMailerLambda = new lambda.Function(this, 'StatusMailerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/status-mailer'),
      environment: {
        TABLE_NAME: this.imageTable.tableName,
        PHOTOGRAPHER_EMAIL: 'shiqi030213@gmail.com',  // 设置为接收邮件的地址
        FROM_EMAIL: 'shiqi030213@gmail.com'          // 已验证的发件人地址
      }
    });

    // 授权
    this.imageTable.grantWriteData(logImageLambda);
    this.imageTable.grantWriteData(addMetadataLambda);
    this.imageTable.grantWriteData(updateStatusLambda);
    this.imageTable.grantReadData(statusMailerLambda);
    this.imageBucket.grantDelete(removeImageLambda);
    this.statusTopic.grantPublish(updateStatusLambda);

    // SES权限
    const sesPolicy = new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    });
    statusMailerLambda.addToRolePolicy(sesPolicy);

    // 完全替换文件验证和S3事件部分
    // 1. 创建一个文件验证队列和主题
    const validationQueue = new sqs.Queue(this, 'ValidationQueue', {
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 3
      }
    });

    // 2. 创建文件验证Lambda函数
    const fileValidationLambda = new lambda.Function(this, 'FileValidationLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/log-image'), // 重用相同的代码
      environment: {
        TABLE_NAME: this.imageTable.tableName
      }
    });

    // 3. 连接验证队列到Lambda
    fileValidationLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(validationQueue)
    );

    this.imageTable.grantWriteData(fileValidationLambda);

    // 4. 创建专门处理S3事件的SNS主题
    const s3EventTopic = new sns.Topic(this, 'S3EventTopic');
    
    // 5. 将S3事件连接到SNS主题，而不是直接到Lambda
    this.imageBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(s3EventTopic)
    );
    
    // 6. 从SNS主题连接到验证队列
    s3EventTopic.addSubscription(
      new snsSubs.SqsSubscription(validationQueue)
    );

    // 7. 元数据更新通过SNS进行过滤
    this.imageTopic.addSubscription(
      new snsSubs.LambdaSubscription(addMetadataLambda, {
        filterPolicy: {
          metadata_type: sns.SubscriptionFilter.stringFilter({
            allowlist: ['Caption', 'Date', 'name']
          })
        }
      })
    );

    // 8. 状态更新通过SNS进行过滤 - 完全移除过滤器，依靠Lambda函数判断
    this.imageTopic.addSubscription(
      new snsSubs.LambdaSubscription(updateStatusLambda)
    );

    // 9. Remove Image Lambda从DLQ获取消息
    removeImageLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(this.dlq)
    );

    // 10. Status Mailer从状态主题获取消息
    this.statusTopic.addSubscription(
      new snsSubs.LambdaSubscription(statusMailerLambda)
    );
  }
} 