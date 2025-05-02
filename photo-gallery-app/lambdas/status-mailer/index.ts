import { SNSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'eu-west-1' // 确保与您的SES已验证区域相同
});

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
    // 使用环境变量或默认为测试邮箱
    const toEmail = process.env.PHOTOGRAPHER_EMAIL || 'test@example.com';
    // 使用提供的已验证发件人邮箱
    const fromEmail = 'shiqi030213@gmail.com';
    
    console.log(`Preparing to send email to ${toEmail} from ${fromEmail}`);
    
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
      Source: fromEmail
    };
    
    try {
      console.log('Sending email with params:', JSON.stringify(emailParams, null, 2));
      await sesClient.send(new SendEmailCommand(emailParams));
      console.log(`Email sent to ${toEmail} for image: ${message.imageId}`);
    } catch (sesError) {
      console.error('SES Error:', sesError);
      // 记录详细的SES错误但继续执行，不要让邮件发送失败影响整个流程
      // 在实际应用中，您可能希望将这些失败的邮件放入另一个队列重试
    }
    
    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};