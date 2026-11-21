import type { ApiHealth } from '../../../shared/types/api'

export async function getApiHealth(): Promise<ApiHealth> {
  const response = await fetch('/api/health')

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`)
  }

  return response.json() as Promise<ApiHealth>
}
