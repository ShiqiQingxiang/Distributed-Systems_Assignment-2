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

    // S3 and DynamoDB resources
    this.imageBucket = new s3.Bucket(this, 'ImageBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.imageTable = new dynamodb.Table(this, 'ImageTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Messaging resources
    this.imageTopic = new sns.Topic(this, 'ImageTopic');
    this.statusTopic = new sns.Topic(this, 'StatusTopic');
    this.dlq = new sqs.Queue(this, 'ImageDLQ');
    this.imageQueue = new sqs.Queue(this, 'ImageQueue', {
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 3
      }
    });

    // Lambda functions
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
        PHOTOGRAPHER_EMAIL: 'shiqi030213@gmail.com',  // Email address to receive notifications
        FROM_EMAIL: 'shiqi030213@gmail.com'          // Verified sender email address
      }
    });

    // Permissions
    this.imageTable.grantWriteData(logImageLambda);
    this.imageTable.grantWriteData(addMetadataLambda);
    this.imageTable.grantWriteData(updateStatusLambda);
    this.imageTable.grantReadData(statusMailerLambda);
    this.imageBucket.grantDelete(removeImageLambda);
    this.statusTopic.grantPublish(updateStatusLambda);

    // SES permissions
    const sesPolicy = new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    });
    statusMailerLambda.addToRolePolicy(sesPolicy);

    // 1. Create a file validation queue and topic
    const validationQueue = new sqs.Queue(this, 'ValidationQueue', {
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 3
      }
    });

    // 2. Create file validation Lambda function
    const fileValidationLambda = new lambda.Function(this, 'FileValidationLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambdas/log-image'), // Reuse the same code
      environment: {
        TABLE_NAME: this.imageTable.tableName
      }
    });

    // 3. Connect validation queue to Lambda
    fileValidationLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(validationQueue)
    );

    this.imageTable.grantWriteData(fileValidationLambda);

    // 4. Create SNS topic specifically for S3 events
    const s3EventTopic = new sns.Topic(this, 'S3EventTopic');
    
    // 5. Connect S3 events to SNS topic, not directly to Lambda
    this.imageBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(s3EventTopic)
    );
    
    // 6. Connect from SNS topic to validation queue
    s3EventTopic.addSubscription(
      new snsSubs.SqsSubscription(validationQueue)
    );

    // 7. Metadata updates filtered through SNS
    this.imageTopic.addSubscription(
      new snsSubs.LambdaSubscription(addMetadataLambda, {
        filterPolicy: {
          metadata_type: sns.SubscriptionFilter.stringFilter({
            allowlist: ['Caption', 'Date', 'name']
          })
        }
      })
    );

    // 8. Status updates filtered through SNS - completely remove filter, rely on Lambda function judgment
    this.imageTopic.addSubscription(
      new snsSubs.LambdaSubscription(updateStatusLambda)
    );

    // 9. Remove Image Lambda gets messages from DLQ
    removeImageLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(this.dlq)
    );

    // 10. Status Mailer gets messages from status topic
    this.statusTopic.addSubscription(
      new snsSubs.LambdaSubscription(statusMailerLambda)
    );
  }
} 