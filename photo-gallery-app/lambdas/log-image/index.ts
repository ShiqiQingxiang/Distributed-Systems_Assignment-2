import { S3Event } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);

export const handler = async (event: S3Event): Promise<any> => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  const s3Event = event.Records[0];
  const key = decodeURIComponent(s3Event.s3.object.key.replace(/\+/g, ' '));
  
  // Check file type
  if (!key.endsWith('.jpeg') && !key.endsWith('.png') && !key.endsWith('.jpg')) {
    throw new Error('Invalid file type');
  }
  
  // Record to DynamoDB
  const params = {
    TableName: process.env.TABLE_NAME as string,
    Item: { id: key }
  };
  
  try {
    await dynamodb.send(new PutCommand(params));
    console.log(`Successfully logged image: ${key}`);
    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};