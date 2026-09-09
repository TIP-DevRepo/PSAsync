"use client"

import { useRef, useEffect, useCallback, type ReactNode } from "react"
import Link from "next/link"
import { gsap } from "gsap"
import "./magic-bento.css"

const PARTICLE_COUNT = 8

function createParticle(x: number, y: number): HTMLDivElement {
  const el = document.createElement("div")
  el.className = "magic-bento-particle"
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  return el
}

// The card itself: border glow (via magic-bento.css, driven by
// --glow-x/--glow-y/--glow-intensity, which GlobalSpotlight sets on
// mousemove) plus a small burst of floating "firefly" particles on
// hover. Ported from React Bits' Magic Bento ParticleCard, minus the
// tilt/magnetism/click-ripple effects — those fit a marketing card
// better than a dashboard widget with real links inside it.
export function BentoTile({
  href,
  className = "",
  children,
}: {
  href?: string
  className?: string
  children: ReactNode
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const particlesRef = useRef<HTMLDivElement[]>([])
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const isHoveredRef = useRef(false)

  const clearParticles = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout)
    timeoutsRef.current = []
    particlesRef.current.forEach((p) => {
      gsap.to(p, { scale: 0, opacity: 0, duration: 0.3, ease: "back.in(1.7)", onComplete: () => p.remove() })
    })
    particlesRef.current = []
  }, [])

  const spawnParticles = useCallback(() => {
    const card = cardRef.current
    if (!card || !isHoveredRef.current) return
    const { width, height } = card.getBoundingClientRect()

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const timeoutId = setTimeout(() => {
        if (!isHoveredRef.current || !cardRef.current) return
        const particle = createParticle(Math.random() * width, Math.random() * height)
        cardRef.current.appendChild(particle)
        particlesRef.current.push(particle)

        gsap.fromTo(particle, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(1.7)" })
        gsap.to(particle, {
          x: (Math.random() - 0.5) * 80,
          y: (Math.random() - 0.5) * 80,
          rotation: Math.random() * 360,
          duration: 2 + Math.random() * 2,
          ease: "none",
          repeat: -1,
          yoyo: true,
        })
        gsap.to(particle, { opacity: 0.3, duration: 1.5, ease: "power2.inOut", repeat: -1, yoyo: true })
      }, i * 100)
      timeoutsRef.current.push(timeoutId)
    }
  }, [])

  useEffect(() => {
    const card = cardRef.current
    if (!card) return

    function handleEnter() {
      isHoveredRef.current = true
      spawnParticles()
    }
    function handleLeave() {
      isHoveredRef.current = false
      clearParticles()
    }

    card.addEventListener("mouseenter", handleEnter)
    card.addEventListener("mouseleave", handleLeave)
    return () => {
      isHoveredRef.current = false
      card.removeEventListener("mouseenter", handleEnter)
      card.removeEventListener("mouseleave", handleLeave)
      clearParticles()
    }
  }, [spawnParticles, clearParticles])

  const body = (
    <div
      ref={cardRef}
      className={`magic-bento-card magic-bento-card--border-glow particle-container group relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card p-5 shadow-card transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-elevated ${className}`}
    >
      <div className="relative flex flex-1 flex-col">{children}</div>
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="contents">
        {body}
      </Link>
    )
  }
  return body
}
