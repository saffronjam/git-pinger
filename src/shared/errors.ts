export type ApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'other'

export interface SerializedApiError {
  kind: ApiErrorKind
  status: number | null
  url: string
  message: string
  bodyPreview: string | null
}
