import { SQSEvent } from 'aws-lambda';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});

// Helper function: Try to extract S3 information from DLQ message
function extractS3InfoFromDLQ(record: any): { bucketName: string, key: string } | null {
  try {
    console.log('Processing DLQ record:', JSON.stringify(record, null, 2));
    
    // Try to parse message body
    let body: any = {};
    try {
      body = JSON.parse(record.body);
      console.log('Parsed body:', JSON.stringify(body, null, 2));
    } catch (e) {
      console.error('Failed to parse body:', e);
      return null;
    }
    
    // Check if bucket name exists in environment variables
    const defaultBucketName = process.env.BUCKET_NAME || '';
    console.log(`Default bucket name from env: ${defaultBucketName}`);
    
    // Try multiple possible message formats
    
    // Format 1: Standard SNS message format
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
    
    // Format 2: Direct S3 event record
    if (body.Records && body.Records[0] && body.Records[0].s3) {
      const s3Record = body.Records[0].s3;
      return {
        bucketName: s3Record.bucket.name,
        key: decodeURIComponent(s3Record.object.key.replace(/\+/g, ' '))
      };
    }
    
    // Format 3: Lambda error message - enhanced regex
    if (body.errorMessage) {
      console.log('Found errorMessage:', body.errorMessage);
      
      // Try to match enhanced error message format
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
      
      // Alternative extraction method
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
      // Extract S3 information
      const s3Info = extractS3InfoFromDLQ(record);
      
      if (!s3Info || !s3Info.bucketName || !s3Info.key) {
        console.error('Failed to extract valid S3 info from record');
        continue;
      }
      
      const { bucketName, key } = s3Info;
      console.log(`Processing: Bucket=${bucketName}, Key=${key}`);
      
      // Delete file regardless of file type
      // If file information is extracted from DLQ, it means it's invalid or failed processing
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