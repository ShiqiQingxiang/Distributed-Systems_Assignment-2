import { SNSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
const sesClient = new SESClient({});

export const handler = async (event: SNSEvent): Promise<any> => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  const record = event.Records[0].Sns;
  const message = JSON.parse(record.Message);
  
  // 获取图片信息
  const params = {
    TableName: process.env.TABLE_NAME as string,
    Key: { id: message.imageId }
  };
  
  try {
    const result = await dynamodb.send(new GetCommand(params));
    const item = result.Item;
    
    if (!item) {
      console.error(`Image not found: ${message.imageId}`);
      return { statusCode: 404, body: 'Image not found' };
    }
    
    const photographerName = item.name || 'Photographer';
    // 在实际应用中，邮箱地址应该存储在DynamoDB中
    const toEmail = process.env.PHOTOGRAPHER_EMAIL as string;
    
    // 发送邮件
    const emailParams = {
      Destination: {
        ToAddresses: [toEmail]
      },
      Message: {
        Body: {
          Text: {
            Data: `Dear ${photographerName},\n\nYour image ${message.imageId} has been ${message.status}.\nReview date: ${message.date}\n\nThank you.`
          }
        },
        Subject: {
          Data: `Image Status Update: ${message.status}`
        }
      },
      Source: process.env.FROM_EMAIL as string
    };
    
    await sesClient.send(new SendEmailCommand(emailParams));
    console.log(`Email sent to ${toEmail} for image: ${message.imageId}`);
    
    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};