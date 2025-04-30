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
    
    // Configure S3 to publish events to SNS
    props.imageBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(props.imageTopic)
    );
    
    // Configure SNS to filter messages to SQS
    props.imageTopic.addSubscription(new snsSubs.SqsSubscription(props.imageQueue, {
      filterPolicy: {
        eventName: sns.SubscriptionFilter.stringFilter({
          allowlist: ['ObjectCreated:*']
        })
      }
    }));
    
    // Configure Log Image Lambda to process messages from SQS
    logImageLambda.addEventSource(new lambdaEventSources.SqsEventSource(props.imageQueue));
    
    // Configure Add Metadata Lambda to receive relevant SNS messages
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
  }
}
