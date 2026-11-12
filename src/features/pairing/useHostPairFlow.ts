import { useEffect, useRef, useState } from 'react'
import type { Link } from '../../core/link'
import { hostShowsPairedView } from './hostSignalReconnect'

export type QrCardPhase = 'idle' | 'found' | 'paired'

function dashboardOpen(link: Link) {
  return link.role === 'host' && (link.status === 'connected' || hostShowsPairedView(link.status, link.hadGuest))
}

export function useHostPairFlow(link: Link) {
  const [showDashboard, setShowDashboard] = useState(() => dashboardOpen(link))
  const [cardPhase, setCardPhase] = useState<QrCardPhase>('idle')
  const celebrateTimer = useRef<number>()
  const celebrated = useRef(false)

  useEffect(() => {
    if (link.role !== 'host') return
    const s = link.status

    if (s === 'error' || s === 'starting') {
      setCardPhase('idle')
      setShowDashboard(false)
      return
    }

    if (hostShowsPairedView(s, link.hadGuest)) {
      setShowDashboard(true)
      return
    }

    if (s === 'waiting') {
      setCardPhase('idle')
      setShowDashboard(false)
      celebrated.current = false
      return
    }

    if (s === 'connecting') setCardPhase('found')

    if (s === 'connected') {
      if (!celebrated.current) {
        setCardPhase('paired')
        celebrated.current = true
        if (celebrateTimer.current) clearTimeout(celebrateTimer.current)
        celebrateTimer.current = window.setTimeout(() => {
          setShowDashboard(true)
        }, 1000)
      } else {
        setShowDashboard(true)
      }
    }

    return () => {
      if (celebrateTimer.current) clearTimeout(celebrateTimer.current)
    }
  }, [link.status, link.hadGuest, link.role])

  useEffect(() => {
    if (link.status === 'connecting' || link.status === 'connected') {
      if (link.remoteName) setCardPhase((p) => (p === 'paired' ? 'paired' : 'found'))
    }
  }, [link.remoteName, link.status])

  return { showDashboard, cardPhase }
}
