import { SQSEvent } from 'aws-lambda';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});

// 辅助函数：尝试从DLQ消息中提取S3信息
function extractS3InfoFromDLQ(record: any): { bucketName: string, key: string } | null {
  try {
    console.log('Processing DLQ record:', JSON.stringify(record, null, 2));
    
    // 尝试解析消息体
    let body: any = {};
    try {
      body = JSON.parse(record.body);
      console.log('Parsed body:', JSON.stringify(body, null, 2));
    } catch (e) {
      console.error('Failed to parse body:', e);
      return null;
    }
    
    // 检查是否有环境变量中的桶名
    const defaultBucketName = process.env.BUCKET_NAME || '';
    console.log(`Default bucket name from env: ${defaultBucketName}`);
    
    // 尝试多种可能的消息格式
    
    // 格式1: 标准的SNS消息格式
    if (body.Message) {
      try {
        const message = JSON.parse(body.Message);
        console.log('Parsed Message:', JSON.stringify(message, null, 2));
        
        if (message.Records && message.Records[0] && message.Records[0].s3) {
          const s3Record = message.Records[0].s3;
          return {
            bucketName: s3Record.bucket.name,
            key: decodeURIComponent(s3Record.object.key.replace(/\+/g, ' '))
          };
        }
      } catch (e) {
        console.error('Failed to parse Message:', e);
      }
    }
    
    // 格式2: 直接的S3事件记录
    if (body.Records && body.Records[0] && body.Records[0].s3) {
      const s3Record = body.Records[0].s3;
      return {
        bucketName: s3Record.bucket.name,
        key: decodeURIComponent(s3Record.object.key.replace(/\+/g, ' '))
      };
    }
    
    // 格式3: Lambda错误消息 - 增强的正则表达式
    if (body.errorMessage) {
      console.log('Found errorMessage:', body.errorMessage);
      
      // 尝试匹配增强的错误消息格式
      const bucketMatch = body.errorMessage.match(/from bucket ([^\s]+)/);
      const keyMatch = body.errorMessage.match(/Invalid file type detected: ([^-]+)/);
      
      if (keyMatch && keyMatch[1]) {
        const key = keyMatch[1].trim();
        const bucketName = bucketMatch && bucketMatch[1] ? bucketMatch[1].trim() : defaultBucketName;
        
        console.log(`Extracted from error message - Key: ${key}, Bucket: ${bucketName}`);
        
        if (bucketName) {
          return { bucketName, key };
        }
      }
      
      // 备用提取方式
      const simpleKeyMatch = body.errorMessage.match(/file[:\s]+([^\s]+)/i);
      if (simpleKeyMatch && simpleKeyMatch[1] && defaultBucketName) {
        const key = simpleKeyMatch[1].trim();
        console.log(`Simple extraction - Key: ${key}, Bucket: ${defaultBucketName}`);
        return { bucketName: defaultBucketName, key };
      }
    }
    
    console.error('Could not extract S3 info from record');
    return null;
  } catch (error) {
    console.error('Error extracting S3 info:', error);
    return null;
  }
}

export const handler = async (event: SQSEvent): Promise<any> => {
  console.log('===== RECEIVED DLQ EVENT =====');
  console.log(JSON.stringify(event, null, 2));
  console.log('============================');
  
  for (const record of event.Records) {
    try {
      // 提取S3信息
      const s3Info = extractS3InfoFromDLQ(record);
      
      if (!s3Info || !s3Info.bucketName || !s3Info.key) {
        console.error('Failed to extract valid S3 info from record');
        continue;
      }
      
      const { bucketName, key } = s3Info;
      console.log(`Processing: Bucket=${bucketName}, Key=${key}`);
      
      // 无论文件类型如何，都删除文件
      // 只要文件信息是从DLQ中提取的，就意味着它是无效的或处理失败的
      console.log(`Deleting file: ${key} from bucket: ${bucketName}`);
      
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: key
        }));
        console.log(`Successfully deleted file: ${key}`);
      } catch (deleteError) {
        console.error(`Error deleting file ${key}:`, deleteError);
      }
    } catch (error) {
      console.error('Error processing record:', error);
    }
  }
  
  return { statusCode: 200, body: 'Success' };
};