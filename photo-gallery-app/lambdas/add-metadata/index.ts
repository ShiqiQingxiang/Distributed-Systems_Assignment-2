import { SNSEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);

export const handler = async (event: SNSEvent): Promise<any> => {

  console.log('===== FULL EVENT =====');
  console.log(JSON.stringify(event, null, 2));
  console.log('=====================');
  
  const record = event.Records[0].Sns;
  const message = JSON.parse(record.Message);
  
  // 添加消息内容日志
  console.log('===== MESSAGE CONTENT =====');
  console.log(JSON.stringify(message, null, 2));
  console.log('==========================');
  
  const messageAttributes = record.MessageAttributes || {};
  
  // 添加属性日志
  console.log('===== MESSAGE ATTRIBUTES =====');
  console.log(JSON.stringify(messageAttributes, null, 2));
  console.log('=============================');
  
  // 获取元数据类型
  const metadataType = messageAttributes.metadata_type?.Value;
  console.log(`Metadata type: "${metadataType}"`);
  
  if (!metadataType || !['Caption', 'Date', 'name'].includes(metadataType)) {
    console.error(`Invalid or missing metadata type: ${metadataType}`);
    return { statusCode: 400, body: 'Invalid metadata type' };
  }
  
  // 更新DynamoDB - 使用ExpressionAttributeNames避免保留关键字冲突
  const params = {
    TableName: process.env.TABLE_NAME as string,
    Key: { id: message.id },
    UpdateExpression: 'set #attrName = :value',
    ExpressionAttributeNames: {
      '#attrName': metadataType
    },
    ExpressionAttributeValues: { 
      ':value': message.value 
    }
  };
  
  // 添加参数日志
  console.log('===== DB UPDATE PARAMS =====');
  console.log(JSON.stringify(params, null, 2));
  console.log('===========================');
  
  try {
    const result = await dynamodb.send(new UpdateCommand(params));
    console.log(`Successfully updated ${metadataType} for image: ${message.id}`);
    console.log('Update result:', JSON.stringify(result, null, 2));
    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};
