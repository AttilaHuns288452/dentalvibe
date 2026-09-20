import { useEffect, useState } from 'react'

// Current hash route ('/' when empty). Lives here so App/Navbar just consume it.
export function useHashPath() {
  const [path, setPath] = useState(window.location.hash.slice(1) || '/')
  useEffect(() => {
    const onChange = () => setPath(window.location.hash.slice(1) || '/')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return path
}

export function navigate(path) {
  window.location.hash = path
}
