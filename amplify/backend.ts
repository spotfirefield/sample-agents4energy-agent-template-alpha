import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data, llmAgentFunction } from './data/resource';
import { storage } from './storage/resource';
import {
  aws_iam as iam
} from 'aws-cdk-lib'


const backend = defineBackend({
  auth,
  data,
  storage,
  llmAgentFunction
});

backend.stack.tags.setTag('Project', 'workshop-a4e');

backend.addOutput({custom: {rootStackName: backend.stack.stackName}});

//Add permissions to the lambda functions to invoke the model
[
  backend.llmAgentFunction.resources.lambda,
].forEach((resource) => {
  resource.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel*"],
      resources: [
          `arn:aws:bedrock:${backend.stack.region}:${backend.stack.account}:inference-profile/*`,
          `arn:aws:bedrock:us-*::foundation-model/*`,
      ],
  }),
  )
})

backend.llmAgentFunction.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ["s3:*"],
    resources: [
      backend.storage.resources.bucket.bucketArn,
      `${backend.storage.resources.bucket.bucketArn}/*`,
    ],
  })
);

backend.llmAgentFunction.addEnvironment(
  'STORAGE_BUCKET_NAME', 
  backend.storage.resources.bucket.bucketName
);
