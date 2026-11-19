export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export const clamp01 = (value: number) => clamp(value, 0, 1)

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
