## Distributed Systems - Event-Driven Architecture.

__Name:__ Qingxiang Shiqi

__Demo__**:** https://youtu.be/xHWSG8Nn6ZU

This repository contains the implementation of a skeleton design for an application that manages a photo gallery, illustrated below. The app uses an event-driven architecture and is deployed on the AWS platform using the CDK framework for infrastructure provisioning.

![](C:\Users\shiqiqingxiang\Desktop\Distributed-Systems_Assignment-2\arch.png)

### Code Status.

__Feature:__

+ Photographer:
  + Log new Images - Completed and Tested
  + Metadata updating - Completed and Tested
  + Invalid image removal - Completed and Tested
  + Status Update Mailer - Attempted
+ Moderator
  + Status updating - Completed and Tested

### Notes

This project implements a photo gallery application based on event-driven architecture with the following features:

1. **Merged Architecture Design**: Adopted a CombinedStack pattern instead of separate stacks, resolving circular dependency issues and simplifying resource management.

2. **Image Processing Features**:
   - Support for .jpg, .jpeg, and .png image format validation
   - Recording valid images information in DynamoDB
   - Automatic removal of invalid file types

3. **Event Flow Optimization**:
   - S3 events routed to Lambda through SNS/SQS, enhancing error handling capabilities
   - Implementation of Dead Letter Queue (DLQ) to ensure message processing reliability
   - Accurate message routing through SNS filters and Lambda internal logic

4. **Error Handling Enhancements**:
   - Improved error message parsing in RemoveImageLambda
   - Added multi-level validation and logging for debugging and monitoring

All Lambda functions are equipped with detailed logging, allowing system status monitoring through CloudWatch.