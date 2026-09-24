import { useEffect } from 'react'

// Escape-to-close for modal dialogs (accessibility §25)
export function useEscape(onClose) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
}
