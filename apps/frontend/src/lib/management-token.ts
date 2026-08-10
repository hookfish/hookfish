import { atom, useAtom } from 'jotai'

export const MANAGEMENT_TOKEN_KEY = 'hookfish.management-token.v1'

const storedManagementTokenAtom = atom(
  typeof window === 'undefined'
    ? ''
    : (window.sessionStorage.getItem(MANAGEMENT_TOKEN_KEY) ?? ''),
)

export const managementTokenAtom = atom(
  (get) => get(storedManagementTokenAtom),
  (_get, set, nextToken: string) => {
    if (nextToken) {
      window.sessionStorage.setItem(MANAGEMENT_TOKEN_KEY, nextToken)
    } else {
      window.sessionStorage.removeItem(MANAGEMENT_TOKEN_KEY)
    }
    set(storedManagementTokenAtom, nextToken)
  },
)

export function useManagementToken() {
  const [token, setToken] = useAtom(managementTokenAtom)
  return { token, setToken }
}
