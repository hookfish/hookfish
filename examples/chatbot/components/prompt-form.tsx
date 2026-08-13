'use client'

import { ArrowUpIcon, SquareIcon } from 'lucide-react'
import * as React from 'react'
import { ModelSelect } from '@/components/model-select'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { type ChatModel } from '@/lib/models'

export function PromptForm({
  models,
  model,
  onModelChange,
  isBusy,
  onSubmit,
  onStop,
}: {
  models: ChatModel[]
  model: string
  onModelChange: (model: string) => void
  isBusy: boolean
  onSubmit: (text: string) => void
  onStop: () => void
}) {
  const [input, setInput] = React.useState('')

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    const text = input.trim()
    if (!text || !model || isBusy) return
    onSubmit(text)
    setInput('')
  }

  return (
    <form onSubmit={handleSubmit}>
      <InputGroup>
        <InputGroupTextarea
          className="p-3.5"
          disabled={!model}
          placeholder={model ? 'Send a message…' : 'No models available'}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              handleSubmit()
            }
          }}
        />
        <InputGroupAddon align="block-end">
          <ModelSelect
            models={models}
            value={model}
            onValueChange={onModelChange}
          />
          {isBusy ? (
            <InputGroupButton
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Stop generating"
              className="ml-auto"
              onClick={onStop}
            >
              <SquareIcon />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              aria-label="Send message"
              className="ml-auto"
              disabled={!input.trim() || !model}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
