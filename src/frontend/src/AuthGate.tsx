import { useEffect, useState, type ReactNode } from 'react'
import { onAuthRequired } from '@/lib/auth'
import { TokenGate } from '@/lib/TokenGate'

/**
 * The legacy React App's sign-in: once page content (a docs page's markdown,
 * the search index) answers 401, the app gives way to the sign-in prompt the
 * app shell uses (lib/TokenGate), and reloads after sign-in so every request
 * goes out again with the stored token (lib/auth).
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [signIn, setSignIn] = useState(false)
  useEffect(() => onAuthRequired(() => setSignIn(true)), [])
  if (!signIn) return children
  return <TokenGate onAuthenticated={() => window.location.reload()} />
}
