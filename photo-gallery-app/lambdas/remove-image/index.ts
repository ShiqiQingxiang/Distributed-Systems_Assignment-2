import { SQSEvent } from 'aws-lambda';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});

export const handler = async (event: SQSEvent): Promise<any> => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      const originalMessage = JSON.parse(body.Message);
      
      // 获取S3信息
      const bucketName = originalMessage.Records[0].s3.bucket.name;
      const key = decodeURIComponent(originalMessage.Records[0].s3.object.key.replace(/\+/g, ' '));
      
      console.log(`Deleting invalid file: ${key} from bucket: ${bucketName}`);
      
      // 从S3删除文件
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key
      }));
      
      console.log(`Successfully deleted invalid file: ${key}`);
    } catch (error) {
      console.error('Error processing record:', error);
    }
  }
  
  return { statusCode: 200, body: 'Success' };
};