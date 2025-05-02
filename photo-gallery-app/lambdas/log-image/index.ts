import { S3Event, SQSEvent, SQSRecord, S3EventRecord } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);

// 处理S3事件的主要函数
async function processS3Event(s3Event: any): Promise<any> {
  const key = decodeURIComponent(s3Event.s3.object.key.replace(/\+/g, ' '));
  const bucket = s3Event.s3.bucket.name;
  
  console.log(`Processing file: ${key} from bucket: ${bucket}`);
  
  // 更明确的文件类型检查
  const lowerKey = key.toLowerCase();
  const isValidImage = lowerKey.endsWith('.jpeg') || 
                       lowerKey.endsWith('.jpg') || 
                       lowerKey.endsWith('.png');
  
  if (!isValidImage) {
    console.error(`INVALID FILE TYPE DETECTED: ${key} IN BUCKET: ${bucket}`);
    // 使用详细错误消息，确保错误被正确捕获
    throw new Error(`Invalid file type detected: ${key} - This file will be removed from bucket ${bucket}`);
  }
  
  // 记录到DynamoDB
  const params = {
    TableName: process.env.TABLE_NAME as string,
    Item: { id: key }
  };
  
  await dynamodb.send(new PutCommand(params));
  console.log(`Successfully logged image: ${key}`);
  return { statusCode: 200, body: 'Success' };
}

// Lambda处理程序 - 支持直接的S3事件和来自SQS的事件
export const handler = async (event: S3Event | SQSEvent): Promise<any> => {
  console.log('===== RECEIVED EVENT =====');
  console.log(JSON.stringify(event, null, 2));
  console.log('============================');
  
  try {
    // 检查是否是SQS事件
    if ('Records' in event && event.Records.length > 0 && 'body' in event.Records[0]) {
      console.log('Processing SQS event');
      
      // 处理每个SQS消息
      for (const record of event.Records as SQSRecord[]) {
        try {
          // 解析SQS消息中的S3事件
          const body = JSON.parse(record.body);
          
          // 如果是来自SNS的消息
          if (body.Message) {
            const message = JSON.parse(body.Message);
            if (message.Records && message.Records[0]) {
              await processS3Event(message.Records[0]);
            }
          } 
          // 直接的S3事件消息
          else if (body.Records && body.Records[0]) {
            await processS3Event(body.Records[0]);
          }
        } catch (sqsError) {
          console.error('Error processing SQS record:', sqsError);
          throw sqsError; // 重新抛出错误，确保消息被发送到DLQ
        }
      }
      
      return { statusCode: 200, body: 'Successfully processed all records' };
    }
    // 直接的S3事件
    else if ('Records' in event && event.Records.length > 0 && 's3' in event.Records[0]) {
      console.log('Processing direct S3 event');
      return await processS3Event(event.Records[0] as S3EventRecord);
    }
    else {
      throw new Error('Unsupported event type');
    }
  } catch (error) {
    console.error('ERROR PROCESSING FILE:', error);
    // 重新抛出错误，确保错误被上层捕获
    throw error;
  }
};