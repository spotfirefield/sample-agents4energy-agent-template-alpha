import * as APITypes from "../amplify/functions/graphql/API";
type GeneratedMutation<InputType, OutputType> = string & {
  __generatedMutationInput: InputType;
  __generatedMutationOutput: OutputType;
};
type GeneratedQuery<InputType, OutputType> = string & {
  __generatedQueryInput: InputType;
  __generatedQueryOutput: OutputType;
};


export const createChatMessage = /* GraphQL */ `mutation CreateChatMessage(
  $condition: ModelChatMessageConditionInput
  $input: CreateChatMessageInput!
) {
  createChatMessage(condition: $condition, input: $input) {
    chatSessionId
    content {
      text
    }
    responseComplete
    toolCallId
    toolName
    toolCalls

    role
    id
    createdAt
    updatedAt
    owner
  }
}
` as GeneratedMutation<
  APITypes.CreateChatMessageMutationVariables,
  APITypes.CreateChatMessageMutation
>;


export const publishResponseStreamChunk = /* GraphQL */ `mutation PublishResponseStreamChunk(
  $chunkText: String!
  $chatSessionId: String!
  $index: Int!
) {
  publishResponseStreamChunk(
    chunkText: $chunkText
    chatSessionId: $chatSessionId
    index: $index
  ) {
    __typename
  }
}
` as GeneratedMutation<
  APITypes.PublishResponseStreamChunkMutationVariables,
  APITypes.PublishResponseStreamChunkMutation
>;
