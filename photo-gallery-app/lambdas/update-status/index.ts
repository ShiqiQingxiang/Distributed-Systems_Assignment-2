import { SNSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
const snsClient = new SNSClient({});

export const handler = async (event: SNSEvent): Promise<any> => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  const record = event.Records[0].Sns;
  const message = JSON.parse(record.Message);
  
  // 验证状态
  if (!message.update || !['Pass', 'Reject'].includes(message.update.status)) {
    console.error(`Invalid status: ${message.update?.status}`);
    return { statusCode: 400, body: 'Invalid status' };
  }
  
  // 更新DynamoDB
  const params = {
    TableName: process.env.TABLE_NAME as string,
    Key: { id: message.id },
    UpdateExpression: 'set #status = :s, reviewDate = :d, reason = :r',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':s': message.update.status,
      ':d': message.date,
      ':r': message.update.reason
    }
  };
  
  try {
    await dynamodb.send(new UpdateCommand(params));
    console.log(`Successfully updated status for image: ${message.id}`);
    
    // 发送状态更新通知
    const notificationParams = {
      TopicArn: process.env.NOTIFICATION_TOPIC_ARN as string,
      Message: JSON.stringify({
        imageId: message.id,
        status: message.update.status,
        date: message.date
      })
    };
    
    await snsClient.send(new PublishCommand(notificationParams));
    
    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};