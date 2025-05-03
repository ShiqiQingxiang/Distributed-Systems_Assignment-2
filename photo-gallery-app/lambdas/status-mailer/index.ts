import { SNSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'eu-west-1' // Make sure this matches your SES verified region
});

export const handler = async (event: SNSEvent): Promise<any> => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  const record = event.Records[0].Sns;
  const message = JSON.parse(record.Message);
  
  // Get image information
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
    // Use environment variable or default to test email
    const toEmail = process.env.PHOTOGRAPHER_EMAIL || 'test@example.com';
    // Use the provided verified sender email
    const fromEmail = 'shiqi030213@gmail.com';
    
    console.log(`Preparing to send email to ${toEmail} from ${fromEmail}`);
    
    // Send email
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

    }
    
    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};