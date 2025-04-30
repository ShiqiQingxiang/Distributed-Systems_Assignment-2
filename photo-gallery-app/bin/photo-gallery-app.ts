#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';
import { MessagingStack } from '../lib/messaging-stack';
import { LambdaStack } from '../lambdas/lambda-stack';

const app = new cdk.App();
const storageStack = new StorageStack(app, 'PhotoGalleryStorageStack');
const messagingStack = new MessagingStack(app, 'PhotoGalleryMessagingStack');

// 将Lambda堆栈移到这里，并传递存储和消息资源
new LambdaStack(app, 'PhotoGalleryLambdaStack', {
  imageBucket: storageStack.imageBucket,
  imageTable: storageStack.imageTable,
  imageTopic: messagingStack.imageTopic,
  imageQueue: messagingStack.imageQueue,
  dlq: messagingStack.dlq,
  statusTopic: messagingStack.statusTopic
});