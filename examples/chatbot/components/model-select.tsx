'use client'

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { type ChatModel } from '@/lib/models'

export function ModelSelect({
  models,
  value,
  onValueChange,
}: {
  models: ChatModel[]
  value: string
  onValueChange: (value: string) => void
}) {
  const selectedModel = models.find((model) => model.id === value) ?? null

  return (
    <Combobox
      items={models}
      value={selectedModel}
      onValueChange={(model) => {
        if (model) onValueChange(model.id)
      }}
      itemToStringLabel={(model) => model.name}
      itemToStringValue={(model) => model.id}
      isItemEqualToValue={(model, selected) => model.id === selected.id}
    >
      <ComboboxInput
        aria-label="Model"
        className="w-56 bg-background"
        disabled={models.length === 0}
        placeholder={
          models.length === 0 ? 'No models available' : 'Search models…'
        }
      />
      <ComboboxContent>
        <ComboboxEmpty>No models found.</ComboboxEmpty>
        <ComboboxList>
          {(model: ChatModel) => (
            <ComboboxItem key={model.id} value={model}>
              <span className="truncate">{model.name}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
