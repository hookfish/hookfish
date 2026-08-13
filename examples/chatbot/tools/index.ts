import { type InferUITools, type UIDataTypes, type UIMessage } from 'ai'

import { askUser } from './ask_user'
import { githubRepo } from './github_repo'

const baseTools = {
  github_repo: githubRepo,
  ask_user: askUser,
}

export function getTools() {
  return baseTools
}

export type ChatUIMessage = UIMessage<
  unknown,
  UIDataTypes,
  InferUITools<typeof baseTools>
>

export type ChatMessagePart = ChatUIMessage['parts'][number]

export type TextMessagePart = Extract<ChatMessagePart, { type: 'text' }>

export type SourceUrlPart = Extract<ChatMessagePart, { type: 'source-url' }>

export type GithubRepoToolPart = Extract<
  ChatMessagePart,
  { type: 'tool-github_repo' }
>

export type AskUserToolPart = Extract<
  ChatMessagePart,
  { type: 'tool-ask_user' }
>
