"use client"

import { useEffect, useRef, type RefObject } from "react"
import { gsap } from "gsap"

const SPOTLIGHT_RADIUS = 300

function calcValues(radius: number) {
  return { proximity: radius * 0.5, fadeDistance: radius * 0.75 }
}

// A big soft glow that follows the cursor across the whole widget grid,
// plus drives each card's own border-glow intensity based on distance —
// ported from React Bits' Magic Bento GlobalSpotlight.
export function GlobalSpotlight({ gridRef }: { gridRef: RefObject<HTMLDivElement | null> }) {
  const spotlightRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!gridRef.current) return

    const spotlight = document.createElement("div")
    spotlight.className = "global-spotlight"
    spotlight.style.cssText = `
      position: fixed;
      width: 700px;
      height: 700px;
      border-radius: 50%;
      pointer-events: none;
      background: radial-gradient(circle,
        rgb(from var(--brand-primary-base) r g b / 0.12) 0%,
        rgb(from var(--brand-primary-base) r g b / 0.06) 20%,
        rgb(from var(--brand-primary-base) r g b / 0.02) 40%,
        transparent 70%
      );
      opacity: 0;
      transform: translate(-50%, -50%);
    `
    document.body.appendChild(spotlight)
    spotlightRef.current = spotlight

    function handleMouseMove(e: MouseEvent) {
      const grid = gridRef.current
      if (!grid || !spotlightRef.current) return

      const sectionRect = grid.getBoundingClientRect()
      const inside =
        e.clientX >= sectionRect.left &&
        e.clientX <= sectionRect.right &&
        e.clientY >= sectionRect.top &&
        e.clientY <= sectionRect.bottom

      const cards = grid.querySelectorAll<HTMLElement>(".magic-bento-card")

      if (!inside) {
        gsap.to(spotlightRef.current, { opacity: 0, duration: 0.3, ease: "power2.out" })
        cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
        return
      }

      const { proximity, fadeDistance } = calcValues(SPOTLIGHT_RADIUS)
      let minDistance = Infinity

      cards.forEach((card) => {
        const cardRect = card.getBoundingClientRect()
        const centerX = cardRect.left + cardRect.width / 2
        const centerY = cardRect.top + cardRect.height / 2
        const distance =
          Math.hypot(e.clientX - centerX, e.clientY - centerY) - Math.max(cardRect.width, cardRect.height) / 2
        const effectiveDistance = Math.max(0, distance)
        minDistance = Math.min(minDistance, effectiveDistance)

        let intensity = 0
        if (effectiveDistance <= proximity) intensity = 1
        else if (effectiveDistance <= fadeDistance) intensity = (fadeDistance - effectiveDistance) / (fadeDistance - proximity)

        const relX = ((e.clientX - cardRect.left) / cardRect.width) * 100
        const relY = ((e.clientY - cardRect.top) / cardRect.height) * 100
        card.style.setProperty("--glow-x", `${relX}%`)
        card.style.setProperty("--glow-y", `${relY}%`)
        card.style.setProperty("--glow-intensity", intensity.toString())
        card.style.setProperty("--glow-radius", `${SPOTLIGHT_RADIUS}px`)
      })

      gsap.to(spotlightRef.current, { left: e.clientX, top: e.clientY, duration: 0.1, ease: "power2.out" })

      const targetOpacity =
        minDistance <= proximity
          ? 0.6
          : minDistance <= fadeDistance
            ? ((fadeDistance - minDistance) / (fadeDistance - proximity)) * 0.6
            : 0
      gsap.to(spotlightRef.current, {
        opacity: targetOpacity,
        duration: targetOpacity > 0 ? 0.2 : 0.5,
        ease: "power2.out",
      })
    }

    function handleDocMouseLeave() {
      gridRef.current?.querySelectorAll<HTMLElement>(".magic-bento-card").forEach((card) => card.style.setProperty("--glow-intensity", "0"))
      if (spotlightRef.current) gsap.to(spotlightRef.current, { opacity: 0, duration: 0.3, ease: "power2.out" })
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseleave", handleDocMouseLeave)

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseleave", handleDocMouseLeave)
      spotlightRef.current?.remove()
    }
  }, [gridRef])

  return null
}
