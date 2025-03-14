/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "./API";
type GeneratedSubscription<InputType, OutputType> = string & {
  __generatedSubscriptionInput: InputType;
  __generatedSubscriptionOutput: OutputType;
};

export const onCreateChatMessage = /* GraphQL */ `subscription OnCreateChatMessage(
  $filter: ModelSubscriptionChatMessageFilterInput
  $owner: String
) {
  onCreateChatMessage(filter: $filter, owner: $owner) {
    chatSession {
      createdAt
      id
      name
      owner
      updatedAt
      __typename
    }
    chatSessionId
    content {
      text
      __typename
    }
    createdAt
    id
    owner
    responseComplete
    role
    toolCallId
    toolCalls
    toolName
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnCreateChatMessageSubscriptionVariables,
  APITypes.OnCreateChatMessageSubscription
>;
export const onCreateChatSession = /* GraphQL */ `subscription OnCreateChatSession(
  $filter: ModelSubscriptionChatSessionFilterInput
  $owner: String
) {
  onCreateChatSession(filter: $filter, owner: $owner) {
    createdAt
    id
    messages {
      nextToken
      __typename
    }
    name
    owner
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnCreateChatSessionSubscriptionVariables,
  APITypes.OnCreateChatSessionSubscription
>;
export const onCreateDummyModelToAddIamDirective = /* GraphQL */ `subscription OnCreateDummyModelToAddIamDirective(
  $filter: ModelSubscriptionDummyModelToAddIamDirectiveFilterInput
  $owner: String
) {
  onCreateDummyModelToAddIamDirective(filter: $filter, owner: $owner) {
    createdAt
    id
    owner
    responseStreamChunk {
      chatSessionId
      chunkText
      index
      __typename
    }
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnCreateDummyModelToAddIamDirectiveSubscriptionVariables,
  APITypes.OnCreateDummyModelToAddIamDirectiveSubscription
>;
export const onDeleteChatMessage = /* GraphQL */ `subscription OnDeleteChatMessage(
  $filter: ModelSubscriptionChatMessageFilterInput
  $owner: String
) {
  onDeleteChatMessage(filter: $filter, owner: $owner) {
    chatSession {
      createdAt
      id
      name
      owner
      updatedAt
      __typename
    }
    chatSessionId
    content {
      text
      __typename
    }
    createdAt
    id
    owner
    responseComplete
    role
    toolCallId
    toolCalls
    toolName
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnDeleteChatMessageSubscriptionVariables,
  APITypes.OnDeleteChatMessageSubscription
>;
export const onDeleteChatSession = /* GraphQL */ `subscription OnDeleteChatSession(
  $filter: ModelSubscriptionChatSessionFilterInput
  $owner: String
) {
  onDeleteChatSession(filter: $filter, owner: $owner) {
    createdAt
    id
    messages {
      nextToken
      __typename
    }
    name
    owner
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnDeleteChatSessionSubscriptionVariables,
  APITypes.OnDeleteChatSessionSubscription
>;
export const onDeleteDummyModelToAddIamDirective = /* GraphQL */ `subscription OnDeleteDummyModelToAddIamDirective(
  $filter: ModelSubscriptionDummyModelToAddIamDirectiveFilterInput
  $owner: String
) {
  onDeleteDummyModelToAddIamDirective(filter: $filter, owner: $owner) {
    createdAt
    id
    owner
    responseStreamChunk {
      chatSessionId
      chunkText
      index
      __typename
    }
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnDeleteDummyModelToAddIamDirectiveSubscriptionVariables,
  APITypes.OnDeleteDummyModelToAddIamDirectiveSubscription
>;
export const onUpdateChatMessage = /* GraphQL */ `subscription OnUpdateChatMessage(
  $filter: ModelSubscriptionChatMessageFilterInput
  $owner: String
) {
  onUpdateChatMessage(filter: $filter, owner: $owner) {
    chatSession {
      createdAt
      id
      name
      owner
      updatedAt
      __typename
    }
    chatSessionId
    content {
      text
      __typename
    }
    createdAt
    id
    owner
    responseComplete
    role
    toolCallId
    toolCalls
    toolName
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnUpdateChatMessageSubscriptionVariables,
  APITypes.OnUpdateChatMessageSubscription
>;
export const onUpdateChatSession = /* GraphQL */ `subscription OnUpdateChatSession(
  $filter: ModelSubscriptionChatSessionFilterInput
  $owner: String
) {
  onUpdateChatSession(filter: $filter, owner: $owner) {
    createdAt
    id
    messages {
      nextToken
      __typename
    }
    name
    owner
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnUpdateChatSessionSubscriptionVariables,
  APITypes.OnUpdateChatSessionSubscription
>;
export const onUpdateDummyModelToAddIamDirective = /* GraphQL */ `subscription OnUpdateDummyModelToAddIamDirective(
  $filter: ModelSubscriptionDummyModelToAddIamDirectiveFilterInput
  $owner: String
) {
  onUpdateDummyModelToAddIamDirective(filter: $filter, owner: $owner) {
    createdAt
    id
    owner
    responseStreamChunk {
      chatSessionId
      chunkText
      index
      __typename
    }
    updatedAt
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.OnUpdateDummyModelToAddIamDirectiveSubscriptionVariables,
  APITypes.OnUpdateDummyModelToAddIamDirectiveSubscription
>;
export const recieveResponseStreamChunk = /* GraphQL */ `subscription RecieveResponseStreamChunk($chatSessionId: String!) {
  recieveResponseStreamChunk(chatSessionId: $chatSessionId) {
    chatSessionId
    chunkText
    index
    __typename
  }
}
` as GeneratedSubscription<
  APITypes.RecieveResponseStreamChunkSubscriptionVariables,
  APITypes.RecieveResponseStreamChunkSubscription
>;
