import { SNSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);

export const handler = async (event: SNSEvent): Promise<any> => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  const record = event.Records[0].Sns;
  const message = JSON.parse(record.Message);
  const messageAttributes = record.MessageAttributes || {};
  
  // 获取元数据类型
  const metadataType = messageAttributes.metadata_type?.Value;
  if (!metadataType || !['Caption', 'Date', 'name'].includes(metadataType)) {
    console.error(`Invalid or missing metadata type: ${metadataType}`);
    return { statusCode: 400, body: 'Invalid metadata type' };
  }
  
  // 更新DynamoDB
  const params = {
    TableName: process.env.TABLE_NAME as string,
    Key: { id: message.id },
    UpdateExpression: `set ${metadataType.toLowerCase()} = :value`,
    ExpressionAttributeValues: { ':value': message.value }
  };
  
  try {
    await dynamodb.send(new UpdateCommand(params));
    console.log(`Successfully updated ${metadataType} for image: ${message.id}`);
    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};
