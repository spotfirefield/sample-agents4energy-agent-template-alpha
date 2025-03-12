import { type ClientSchema, a, defineData, defineFunction } from '@aws-amplify/backend';
// import { GardenUnits } from '../functions/graphql/API';
// import { createZodSchema } from './amplifyToZod'

// export const generateGardenPlanStepsFunction = defineFunction({
//   name: 'generateGardenPlanSteps',
//   entry: '../functions/generateGardenPlanStepsHandler.ts',
//   timeoutSeconds: 900,
//   environment: {
//     MODEL_ID: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
//     // MODEL_ID: 'us.anthropic.claude-3-sonnet-20240229-v1:0',
//     // MODEL_ID: 'us.amazon.nova-pro-v1:0'
//   }
// });

export const llmAgentFunction = defineFunction({
  name: 'llmAgent',
  entry: '../functions/llmAgent/handler.ts',
  timeoutSeconds: 900,
  environment: {
    // MODEL_ID: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
    MODEL_ID: 'us.anthropic.claude-3-5-haiku-20241022-v1:0'
    // MODEL_ID: 'us.anthropic.claude-3-sonnet-20240229-v1:0',
    // MODEL_ID: 'us.amazon.nova-pro-v1:0'
  }
});

export const schema = a.schema({
  ChatSession: a.model({
    name: a.string(),
    messages: a.hasMany("ChatMessage", "chatSessionId"),
  })
    .authorization((allow) => [allow.owner(), allow.authenticated()]),

  ChatMessage: a
    .model({
      chatSessionId: a.id(),
      chatSession: a.belongsTo("ChatSession", 'chatSessionId'),

      //Chat message fields
      content: a.customType({
        text: a.string(),
        // proposedSteps: a.ref('Step').array(),
        // proposedGardenUpdate: a.ref('Garden'),
      }),
      role: a.enum(["human", "ai", "tool"]),
      responseComplete: a.boolean(),

      //auto-generated fields
      owner: a.string(),
      createdAt: a.datetime(),

      //langchain fields
      toolCallId: a.string(),
      toolName: a.string(),
      toolCalls: a.string(),

      //context fields
      contextStepId: a.string(),
    })
    .secondaryIndexes((index) => [
      index("chatSessionId").sortKeys(["createdAt"])
    ])
    .authorization((allow) => [allow.owner(), allow.authenticated()]),

  //These assets enable token level streaming from the model
  ResponseStreamChunk: a.customType({
    chunkText: a.string().required(),
    index: a.integer().required(),
    chatSessionId: a.string().required()
  }),

  DummyModelToAddIamDirective: a.model({//This is required to add the IAM directive to the ResponseStreamChunk type
    responseStreamChunk: a.ref('ResponseStreamChunk')
  })
    .authorization((allow) => [allow.owner()]),

  publishResponseStreamChunk: a.mutation()
    .arguments({
      chunkText: a.string().required(),
      index: a.integer().required(),
      chatSessionId: a.string().required(),
    })
    .returns(a.ref('ResponseStreamChunk'))
    // .returns(a.string())
    .handler(a.handler.custom({ entry: './publishMessageStreamChunk.js' }))
    .authorization(allow => [allow.authenticated()]),

  recieveResponseStreamChunk: a
    .subscription()
    .for(a.ref('publishResponseStreamChunk'))
    .arguments({ chatSessionId: a.string().required() })
    .handler(a.handler.custom({ entry: './receiveMessageStreamChunk.js' }))
    .authorization(allow => [allow.authenticated()]),

  invokeAgent: a.query()
    .arguments({ chatSessionId: a.id().required(), userInput: a.string().required() })
    // .returns(a.ref('Garden'))
    .handler(a.handler.function(llmAgentFunction).async())
    .authorization((allow) => [allow.authenticated()]),
  


})
  .authorization((allow) => [
    // allow.resource(generateGardenPlanStepsFunction),
    allow.resource(llmAgentFunction)
  ]);

export type Schema = ClientSchema<typeof schema>;

// const zodSchema = createZodSchema(schema.data.types.Garden.identifier)

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
