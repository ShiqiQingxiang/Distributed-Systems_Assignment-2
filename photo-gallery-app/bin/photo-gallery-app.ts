#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CombinedStack } from '../lib/combined-stack';

const app = new cdk.App();
new CombinedStack(app, 'PhotoGalleryStack');