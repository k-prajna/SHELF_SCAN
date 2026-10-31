const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/+$/, '')
export const AUTH_TOKEN_KEY = 'shelfscan_access_token'

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  const normalized = normalizeEmail(email)
  return (
    normalized.length <= 254 &&
    normalized.split('@')[0].length <= 64 &&
    normalized.split('@')[1]?.length <= 253 &&
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      normalized,
    )
  )
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  const token = localStorage.getItem(AUTH_TOKEN_KEY)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  } catch (error) {
    throw new ApiError(
      error instanceof Error ? `Could not connect to Shelf Scan: ${error.message}` : 'Could not connect to Shelf Scan.',
      0,
    )
  }

  const responseBody = await response.json().catch(() => null) as
    | { detail?: string | Array<{ msg?: string }>; message?: string }
    | null
  if (!response.ok) {
    const detail = responseBody?.detail
    const message = Array.isArray(detail)
      ? detail.map((item) => item.msg).filter(Boolean).join(' ')
      : detail ?? responseBody?.message ?? 'The request could not be completed.'
    throw new ApiError(message || 'The request could not be completed.', response.status)
  }
  return responseBody as T
}

export type AuthUser = {
  id: string
  full_name: string
  email: string
  role?: 'user' | 'admin'
  created_at?: string | null
  last_login_at?: string | null
  last_active_at?: string | null
}

export type AuthResponse = {
  token: string
  user: AuthUser
}

export type VerificationResponse = {
  message: string
  verification_required?: boolean
  email?: string
  development_code?: string
}

export type ScanResponse = {
  id: string
  title: string
  created_at: string
  status: string
  recognized_books: Array<{
    book_id: string | null
    title: string
    author: string
    confidence: number
    uncertain: boolean
    metadata: {
      id: string
      title: string
      author: string
      genre: string
      description: string
      cover: string
      publisher: string
      publication_year: number | null
      match_score: number
      recommendation_reason: string
      ai_explanation: string
    } | null
  }>
}

export function saveAccessToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}

export function clearAccessToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY)
}
