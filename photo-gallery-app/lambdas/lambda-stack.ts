import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';

export class LambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: {
    imageBucket: s3.Bucket,
    imageTable: dynamodb.Table
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
    
    // Grant Lambda access to DynamoDB
    props.imageTable.grantWriteData(logImageLambda);
    
    // Add event notification to S3
    props.imageBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(logImageLambda)
    );
  }
}
