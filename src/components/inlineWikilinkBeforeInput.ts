type BeforeInputLike = {
  inputType?: unknown
}

type PlainTextBeforeInputLike = BeforeInputLike & {
  data?: unknown
  isComposing?: unknown
}

type PlainTextBeforeInput = PlainTextBeforeInputLike & {
  data: string
  inputType: 'insertText'
  isComposing?: false
}

export function isInsertBeforeInput(nativeEvent: BeforeInputLike) {
  const { inputType } = nativeEvent
  return typeof inputType === 'string' && inputType.startsWith('insert')
}

export function isPlainTextBeforeInput(
  nativeEvent: PlainTextBeforeInputLike,
): nativeEvent is PlainTextBeforeInput {
  return nativeEvent.inputType === 'insertText'
    && !nativeEvent.isComposing
    && typeof nativeEvent.data === 'string'
    && nativeEvent.data.length > 0
}
